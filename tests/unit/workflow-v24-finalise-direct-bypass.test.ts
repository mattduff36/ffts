import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutomationRun,
  computeFinaliseAutomationCorrelation,
  correlateFinaliseAutomationRun,
} from '@/scripts/automation/logger';
import {
  applyFinaliseProtocolOutcome,
  commitFinaliseCorrelationStateAndProtocols,
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  saveWorkflowReviewState,
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

function saveC9State(
  repoRoot: string,
  head: string,
  extras: { omitActivatedHead?: boolean; withValidReview?: boolean } = {}
) {
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
  if (extras.withValidReview !== false) {
    const treeFingerprint = getCurrentTreeFingerprint(repoRoot).inputFingerprint;
    ready.reviewedTreeFingerprint = treeFingerprint;
    ready.reviewAttempts = [
      {
        pass: 'first',
        token: 'rev_first_ws_c9_valid',
        startedAt: ready.updatedAt,
        recordedAt: ready.updatedAt,
        result: 'passed',
        headCommit: head,
        treeFingerprint,
      },
    ];
  }
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
      activatedHeadCommit: extras.omitActivatedHead ? undefined : head,
      activatedBranchName: 'main',
      ownedCommits: extras.omitActivatedHead ? [] : [head],
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

function protocolPhase(repoRoot: string, workstreamId = 'ws_c9') {
  return readProtocolRecord(repoRoot, workstreamId)?.phase ?? null;
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
  return readiness.lineages.some((row) => row.role === 'finalised');
}

describe('TEE V2.4 direct finalise-authority bypass', () => {
  it('TEE-V24-BYPASS-FINISH-VALID-001 / FD-FINALISE-AUTHORITY-005: protected finish(passed) succeeds with valid C9', async () => {
    const repoRoot = makeTempRoot('bypass-valid');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    await expect(createProtectedRun(repoRoot).finish('passed')).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalised');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(true);
    expect(listPassedRunLogs(repoRoot)).toBe(true);
  });

  it('TEE-V24-BYPASS-STRUCTURE-ONLY-009: structure-only finalise_ready cannot finish or claim authority', async () => {
    const repoRoot = makeTempRoot('bypass-no-review');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { withValidReview: false });
    await expect(createProtectedRun(repoRoot).finish('passed')).rejects.toThrow(
      /valid review authority|successful current V2.4 review|malformed/i
    );
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    expect(listPassedRunLogs(repoRoot)).toBe(false);
  });

  it('TEE-V24-BYPASS-DIRECT-HELPER-002: direct correlation helper cannot independently finalise a protected workstream', () => {
    const repoRoot = makeTempRoot('bypass-direct');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    expect(() =>
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'direct-helper',
        repoRoot,
      })
    ).toThrow(/cannot persist independently|use AutomationRun\.finish after C9/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    expect(listPassedRunLogs(repoRoot)).toBe(false);
  });

  it('TEE-V24-BYPASS-STATUS-PASSED-003: caller-supplied status passed cannot bypass C9', () => {
    const repoRoot = makeTempRoot('bypass-status');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    expect(() =>
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'status-passed',
        repoRoot,
      })
    ).toThrow(/cannot persist independently/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
  });

  it('TEE-V24-BYPASS-MISSING-C9-004: direct helper with missing C9 cannot persist finalised', () => {
    const repoRoot = makeTempRoot('bypass-missing');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head, { omitActivatedHead: true });
    expect(() =>
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'missing-c9',
        repoRoot,
      })
    ).toThrow(/cannot persist independently/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
  });

  it('TEE-V24-BYPASS-CORRUPT-C9-005: direct helper with corrupted C9 cannot persist finalised', async () => {
    const repoRoot = makeTempRoot('bypass-corrupt');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const run = createProtectedRun(repoRoot);
    writeFileSync(run.protectedC9IdentityPath, '{not-json', 'utf8');
    expect(() =>
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'corrupt-c9',
        repoRoot,
      })
    ).toThrow(/cannot persist independently/i);
    await expect(run.finish('passed')).rejects.toThrow(/malformed|missing/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
  });

  it('TEE-V24-BYPASS-COMPUTE-ONLY-006: pure correlation computation remains available and does not persist', () => {
    const repoRoot = makeTempRoot('bypass-compute');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const paths = getWorkflowPaths(repoRoot);
    const state = loadWorkflowReviewStateStrict(paths.statePath);
    const computed = computeFinaliseAutomationCorrelation({
      scriptName: 'finalise',
      status: 'passed',
      runId: 'compute-only',
      repoRoot,
      state,
    });
    expect(computed?.matchedBy).toBe('explicit_context');
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    expect(
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'compute-via-state',
        repoRoot,
        state,
      })?.matchedBy
    ).toBe('explicit_context');
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
  });

  it('TEE-V24-BYPASS-FAILED-COMPAT-007: failed finish remains compatible and does not finalise', async () => {
    const repoRoot = makeTempRoot('bypass-failed');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    await expect(createProtectedRun(repoRoot).finish('failed', new Error('step failed'))).resolves.toBeUndefined();
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
    expect(listPassedRunLogs(repoRoot)).toBe(false);
  });

  it('TEE-V24-BYPASS-COMMIT-GUARD-008: low-level persist refuses finalised writes without protected finish', () => {
    const repoRoot = makeTempRoot('bypass-guard');
    const head = initGitRepo(repoRoot);
    saveC9State(repoRoot, head);
    const paths = getWorkflowPaths(repoRoot);
    const previous = loadWorkflowReviewStateStrict(paths.statePath);
    const outcome = applyFinaliseProtocolOutcome({
      repoRoot,
      state: previous,
      workstreamId: 'ws_c9',
      outcome: 'passed',
    });
    expect(outcome.record?.phase).toBe('finalised');
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(() =>
      commitFinaliseCorrelationStateAndProtocols({
        repoRoot,
        statePath: paths.statePath,
        previousState: previous,
        nextState: outcome.state,
        workstreamIds: ['ws_c9'],
      })
    ).toThrow(/requires AutomationRun\.finish after C9/i);
    expect(protocolPhase(repoRoot)).toBe('finalise_ready');
    expect(readinessClaimsFinalSuccess(repoRoot)).toBe(false);
  });
});
