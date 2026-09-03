import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationRun } from '@/scripts/automation/logger';
import {
  createEmptyProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
} from '@/scripts/automation/workflow-events';
import {
  FFTS_PROTECTED_PUSH_DESTINATION_REF,
  FFTS_PROTECTED_PUSH_REMOTE,
  buildExplicitProtectedPushArgv,
} from '@/scripts/automation/workflow-c9-run-identity';
import {
  loadCanonicalV24RequiredTestIds,
  loadCanonicalWorkflowSuiteManifest,
} from '@/scripts/automation/workflow-verification-ledger';
import { getCurrentTreeFingerprint } from '@/scripts/automation/workflow-evidence-manifest';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  git,
  initGitRepo,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function saveC9State(repoRoot: string, head: string) {
  const ready = createEmptyProtocolRecord({
    workstreamId: 'ws_c9',
    baseCommit: head,
    branchName: 'main',
    headCommit: head,
  });
  ready.phase = 'finalise_ready';
  ready.nextAction = 'run_finalise';
  ready.activeCheckpointId = 'ckpt_c9';
  const treeFingerprint = getCurrentTreeFingerprint(repoRoot).inputFingerprint;
  ready.reviewedTreeFingerprint = treeFingerprint;
  ready.reviewAttempts = [
    {
      pass: 'first',
      token: 'rev_first_ws_c9_push',
      startedAt: ready.updatedAt,
      recordedAt: ready.updatedAt,
      result: 'passed',
      headCommit: head,
      treeFingerprint,
    },
  ];
  writeProtocolRecord(repoRoot, ready);
  const paths = getWorkflowPaths(repoRoot);
  mkdirSync(path.dirname(paths.statePath), { recursive: true });
  saveWorkflowReviewState(paths.statePath, {
    ...createEmptyWorkflowReviewState(),
    protocolRecords: { [ready.workstreamId]: ready },
    activeFinaliseContext: {
      workstreamId: ready.workstreamId,
      checkpointId: ready.activeCheckpointId,
      activatedAt: new Date().toISOString(),
      activatedHeadCommit: head,
      activatedBranchName: 'main',
      ownedCommits: [head],
    },
  });
}

function createProtectedRun(repoRoot: string) {
  return new AutomationRun({
    scriptName: 'finalise',
    mode: 'run',
    args: [],
    persist: true,
    repoRoot,
  });
}

function misleadUpstream(repoRoot: string): void {
  git(repoRoot, ['remote', 'add', 'origin', 'https://example.invalid/ffts.git']);
  git(repoRoot, ['config', 'branch.main.remote', 'origin']);
  git(repoRoot, ['config', 'branch.main.merge', 'refs/heads/evil']);
}

describe('TEE V2.4 C9 authorised push binding', () => {
  it('ARCH-C9-PUSH-BINDING-007: push uses the validated exact SHA, origin, and refs/heads/main, ignoring ambient upstream', () => {
    const repoRoot = makeTempRoot('c9-push-binding');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    misleadUpstream(repoRoot);
    const run = createProtectedRun(repoRoot);
    const authorization = run.assertC9BeforeRemoteMutation();
    expect(authorization).toBeDefined();
    if (!authorization) throw new Error('missing authorization');
    expect(authorization.sourceCommit).toBe(head.toLowerCase());
    expect(authorization.remoteName).toBe(FFTS_PROTECTED_PUSH_REMOTE);
    expect(authorization.destinationRef).toBe(FFTS_PROTECTED_PUSH_DESTINATION_REF);
    const argv = buildExplicitProtectedPushArgv(authorization);
    expect(argv).toEqual(['push', 'origin', `${head.toLowerCase()}:refs/heads/main`]);
    expect(argv).not.toContain('HEAD');
    expect(argv).not.toContain('-u');
    expect(git(repoRoot, ['config', '--get', 'branch.main.merge'])).toBe('refs/heads/evil');
    const finaliseSource = readFileSync(path.join(REPO_ROOT, 'scripts/finalise.ts'), 'utf8');
    expect(finaliseSource).not.toMatch(/runCommand\('git', \['push'\]\)/);
    expect(finaliseSource).not.toMatch(/'push', '-u', 'origin', 'HEAD'/);
    expect(finaliseSource).toContain('buildExplicitProtectedPushArgv');
  });

  it('ARCH-C9-PUSH-DRIFT-008: branch or HEAD drift after authorization cannot redirect the pushed range', () => {
    const repoRoot = makeTempRoot('c9-push-drift');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const authorization = run.assertC9BeforeRemoteMutation();
    expect(authorization).toBeDefined();
    if (!authorization) throw new Error('missing authorization');
    commitFile(repoRoot, 'drift.ts', 'unreviewed after C9');
    expect(() => run.assertAuthorizedC9PushStillValid(authorization)).toThrow(
      /HEAD drifted after C9 push authorization|HEAD\/owned-chain mismatch|refuse remote mutation/i
    );
    const mutated = {
      ...authorization,
      sourceCommit: git(repoRoot, ['rev-parse', 'HEAD']).toLowerCase(),
    };
    expect(() => run.assertAuthorizedC9PushStillValid(mutated)).toThrow(
      /HEAD drifted after C9 push authorization|HEAD\/owned-chain mismatch|C9-validated HEAD does not match|refuse remote mutation/i
    );
  });

  it('ARCH-C9-PUSH-LEASE-009: competing workflow ownership after C9 authorization cannot push', () => {
    const repoRoot = makeTempRoot('c9-push-lease');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const authorization = run.assertC9BeforeRemoteMutation();
    expect(authorization).toBeDefined();
    if (!authorization) throw new Error('missing authorization');
    const ready = createEmptyProtocolRecord({
      workstreamId: 'ws_other',
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    ready.phase = 'finalise_ready';
    ready.activeCheckpointId = 'ckpt_other';
    writeProtocolRecord(repoRoot, ready);
    const paths = getWorkflowPaths(repoRoot);
    const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    state.activeFinaliseContext = {
      workstreamId: 'ws_other',
      checkpointId: 'ckpt_other',
      activatedAt: new Date().toISOString(),
      activatedHeadCommit: head,
      activatedBranchName: 'main',
      ownedCommits: [head],
    };
    writeFileSync(paths.statePath, JSON.stringify(state, null, 2), 'utf8');
    expect(() => run.assertAuthorizedC9PushStillValid(authorization)).toThrow(
      /live finalise owner|another workstream/i
    );
  });

  it('ARCH-V24-REGRESSION-010: canonical required IDs still include the prior set plus C9 push-binding IDs', () => {
    const ids = loadCanonicalV24RequiredTestIds();
    expect(ids).toContain('TEE-V24-SPLIT-001');
    expect(ids).toContain('FD-VERIFY-EXIT-STATUS-001');
    expect(ids).toContain('FD-C9-FINISH-ATOMICITY-004');
    expect(ids).toContain('FD-FINALISE-AUTHORITY-005');
    expect(ids).toContain('FD-FINALISE-CRASH-006');
    expect(ids).toContain('ARCH-C9-PUSH-BINDING-007');
    expect(ids).toContain('ARCH-C9-PUSH-DRIFT-008');
    expect(ids).toContain('ARCH-C9-PUSH-LEASE-009');
    expect(ids).toContain('ARCH-V24-REGRESSION-010');
    expect(ids.length).toBeGreaterThanOrEqual(141);
    expect(loadCanonicalWorkflowSuiteManifest().files).toContain(
      'tests/unit/workflow-v24-c9-push-binding.test.ts'
    );
  });
});
