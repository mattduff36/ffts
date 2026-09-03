import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
import { getCurrentTreeFingerprint } from '@/scripts/automation/workflow-evidence-manifest';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  git,
  initGitRepo,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function saveC9State(
  repoRoot: string,
  head: string,
  extras: {
    omitActivatedHead?: boolean;
    checkpointId?: string;
    activatedBranchName?: string;
    ownedCommits?: string[];
    malformedCheckpoint?: boolean;
  } = {}
) {
  const workstreamId = 'ws_c9';
  const checkpointId = extras.checkpointId ?? 'ckpt_c9';
  const ready = createEmptyProtocolRecord({
    workstreamId,
    baseCommit: head,
    branchName: 'main',
    headCommit: head,
  });
  ready.phase = 'finalise_ready';
  ready.nextAction = 'run_finalise';
  ready.activeCheckpointId = checkpointId;
  const treeFingerprint = getCurrentTreeFingerprint(repoRoot).inputFingerprint;
  ready.reviewedTreeFingerprint = treeFingerprint;
  ready.reviewAttempts = [
    {
      pass: 'first',
      token: `rev_first_${workstreamId}_c9`,
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
  const activeFinaliseContext = extras.malformedCheckpoint
    ? ({
        workstreamId,
        checkpointId: 12,
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: head,
        activatedBranchName: extras.activatedBranchName ?? 'main',
        ownedCommits: extras.ownedCommits ?? [head],
      } as never)
    : {
        workstreamId,
        checkpointId,
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: extras.omitActivatedHead ? undefined : head,
        activatedBranchName: extras.activatedBranchName ?? 'main',
        ownedCommits: extras.ownedCommits ?? [head],
      };
  saveWorkflowReviewState(paths.statePath, {
    ...createEmptyWorkflowReviewState(),
    protocolRecords: { [workstreamId]: ready },
    activeFinaliseContext,
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

describe('TEE V2.4 finish-time C9 authority', () => {
  it('TEE-V24-C9-FINISH-VALID-001 / FD-GIT-C9-001: valid C9 identity allows finish(passed)', async () => {
    const repoRoot = makeTempRoot('c9-valid');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    await expect(createProtectedRun(repoRoot).finish('passed')).resolves.toBeUndefined();
  });

  it('TEE-V24-C9-FINISH-MISSING-002: missing C9 identity rejects successful finish', async () => {
    const repoRoot = makeTempRoot('c9-missing');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(/identityStatus=missing|missing/i);
  });

  it('TEE-V24-C9-FINISH-MISMATCH-003: identity mismatch rejects successful finish', async () => {
    const repoRoot = makeTempRoot('c9-mismatch');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { checkpointId: 'ckpt_expected' });
    const paths = getWorkflowPaths(repoRoot);
    const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    state.activeFinaliseContext.checkpointId = 'ckpt_other';
    writeFileSync(paths.statePath, JSON.stringify(state, null, 2), 'utf8');
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(
      /mismatch|missing/i
    );
  });

  it('TEE-V24-C9-FINISH-BRANCH-004: branch mismatch rejects successful finish', async () => {
    const repoRoot = makeTempRoot('c9-branch');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { activatedBranchName: 'other' });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(/branch/i);
  });

  it('TEE-V24-C9-FINISH-HEAD-005: HEAD mismatch rejects successful finish', async () => {
    const repoRoot = makeTempRoot('c9-head');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    commitFile(repoRoot, 'extra.ts', 'unexpected head');
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(/HEAD|owned-chain/i);
  });

  it('TEE-V24-C9-FINISH-OWNED-006: unexpected product commit in owned chain rejects successful finish', async () => {
    const repoRoot = makeTempRoot('c9-owned');
    const head = initGitRepo(repoRoot);
    const extra = commitFile(repoRoot, 'product.ts', 'unreviewed product');
    saveC9State(repoRoot, extra, { ownedCommits: [head] });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(/owned-chain|HEAD/i);
  });

  it('TEE-V24-C9-FINISH-GIT-ERROR-007: Git verification error rejects successful finish', async () => {
    const repoRoot = makeTempRoot('c9-git');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    rmSync(path.join(repoRoot, '.git'), { recursive: true, force: true });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(
      /git identity cannot be verified/i
    );
  });

  it('TEE-V24-C9-FINISH-MALFORMED-008: malformed identity evidence rejects successful finish', async () => {
    const repoRoot = makeTempRoot('c9-malformed');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { malformedCheckpoint: true });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(/malformed/i);
  });

  it('TEE-V24-C9-FINISH-NO-DOWNGRADE-009: finish(passed) cannot downgrade C9 failure to telemetry', async () => {
    const repoRoot = makeTempRoot('c9-nodowngrade');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    const run = createProtectedRun(repoRoot);
    await expect(run.finish('passed')).rejects.toThrow(/refuse finish\(passed\)/i);
  });

  it('TEE-V24-C9-FINISH-NONC9-010: legitimate non-C9 runs remain compatible', async () => {
    const repoRoot = makeTempRoot('c9-non');
    initGitRepo(repoRoot);
    const dry = new AutomationRun({
      scriptName: 'finalise',
      mode: 'dry-run',
      args: ['--dry-run'],
      persist: false,
      repoRoot,
    });
    await expect(dry.finish('passed')).resolves.toBeUndefined();
    const other = new AutomationRun({
      scriptName: 'fixerrors',
      mode: 'run',
      args: [],
      persist: false,
      repoRoot,
    });
    await expect(other.finish('passed')).resolves.toBeUndefined();
  });

  it('FD-GIT-C9-STATE-LOSS-002: losing activeFinaliseContext still rejects finish(passed)', async () => {
    const repoRoot = makeTempRoot('c9-state-loss');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    delete state.activeFinaliseContext;
    writeFileSync(paths.statePath, JSON.stringify(state, null, 2), 'utf8');
    await expect(run.finish('passed')).rejects.toThrow(/missing|refuse finish\(passed\)/i);
  });

  it('FD-GIT-C9-PREPUSH-003: remote mutation is rejected when C9 identity cannot be proven', async () => {
    const repoRoot = makeTempRoot('c9-prepush');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const valid = createProtectedRun(repoRoot);
    expect(() => valid.assertC9BeforeRemoteMutation()).not.toThrow();
    const capturedBeforeLoss = createProtectedRun(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    delete state.activeFinaliseContext;
    writeFileSync(paths.statePath, JSON.stringify(state, null, 2), 'utf8');
    expect(() => capturedBeforeLoss.assertC9BeforeRemoteMutation()).toThrow(
      /live finalise context is missing/i
    );
    const lost = createProtectedRun(repoRoot);
    expect(() => lost.assertC9BeforeRemoteMutation()).toThrow(/missing|refuse remote mutation|refuse finish/i);
  });

  it('TEE-V24-C9-FINISH-HELPER-011: finish-time correlation still rejects missing activated HEAD', async () => {
    const repoRoot = makeTempRoot('c9-helper');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow();
    expect(git(repoRoot, ['rev-parse', 'HEAD'])).toBe(head);
  });
});
