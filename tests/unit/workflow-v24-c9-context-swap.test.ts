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
import {
  buildProtectedC9RunIdentity,
  hashProtectedC9RunIdentity,
  persistProtectedC9RunIdentity,
  readProtectedC9RunIdentity,
  type ProtectedC9RunIdentity,
} from '@/scripts/automation/workflow-c9-run-identity';
import { getCurrentTreeFingerprint } from '@/scripts/automation/workflow-evidence-manifest';
import { assertSecurityMutationsFail } from '@/tests/unit/workflow-v24-mutation-helper';
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
    workstreamId?: string;
    checkpointId?: string;
    activatedBranchName?: string;
    ownedCommits?: string[];
  } = {}
) {
  const workstreamId = extras.workstreamId ?? 'ws_c9';
  const checkpointId = extras.checkpointId ?? 'ckpt_c9';
  const ready = createEmptyProtocolRecord({
    workstreamId,
    baseCommit: head,
    branchName: extras.activatedBranchName ?? 'main',
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
      token: `rev_first_${workstreamId}_swap`,
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
    protocolRecords: { [workstreamId]: ready },
    activeFinaliseContext: {
      workstreamId,
      checkpointId,
      activatedAt: new Date().toISOString(),
      activatedHeadCommit: head,
      activatedBranchName: extras.activatedBranchName ?? 'main',
      ownedCommits: extras.ownedCommits ?? [head],
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

describe('TEE V2.4 C9 captured-vs-current context', () => {
  it('FD-GIT-C9-PREPUSH-CONTEXT-SWAP-004 / TEE-V24-C9-SWAP-VALID-001: captured A plus current A passes', () => {
    const repoRoot = makeTempRoot('c9-swap-valid');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    expect(() => run.assertC9BeforeRemoteMutation()).not.toThrow();
    expect(run.loadCapturedC9Identity().ok).toBe(true);
  });

  it('ARCH-C9-LIVE-CONTEXT-001 / TEE-V24-C9-SWAP-CURRENT-B-002: replacing live owner B rejects captured A before push', () => {
    const repoRoot = makeTempRoot('c9-swap-current-b');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { workstreamId: 'ws_a', checkpointId: 'ckpt_a' });
    const run = createProtectedRun(repoRoot);
    saveC9State(repoRoot, head, { workstreamId: 'ws_b', checkpointId: 'ckpt_b' });
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/live finalise owner/i);
    const captured = run.loadCapturedC9Identity();
    expect(captured.ok && captured.identity.workstreamId).toBe('ws_a');
  });

  it('FD-C9-LIVE-OWNER-REQUIRED-FIELDS-001: missing live branch or HEAD rejects before push', () => {
    const repoRoot = makeTempRoot('c9-live-required-fields');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    const missingBranch = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    delete missingBranch.activeFinaliseContext.activatedBranchName;
    writeFileSync(paths.statePath, JSON.stringify(missingBranch, null, 2), 'utf8');
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/live finalise branch is missing/i);
    saveC9State(repoRoot, head);
    const missingHead = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    delete missingHead.activeFinaliseContext.activatedHeadCommit;
    writeFileSync(paths.statePath, JSON.stringify(missingHead, null, 2), 'utf8');
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/live finalise HEAD is missing/i);
  });

  it('FD-C9-LIVE-PROTOCOL-BINDING-002: protocol branch or HEAD substitution rejects before push', () => {
    const repoRoot = makeTempRoot('c9-live-protocol-binding');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const ready = createEmptyProtocolRecord({
      workstreamId: 'ws_c9',
      baseCommit: head,
      branchName: 'other',
      headCommit: head,
    });
    ready.phase = 'finalise_ready';
    ready.activeCheckpointId = 'ckpt_c9';
    writeProtocolRecord(repoRoot, ready);
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/protocol branch/i);
    ready.branchName = 'main';
    ready.headCommit = 'ab'.repeat(20);
    writeProtocolRecord(repoRoot, ready);
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/protocol HEAD/i);
  });

  it('FD-C9-LIVE-OWNED-CHAIN-003: replaced live owned chain rejects before push', () => {
    const repoRoot = makeTempRoot('c9-live-owned-chain');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    const swapped = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    swapped.activeFinaliseContext.ownedCommits = ['ab'.repeat(20)];
    writeFileSync(paths.statePath, JSON.stringify(swapped, null, 2), 'utf8');
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/owned chain/i);
  });

  it('ARCH-C9-LIVE-CONTEXT-LOSS-002: removing the live context rejects the captured run before push', () => {
    const repoRoot = makeTempRoot('c9-live-loss');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    delete state.activeFinaliseContext;
    writeFileSync(paths.statePath, JSON.stringify(state, null, 2), 'utf8');
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/live finalise context is missing/i);
  });

  it('TEE-V24-C9-SWAP-B-WOULD-PASS-003: current B would pass but captured A fails', () => {
    const repoRoot = makeTempRoot('c9-swap-a-fails');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { workstreamId: 'ws_a', checkpointId: 'ckpt_a' });
    const runA = createProtectedRun(repoRoot);
    const extra = commitFile(repoRoot, 'drift.ts', 'unrelated');
    saveC9State(repoRoot, extra, { workstreamId: 'ws_b', checkpointId: 'ckpt_b' });
    const runB = createProtectedRun(repoRoot);
    expect(() => runB.assertC9BeforeRemoteMutation()).not.toThrow();
    expect(() => runA.assertC9BeforeRemoteMutation()).toThrow(/HEAD|owned-chain/i);
  });

  it('TEE-V24-C9-SWAP-DELETED-004: captured context deleted fails closed', () => {
    const repoRoot = makeTempRoot('c9-swap-deleted');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    rmSync(run.protectedC9IdentityPath, { force: true });
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/missing/i);
  });

  it('TEE-V24-C9-SWAP-CORRUPT-005: captured context corrupted fails', () => {
    const repoRoot = makeTempRoot('c9-swap-corrupt');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    writeFileSync(run.protectedC9IdentityPath, '{not-json', 'utf8');
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/malformed/i);
  });

  it('TEE-V24-C9-SWAP-OTHER-WS-006: captured context referencing another workstream fails', () => {
    const repoRoot = makeTempRoot('c9-swap-other-ws');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { workstreamId: 'ws_a' });
    const run = createProtectedRun(repoRoot);
    const captured = run.loadCapturedC9Identity();
    expect(captured.ok).toBe(true);
    if (!captured.ok) throw new Error(captured.message);
    const hijack = {
      ...captured.identity,
      workstreamId: 'ws_other',
    };
    persistProtectedC9RunIdentity({
      runDirectory: path.dirname(run.protectedC9IdentityPath),
      identity: { ...hijack, identityHash: hashProtectedC9RunIdentity(hijack) },
    });
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/another workstream/i);
  });

  it('TEE-V24-C9-SWAP-HEAD-007: captured HEAD differs fails', () => {
    const repoRoot = makeTempRoot('c9-swap-head');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    commitFile(repoRoot, 'extra.ts', 'unreviewed');
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/HEAD|owned-chain/i);
  });

  it('TEE-V24-C9-SWAP-BRANCH-008: branch differs fails', () => {
    const repoRoot = makeTempRoot('c9-swap-branch');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    git(repoRoot, ['checkout', '-b', 'other']);
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/branch/i);
  });

  it('TEE-V24-C9-SWAP-OWNED-009: owned release chain differs fails', () => {
    const repoRoot = makeTempRoot('c9-swap-owned');
    const head = initGitRepo(repoRoot);
    const extra = commitFile(repoRoot, 'product.ts', 'unreviewed product');
    saveC9State(repoRoot, extra, { ownedCommits: [head] });
    const run = createProtectedRun(repoRoot);
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/owned-chain|HEAD/i);
  });

  it('TEE-V24-C9-SWAP-BUMP-010: legitimate same-run release bump passes', () => {
    const repoRoot = makeTempRoot('c9-swap-bump');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    commitFile(repoRoot, 'VERSION', '1.2.3');
    expect(() => run.assertC9BeforeRemoteMutation()).not.toThrow();
  });

  it('TEE-V24-C9-SWAP-HIJACK-011: another workstream cannot hijack A pre-push', () => {
    const repoRoot = makeTempRoot('c9-swap-hijack');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { workstreamId: 'ws_a', checkpointId: 'ckpt_a' });
    const runA = createProtectedRun(repoRoot);
    const drifted = commitFile(repoRoot, 'b-only.ts', 'b owned');
    saveC9State(repoRoot, drifted, {
      workstreamId: 'ws_b',
      checkpointId: 'ckpt_b',
      ownedCommits: [head, drifted],
    });
    expect(() => runA.assertC9BeforeRemoteMutation()).toThrow(/HEAD|owned-chain/i);
    const captured = runA.loadCapturedC9Identity();
    expect(captured.ok && captured.identity.workstreamId).toBe('ws_a');
  });

  it('TEE-V24-C9-SWAP-CLEANUP-012: finish does not erase captured identity before pre-push', async () => {
    const repoRoot = makeTempRoot('c9-swap-cleanup');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    await run.finish('passed');
    expect(run.loadCapturedC9Identity().ok).toBe(true);
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/live finalise context is missing/i);
    expect(readFileSync(run.protectedC9IdentityPath, 'utf8')).toContain('ws_c9');
  });

  it('TEE-V24-C9-SWAP-MUTATION-013: mutating captured identity fields fails', () => {
    const repoRoot = makeTempRoot('c9-swap-mutation');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const captured = run.loadCapturedC9Identity();
    expect(captured.ok).toBe(true);
    if (!captured.ok) throw new Error(captured.message);
    const persistMutated = (identity: ProtectedC9RunIdentity) => {
      writeFileSync(run.protectedC9IdentityPath, `${JSON.stringify(identity, null, 2)}\n`);
      return readProtectedC9RunIdentity({
        runDirectory: path.dirname(run.protectedC9IdentityPath),
        runId: run.runId,
      });
    };
    const rehashIdentity = (identity: ProtectedC9RunIdentity): ProtectedC9RunIdentity => ({
      ...identity,
      identityHash: hashProtectedC9RunIdentity(identity),
    });
    assertSecurityMutationsFail({
      valid: captured.identity,
      validate: (value) => {
        const stored = persistMutated(value);
        if (!stored.ok) return stored;
        try {
          run.assertC9BeforeRemoteMutation();
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
      allow: ['capturedAt'],
      fields: [
        {
          path: 'workstreamId',
          mutate: (value) => rehashIdentity({ ...value, workstreamId: 'ws_other' }),
        },
        {
          path: 'checkpointId',
          mutate: (value) => rehashIdentity({ ...value, checkpointId: 'ckpt_other' }),
        },
        {
          path: 'branchName',
          mutate: (value) => rehashIdentity({ ...value, branchName: 'other' }),
        },
        {
          path: 'activatedHeadCommit',
          mutate: (value) => rehashIdentity({ ...value, activatedHeadCommit: 'ab'.repeat(20) }),
        },
        {
          path: 'ownedCommits',
          mutate: (value) => rehashIdentity({ ...value, ownedCommits: ['ab'.repeat(20)] }),
        },
        {
          path: 'runId',
          mutate: (value) => rehashIdentity({ ...value, runId: 'other-run' }),
        },
        {
          path: 'identityHash',
          mutate: (value) => ({ ...value, identityHash: 'cd'.repeat(32) }),
        },
        {
          path: 'schemaVersion',
          mutate: (value) => ({ ...value, schemaVersion: 'other' as never }),
        },
      ],
    });
    persistMutated(captured.identity);
    expect(() => run.assertC9BeforeRemoteMutation()).not.toThrow();
    const built = buildProtectedC9RunIdentity({
      runId: run.runId,
      context: {
        workstreamId: 'ws_c9',
        checkpointId: 'ckpt_c9',
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: head,
        activatedBranchName: 'main',
        ownedCommits: [head],
      },
    });
    expect(built.ok).toBe(true);
  });
});
