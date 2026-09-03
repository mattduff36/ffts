import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationRun } from '@/scripts/automation/logger';
import {
  applyFinaliseProtocolOutcome,
  getFinalisePassedCommitPendingPath,
  hasIncompleteFinalisePassedCommit,
  recoverIncompleteFinalisePassedCommit,
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  saveWorkflowReviewState,
  writeJsonAtomic,
} from '@/scripts/automation/workflow-events';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import { getCurrentTreeFingerprint } from '@/scripts/automation/workflow-evidence-manifest';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function saveC9State(repoRoot: string, head: string) {
  const workstreamId = 'ws_c9';
  const checkpointId = 'ckpt_c9';
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
      token: 'rev_first_ws_c9_crash',
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

function protocolPhase(repoRoot: string) {
  return readProtocolRecord(repoRoot, 'ws_c9')?.phase ?? null;
}

function listPassedRunLogs(repoRoot: string): boolean {
  const dir = path.join(repoRoot, 'docs_private', 'automation', 'runs', 'finalise');
  if (!existsSync(dir)) return false;
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.c9-identity.json'))
    .some((name) => {
      try {
        return (JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { status?: string }).status ===
          'passed';
      } catch {
        return false;
      }
    });
}

function readinessClaimsFinalSuccess(repoRoot: string): boolean {
  const readiness = getFinaliseProtocolReadiness(repoRoot);
  return readiness.allowed === true && readiness.lineages.some((row) => row.role === 'finalised');
}

function preparePassedSnapshot(repoRoot: string) {
  const paths = getWorkflowPaths(repoRoot);
  const previousState = loadWorkflowReviewStateStrict(paths.statePath);
  const previousProtocol = readProtocolRecord(repoRoot, 'ws_c9');
  const outcome = applyFinaliseProtocolOutcome({
    repoRoot,
    state: previousState,
    workstreamId: 'ws_c9',
    outcome: 'passed',
  });
  return { paths, previousState, previousProtocol, nextState: outcome.state, finalized: outcome.record };
}

function writePending(repoRoot: string, previousState: ReturnType<typeof loadWorkflowReviewStateStrict>, previousProtocol: ReturnType<typeof readProtocolRecord>) {
  mkdirSync(path.dirname(getFinalisePassedCommitPendingPath(repoRoot)), { recursive: true });
  writeJsonAtomic(getFinalisePassedCommitPendingPath(repoRoot), {
    schemaVersion: '1',
    kind: 'protected-finalise-passed',
    createdAt: new Date().toISOString(),
    workstreamIds: ['ws_c9'],
    previousState,
    previousProtocols: { ws_c9: previousProtocol },
  });
}

describe('TEE V2.4 finalise crash-boundary safety', () => {
  it('TEE-V24-CRASH-BEFORE-WRITE-001 / FD-FINALISE-CRASH-006: crash before any success write stays non-finalised', async () => {
    const repoRoot = makeTempRoot('crash-before');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    expect(hasIncompleteFinalisePassedCommit(repoRoot)).toBe(false);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    await expect(createProtectedRun(repoRoot).finish('passed')).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalised');
  });

  it('TEE-V24-CRASH-AFTER-STATE-002: state written before protocol finalised fails closed', async () => {
    const repoRoot = makeTempRoot('crash-state');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const snapshot = preparePassedSnapshot(repoRoot);
    writePending(repoRoot, snapshot.previousState, snapshot.previousProtocol);
    saveWorkflowReviewState(snapshot.paths.statePath, snapshot.nextState);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(hasIncompleteFinalisePassedCommit(repoRoot)).toBe(true);
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(false);
    expect(readiness.lineages.some((row) => row.role === 'finalised')).toBe(false);
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    expect(recoverIncompleteFinalisePassedCommit(repoRoot)).toBe(true);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(hasIncompleteFinalisePassedCommit(repoRoot)).toBe(false);
    expect(loadWorkflowReviewStateStrict(snapshot.paths.statePath).activeFinaliseContext?.workstreamId).toBe(
      'ws_c9'
    );
    await expect(createProtectedRun(repoRoot).finish('passed')).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalised');
  });

  it('TEE-V24-CRASH-AFTER-PROTOCOL-003: protocol written with pending remaining fails closed and recovers', async () => {
    const repoRoot = makeTempRoot('crash-protocol');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const snapshot = preparePassedSnapshot(repoRoot);
    writePending(repoRoot, snapshot.previousState, snapshot.previousProtocol);
    saveWorkflowReviewState(snapshot.paths.statePath, snapshot.nextState);
    if (!snapshot.finalized) throw new Error('expected finalized record');
    writeProtocolRecord(repoRoot, snapshot.finalized);
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(hasIncompleteFinalisePassedCommit(repoRoot)).toBe(true);
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(false);
    expect(readiness.lineages.some((row) => row.role === 'finalised')).toBe(false);
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    expect(recoverIncompleteFinalisePassedCommit(repoRoot)).toBe(true);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    await expect(createProtectedRun(repoRoot).finish('passed')).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(true);
  });

  it('TEE-V24-CRASH-BEFORE-RUN-LOG-004: after authoritative commit, missing run log is not required for success', () => {
    const repoRoot = makeTempRoot('crash-run-log');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const snapshot = preparePassedSnapshot(repoRoot);
    writePending(repoRoot, snapshot.previousState, snapshot.previousProtocol);
    saveWorkflowReviewState(snapshot.paths.statePath, snapshot.nextState);
    if (!snapshot.finalized) throw new Error('expected finalized record');
    writeProtocolRecord(repoRoot, snapshot.finalized);
    rmSync(getFinalisePassedCommitPendingPath(repoRoot), { force: true });
    expect(hasIncompleteFinalisePassedCommit(repoRoot)).toBe(false);
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(listPassedRunLogs(repoRoot)).toBe(false);
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(true);
  });

  it('TEE-V24-CRASH-C9-NOT-AUTHORITY-005: C9 identity remaining after success is not release authority', async () => {
    const repoRoot = makeTempRoot('crash-c9');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    await run.finish('passed');
    expect(run.loadCapturedC9Identity().ok).toBe(true);
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(true);
    writeFileSync(run.protectedC9IdentityPath, '{not-json', 'utf8');
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(true);
  });

  it('TEE-V24-CRASH-RECOVER-RETRY-006: recover then finish revalidates C9 and completes deterministically', async () => {
    const repoRoot = makeTempRoot('crash-recover');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    const snapshot = preparePassedSnapshot(repoRoot);
    writePending(repoRoot, snapshot.previousState, snapshot.previousProtocol);
    saveWorkflowReviewState(snapshot.paths.statePath, snapshot.nextState);
    if (!snapshot.finalized) throw new Error('expected finalized record');
    writeProtocolRecord(repoRoot, snapshot.finalized);
    await expect(run.finish('passed')).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(hasIncompleteFinalisePassedCommit(repoRoot)).toBe(false);
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(true);
  });

  it('TEE-V24-CRASH-RUN-LOG-NOT-AUTHORITY-007: passed run logs are not release authority', async () => {
    const repoRoot = makeTempRoot('crash-log-auth');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const dir = path.join(repoRoot, 'docs_private', 'automation', 'runs', 'finalise');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'forged-passed.json'),
      JSON.stringify({ status: 'passed', scriptName: 'finalise' }, null, 2),
      'utf8'
    );
    expect(listPassedRunLogs(repoRoot)).toBe(true);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    expect(getFinaliseProtocolReadiness(repoRoot).lineages.some((row) => row.role === 'finalised')).toBe(
      false
    );
  });
});
