import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFinaliseCorrelationToState,
  assertFinaliseAllowedForProtocol,
  correlateFinaliseRun,
  resolveFinaliseWorkstreamMatches,
  shouldApplyFinaliseCorrelation,
} from '@/scripts/automation/workflow-finalise-correlation';
import * as workflowEvents from '@/scripts/automation/workflow-events';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
  upsertWorkstreamRecord,
} from '@/scripts/automation/workflow-events';
import type { WorkflowProtocolRecord, WorkflowWorkstreamRecord } from '@/scripts/automation/types';
import {
  correlateFinaliseAutomationRun,
  readPostRunGitIdentity,
} from '@/scripts/automation/logger';
import {
  getFinaliseRepairCompletePath,
  markFinaliseRepairComplete,
  writeFinaliseFailureArtifact,
} from '@/scripts/automation/finalise-failure';
import {
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';

const tempRoots: string[] = [];

function openWorkstream(
  workstreamId: string,
  branchName: string,
  headCommit: string | null = null
): WorkflowWorkstreamRecord {
  return {
    workstreamId,
    branchName,
    headCommit,
    taskIds: [`task-${workstreamId}`],
    eventIds: [`event-${workstreamId}`],
    status: 'open',
    updatedAt: new Date().toISOString(),
  };
}

function makeProtocol(
  workstreamId: string,
  phase: WorkflowProtocolRecord['phase'],
  checkpointId: string | null = 'ckpt_explicit'
): WorkflowProtocolRecord {
  return {
    schemaVersion: '1',
    workstreamId,
    identityStatus: 'present',
    inheritedFailedReviewCount: 0,
    branchName: 'main',
    baseCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    phase,
    nextAction: phase === 'finalise_ready' ? 'run_finalise' : 'continue',
    failedPremiumReviewCount: 0,
    activeReviewToken: null,
    activeReviewPass: null,
    reviewAttempts: [],
    blockerFamilies: [],
    openBlockerIds: [],
    evidenceManifestPath: null,
    fixDeltaManifestPath: null,
    activeCheckpointId: checkpointId,
    planPath: null,
    updatedAt: new Date().toISOString(),
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('workflow finalise correlation', () => {
  it('TEE-FINALISE-001: prefers explicit finalise_ready context and rejects wrong-phase/stale context', () => {
    let state = createEmptyWorkflowReviewState();
    state = upsertWorkstreamRecord(state, openWorkstream('ws-a', 'main', 'abc'));
    state = upsertWorkstreamRecord(state, openWorkstream('ws-b', 'main', 'abc'));
    state = upsertWorkstreamRecord(state, openWorkstream('ws-other', 'feature/x', 'abc'));

    const none = resolveFinaliseWorkstreamMatches({
      state: createEmptyWorkflowReviewState(),
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'abc',
    });
    expect(none.correlation.matchedBy).toBe('none');
    expect(none.matched).toHaveLength(0);

    const singleState = upsertWorkstreamRecord(
      createEmptyWorkflowReviewState(),
      openWorkstream('ws-only', 'main', 'abc')
    );
    const ancestryOnly = resolveFinaliseWorkstreamMatches({
      state: singleState,
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'abc',
    });
    expect(ancestryOnly.correlation.matchedBy).toBe('none');
    expect(ancestryOnly.correlation.identityStatus).toBe('missing');

    const wrongPhaseState = {
      ...singleState,
      protocolRecords: {
        'ws-only': makeProtocol('ws-only', 'review_closed'),
      },
      activeFinaliseContext: {
        workstreamId: 'ws-only',
        checkpointId: 'ckpt_explicit',
        activatedAt: new Date().toISOString(),
      },
    };
    const rejected = resolveFinaliseWorkstreamMatches({
      state: wrongPhaseState,
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'zzzz',
    });
    expect(rejected.correlation.matchedBy).toBe('none');
    expect(rejected.matched).toHaveLength(0);

    const withContext = {
      ...singleState,
      protocolRecords: {
        'ws-only': makeProtocol('ws-only', 'finalise_ready', 'ckpt_explicit'),
      },
      activeFinaliseContext: {
        workstreamId: 'ws-only',
        checkpointId: 'ckpt_explicit',
        activatedAt: new Date().toISOString(),
      },
    };
    const explicit = resolveFinaliseWorkstreamMatches({
      state: withContext,
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'zzzz',
    });
    expect(explicit.correlation.matchedBy).toBe('explicit_context');
    expect(explicit.correlation.workstreamIds).toEqual(['ws-only']);
    expect(explicit.correlation.checkpointId).toBe('ckpt_explicit');

    const applied = applyFinaliseCorrelationToState({
      state,
      matched: [
        openWorkstream('ws-a', 'main', 'abc'),
        openWorkstream('ws-b', 'main', 'abc'),
      ],
      finaliseRunId: 'run-1',
      finaliseOutcome: 'passed',
      resultingCommit: 'def456',
    });
    expect(applied.workstreams?.['ws-a']?.status).toBe('finalised');
    expect(applied.workstreams?.['ws-b']?.finaliseRunId).toBe('run-1');
    expect(applied.workstreams?.['ws-a']?.finaliseCommit).toBe('def456');
    expect(applied.workstreams?.['ws-other']?.status).toBe('open');

    const staleStartCommit = '0000000000000000000000000000000000000000';
    const identity = readPostRunGitIdentity();
    const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false,
    });
    expect(gitHead.status).toBe(0);
    const currentHead = (gitHead.stdout ?? '').trim();
    expect(identity.headCommit).toBe(currentHead);
    expect(identity.headCommit).not.toBe(staleStartCommit);

    const correlated = correlateFinaliseRun({
      state: singleState,
      repoRoot: process.cwd(),
      finaliseRunId: 'run-finish',
      finaliseOutcome: 'passed',
    });
    expect(correlated.correlation.resultingCommit).toBe(currentHead);

    expect(
      correlateFinaliseAutomationRun({
        scriptName: 'fixerrors',
        status: 'passed',
        runId: 'not-finalise',
        state: singleState,
      })
    ).toBeUndefined();
    expect(
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'dry',
        state: withContext,
        mode: 'dry-run',
        args: ['--dry-run'],
      })
    ).toBeUndefined();
    expect(
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'help',
        state: withContext,
        args: ['--help'],
      })
    ).toBeUndefined();
    expect(shouldApplyFinaliseCorrelation({ scriptName: 'finalise', args: ['--dry-run'] })).toBe(
      false
    );

    const loggerCorrelation = correlateFinaliseAutomationRun({
      scriptName: 'finalise',
      status: 'passed',
      runId: 'logger-finish',
      state: singleState,
    });
    expect(loggerCorrelation?.resultingCommit).toBe(currentHead);
  });

  it('TEE-FINALISE-001: blocks open CRITICAL protocol workstreams that are not finalise_ready', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-gate-'));
    tempRoots.push(repoRoot);
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
    const protocol = makeProtocol('ws_gate_1', 'initialized', null);
    writeProtocolRecord(repoRoot, protocol);
    const paths = getWorkflowPaths(repoRoot);
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { ws_gate_1: protocol },
    });

    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(/finalise-start|phase initialized/iu);

    const ready = makeProtocol('ws_gate_1', 'finalise_ready', 'ckpt_1');
    writeProtocolRecord(repoRoot, ready);
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { ws_gate_1: ready },
      activeFinaliseContext: {
        workstreamId: 'ws_gate_1',
        checkpointId: 'ckpt_1',
        activatedAt: new Date().toISOString(),
      },
    });
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).not.toThrow();
  });

  it('TEE-FINALISE-001: refuses anonymous finalise_ready without matching activeFinaliseContext', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-anon-'));
    tempRoots.push(repoRoot);
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
    const ready = makeProtocol('ws_anon_1', 'finalise_ready', 'ckpt_anon');
    writeProtocolRecord(repoRoot, ready);
    const paths = getWorkflowPaths(repoRoot);
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { ws_anon_1: ready },
      activeFinaliseContext: null,
    });
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /requires matching activeFinaliseContext/iu
    );

    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { ws_anon_1: ready },
      activeFinaliseContext: {
        workstreamId: 'ws_anon_1',
        checkpointId: 'ckpt_other',
        activatedAt: new Date().toISOString(),
      },
    });
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /stale|matching activeFinaliseContext|not finalise_ready/iu
    );
  });

  it('TEE-FINALISE-001: discovers disk-only CRITICAL protocols when state.protocolRecords is partial', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-disk-'));
    tempRoots.push(repoRoot);
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
    const open = makeProtocol('ws_disk_only_1', 'initialized', null);
    writeProtocolRecord(repoRoot, open);
    const paths = getWorkflowPaths(repoRoot);
    // Partial state write: omit protocolRecords entirely even though disk has an open CRITICAL protocol.
    saveWorkflowReviewState(paths.statePath, createEmptyWorkflowReviewState());

    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /CRITICAL workstream ws_disk_only_1|phase initialized/iu
    );
  });

  it('TEE-FINALISE-001: correlates from protocol disk when workstream state record is briefly absent', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-synth-'));
    tempRoots.push(repoRoot);
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
    const ready = makeProtocol('ws_synth_1', 'finalise_ready', 'ckpt_synth');
    writeProtocolRecord(repoRoot, ready);
    const state = {
      ...createEmptyWorkflowReviewState(),
      // No workstreams map entry for ws_synth_1.
      protocolRecords: { ws_synth_1: ready },
      activeFinaliseContext: {
        workstreamId: 'ws_synth_1',
        checkpointId: 'ckpt_synth',
        activatedAt: new Date().toISOString(),
      },
    };
    const matched = resolveFinaliseWorkstreamMatches({
      state,
      repoRoot,
      branchName: 'main',
      headCommit: 'abc123',
    });
    expect(matched.correlation.matchedBy).toBe('explicit_context');
    expect(matched.correlation.identityStatus).toBe('present');
    expect(matched.correlation.workstreamIds).toEqual(['ws_synth_1']);
    expect(matched.matched[0]?.workstreamId).toBe('ws_synth_1');
  });

  it('TEE-FINALISE-001: malformed disk protocol blocks assertFinaliseAllowedForProtocol', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-malformed-'));
    tempRoots.push(repoRoot);
    const workstreamId = 'ws_malformed_1';
    const protocolDir = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      workstreamId
    );
    mkdirSync(protocolDir, { recursive: true });
    writeFileSync(path.join(protocolDir, 'protocol.json'), '{not-valid-json', 'utf8');
    const paths = getWorkflowPaths(repoRoot);
    saveWorkflowReviewState(paths.statePath, createEmptyWorkflowReviewState());

    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /unreadable|malformed|refuse finalise/iu
    );

    writeFileSync(
      path.join(protocolDir, 'protocol.json'),
      JSON.stringify({ schemaVersion: '1', workstreamId }),
      'utf8'
    );
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /malformed|refuse finalise/iu
    );
  });

  it('TEE-FINALISE-001: finish-time correlation failures fail closed and keep repair evidence', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-corr-fail-'));
    tempRoots.push(repoRoot);
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
    const paths = getWorkflowPaths(repoRoot);
    saveWorkflowReviewState(paths.statePath, createEmptyWorkflowReviewState());

    const failure = writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
      workstreamId: 'ws_corr_fail_1',
      checkpointId: 'ckpt_corr_fail_1',
    });
    markFinaliseRepairComplete(repoRoot, failure, { checkpointId: 'ckpt_corr_fail_1' });
    expect(existsSync(getFinaliseRepairCompletePath(repoRoot))).toBe(true);

    const saveSpy = vi
      .spyOn(workflowEvents, 'saveWorkflowReviewState')
      .mockImplementation(() => {
        throw new Error('state-save-boom');
      });

    let thrown: unknown;
    try {
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'run-corr-fail',
        repoRoot,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/state-save-boom/i);
    // Fail closed: no successful correlation object is returned.
    expect(thrown).not.toHaveProperty('matchedBy', 'none');

    expect(existsSync(getFinaliseRepairCompletePath(repoRoot))).toBe(true);

    // Non-finalise automation must remain unaffected.
    expect(
      correlateFinaliseAutomationRun({
        scriptName: 'fixerrors',
        status: 'passed',
        runId: 'not-finalise',
        repoRoot,
      })
    ).toBeUndefined();

    saveSpy.mockRestore();
  });

  it('TEE-FINALISE-001: state-save failure must not leave disk protocol falsely finalised', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-atomic-'));
    tempRoots.push(repoRoot);
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });

    const workstreamId = 'ws_atomic_1';
    const checkpointId = 'ckpt_atomic_1';
    const ready = makeProtocol(workstreamId, 'finalise_ready', checkpointId);
    writeProtocolRecord(repoRoot, ready);

    const paths = getWorkflowPaths(repoRoot);
    let state = createEmptyWorkflowReviewState();
    state = upsertWorkstreamRecord(state, openWorkstream(workstreamId, 'main', 'abc'));
    state = {
      ...state,
      protocolRecords: { [workstreamId]: ready },
      activeFinaliseContext: {
        workstreamId,
        checkpointId,
        activatedAt: new Date().toISOString(),
      },
    };
    saveWorkflowReviewState(paths.statePath, state);

    const saveSpy = vi
      .spyOn(workflowEvents, 'saveWorkflowReviewState')
      .mockImplementation(() => {
        throw new Error('state-save-after-outcome');
      });

    expect(() =>
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'passed',
        runId: 'run-atomic-fail',
        repoRoot,
      })
    ).toThrow(/state-save-after-outcome/i);

    saveSpy.mockRestore();

    const diskProtocol = readProtocolRecord(repoRoot, workstreamId);
    expect(diskProtocol?.phase).toBe('finalise_ready');
    expect(diskProtocol?.activeCheckpointId).toBe(checkpointId);

    // Retry remains possible once state save works again.
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).not.toThrow();
    const retried = correlateFinaliseAutomationRun({
      scriptName: 'finalise',
      status: 'passed',
      runId: 'run-atomic-retry',
      repoRoot,
    });
    expect(retried?.matchedBy).toBe('explicit_context');
    expect(readProtocolRecord(repoRoot, workstreamId)?.phase).toBe('finalised');
    expect(readProtocolRecord(repoRoot, workstreamId)?.activeCheckpointId).toBeNull();
  });
});
