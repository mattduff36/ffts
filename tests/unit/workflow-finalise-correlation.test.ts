import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFinaliseCorrelationToState,
  assertFinaliseAllowedForProtocol,
  correlateFinaliseRun,
  formatFinaliseProtocolReadinessReport,
  getFinaliseProtocolReadiness,
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
  computeFinaliseAutomationCorrelation,
  readPostRunGitIdentity,
  AutomationRun,
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
  checkpointId: string | null = 'ckpt_explicit',
  extra: Partial<WorkflowProtocolRecord> = {}
): WorkflowProtocolRecord {
  const updatedAt = extra.updatedAt ?? new Date().toISOString();
  const headCommit = extra.headCommit ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const successPhase =
    phase === 'review_closed' || phase === 'finalise_ready' || phase === 'finalised';
  const treeFingerprint =
    extra.reviewedTreeFingerprint ?? (successPhase ? 'b'.repeat(32) : undefined);
  const reviewAttempts =
    extra.reviewAttempts ??
    (successPhase
      ? [
          {
            pass: 'first' as const,
            token: `rev_first_${workstreamId.replace(/[^A-Za-z0-9_-]/g, '_')}`,
            startedAt: updatedAt,
            recordedAt: updatedAt,
            result: 'passed' as const,
            headCommit,
            treeFingerprint: treeFingerprint!,
          },
        ]
      : []);
  return {
    schemaVersion: '1',
    identityStatus: 'present',
    inheritedFailedReviewCount: extra.inheritedFailedReviewCount ?? 0,
    branchName: extra.branchName ?? 'main',
    baseCommit: extra.baseCommit ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headCommit,
    nextAction: extra.nextAction
      ?? (phase === 'finalise_ready'
        ? 'run_finalise'
        : phase === 'split'
          ? 'use_split_workstream'
          : phase === 'review_closed'
            ? 'finalise_start'
            : phase === 'finalised'
              ? 'done'
              : 'continue'),
    failedPremiumReviewCount: extra.failedPremiumReviewCount ?? 0,
    activeReviewToken: extra.activeReviewToken ?? null,
    activeReviewPass: extra.activeReviewPass ?? null,
    reviewAttempts,
    blockerFamilies: extra.blockerFamilies ?? [],
    openBlockerIds: extra.openBlockerIds ?? [],
    evidenceManifestPath: extra.evidenceManifestPath ?? null,
    fixDeltaManifestPath: extra.fixDeltaManifestPath ?? null,
    activeCheckpointId: extra.activeCheckpointId ?? checkpointId,
    planPath: extra.planPath ?? null,
    sourceWorkstreamIds: extra.sourceWorkstreamIds,
    reviewedTreeFingerprint: extra.reviewedTreeFingerprint ?? treeFingerprint ?? null,
    updatedAt,
    workstreamId,
    phase,
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

    const liveHead = (
      spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
      }).stdout ?? ''
    ).trim();
    const liveBranch = (
      spawnSync('git', ['branch', '--show-current'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
      }).stdout ?? ''
    ).trim();
    const withContext = {
      ...singleState,
      protocolRecords: {
        'ws-only': makeProtocol('ws-only', 'finalise_ready', 'ckpt_explicit', {
          branchName: liveBranch,
        }),
      },
      activeFinaliseContext: {
        workstreamId: 'ws-only',
        checkpointId: 'ckpt_explicit',
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: liveHead,
        activatedBranchName: liveBranch,
        ownedCommits: [liveHead],
      },
    };
    const explicit = resolveFinaliseWorkstreamMatches({
      state: withContext,
      repoRoot: process.cwd(),
      branchName: liveBranch,
      headCommit: liveHead,
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

    const loggerCorrelation = computeFinaliseAutomationCorrelation({
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
        activatedHeadCommit: 'abc123',
        activatedBranchName: 'main',
        ownedCommits: ['abc123'],
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
    expect((thrown as Error).message).toMatch(
      /cannot persist independently|use AutomationRun\.finish after C9/i
    );
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

  it('TEE-FINALISE-001: state-save failure must not leave disk protocol falsely finalised', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'finalise-atomic-'));
    tempRoots.push(repoRoot);
    mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
    spawnSync('git', ['init', '-b', 'main'], { cwd: repoRoot, shell: false });
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'],
      { cwd: repoRoot, shell: false }
    );
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
      { cwd: repoRoot, shell: false }
    );
    const head = (
      spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', shell: false })
        .stdout ?? ''
    ).trim();

    const workstreamId = 'ws_atomic_1';
    const checkpointId = 'ckpt_atomic_1';
    const ready = makeProtocol(workstreamId, 'finalise_ready', checkpointId, {
      headCommit: head,
    });
    writeProtocolRecord(repoRoot, ready);

    const paths = getWorkflowPaths(repoRoot);
    let state = createEmptyWorkflowReviewState();
    state = upsertWorkstreamRecord(state, openWorkstream(workstreamId, 'main', head));
    state = {
      ...state,
      protocolRecords: { [workstreamId]: ready },
      activeFinaliseContext: {
        workstreamId,
        checkpointId,
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: head,
        activatedBranchName: 'main',
        ownedCommits: [head],
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
    ).toThrow(/cannot persist independently|use AutomationRun\.finish after C9/i);

    saveSpy.mockRestore();

    const diskProtocol = readProtocolRecord(repoRoot, workstreamId);
    expect(diskProtocol?.phase).toBe('finalise_ready');
    expect(diskProtocol?.activeCheckpointId).toBe(checkpointId);

    // Retry remains possible through the canonical C9-protected finish path.
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).not.toThrow();
    await expect(
      new AutomationRun({
        scriptName: 'finalise',
        mode: 'run',
        args: [],
        persist: true,
        repoRoot,
      }).finish('passed')
    ).resolves.toBeUndefined();
    expect(readProtocolRecord(repoRoot, workstreamId)?.phase).toBe('finalised');
    expect(readProtocolRecord(repoRoot, workstreamId)?.activeCheckpointId).toBeNull();
  });
});

function writeProtocolFixture(
  label: string,
  records: WorkflowProtocolRecord[],
  active?: { workstreamId: string; checkpointId: string }
): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), `${label}-`));
  tempRoots.push(repoRoot);
  mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
  const protocolRecords: Record<string, WorkflowProtocolRecord> = {};
  for (const record of records) {
    writeProtocolRecord(repoRoot, record);
    protocolRecords[record.workstreamId] = record;
  }
  const paths = getWorkflowPaths(repoRoot);
  saveWorkflowReviewState(paths.statePath, {
    ...createEmptyWorkflowReviewState(),
    protocolRecords,
    activeFinaliseContext: active
      ? {
          workstreamId: active.workstreamId,
          checkpointId: active.checkpointId,
          activatedAt: new Date().toISOString(),
        }
      : null,
  });
  return repoRoot;
}

describe('TEE-FINALISE-002 split lineage liveness', () => {
  it('A1: valid split parent + finalise-ready child allows the gate', () => {
    const parent = makeProtocol('ws_split_parent', 'split', null);
    const child = makeProtocol('ws_split_child', 'finalise_ready', 'ckpt_child', {
      sourceWorkstreamIds: ['ws_split_parent'],
    });
    const repoRoot = writeProtocolFixture('split-parent-ready-child', [parent, child], {
      workstreamId: 'ws_split_child',
      checkpointId: 'ckpt_child',
    });
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).not.toThrow();
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(true);
    expect(readiness.lineages.find((row) => row.workstreamId === 'ws_split_parent')?.role).toBe(
      'parked_split_ancestor'
    );
  });

  it('A2: nested split root/child + finalise-ready grandchild allows the gate', () => {
    const root = makeProtocol('ws_c4e8a91b7d203f56', 'split', null, {
      openBlockerIds: ['B-SCH-TEAM-DB-001-SURROGATE'],
    });
    const child = makeProtocol('ws_4c15a6ddf4dcf287', 'split', null, {
      sourceWorkstreamIds: ['ws_c4e8a91b7d203f56'],
      openBlockerIds: ['B-SCH-TEAM-DB-001-SURROGATE'],
    });
    const grandchild = makeProtocol('ws_f56791b006fac275', 'finalise_ready', 'ckpt_leaf', {
      sourceWorkstreamIds: ['ws_4c15a6ddf4dcf287', 'ws_c4e8a91b7d203f56'],
    });
    const repoRoot = writeProtocolFixture(
      'nested-split-ready-grandchild',
      [root, child, grandchild],
      { workstreamId: 'ws_f56791b006fac275', checkpointId: 'ckpt_leaf' }
    );
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).not.toThrow();
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(true);
    expect(
      readiness.lineages.filter((row) => row.role === 'parked_split_ancestor').map((row) => row.workstreamId)
    ).toEqual(['ws_4c15a6ddf4dcf287', 'ws_c4e8a91b7d203f56']);
    expect(readiness.lineages.find((row) => row.workstreamId === 'ws_f56791b006fac275')?.role).toBe(
      'active_leaf'
    );
  });

  it('A3: nested split + review_closed leaf blocks mutating finalise and points at the leaf', () => {
    const root = makeProtocol('ws_root_split', 'split', null);
    const child = makeProtocol('ws_child_split', 'split', null, {
      sourceWorkstreamIds: ['ws_root_split'],
    });
    const leaf = makeProtocol('ws_leaf_closed', 'review_closed', null, {
      sourceWorkstreamIds: ['ws_child_split', 'ws_root_split'],
    });
    const repoRoot = writeProtocolFixture('nested-split-review-closed', [root, child, leaf]);
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /CRITICAL workstream ws_leaf_closed is in phase review_closed|finalise-start --workstream ws_leaf_closed/iu
    );
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(false);
    expect(readiness.blockingWorkstreams.map((row) => row.workstreamId)).toEqual(['ws_leaf_closed']);
    expect(readiness.suggestedActions.some((action) => action.includes('ws_leaf_closed'))).toBe(true);
    expect(readiness.blockingWorkstreams.some((row) => row.workstreamId === 'ws_root_split')).toBe(
      false
    );
    const report = formatFinaliseProtocolReadinessReport(readiness);
    expect(report).toMatch(/Parked split ancestors/i);
    expect(report).toMatch(/finalise-start --workstream ws_leaf_closed/);
  });

  it('A4: orphan split blocks as protocol integrity and is not skipped', () => {
    const orphan = makeProtocol('ws_orphan_split', 'split', null);
    const repoRoot = writeProtocolFixture('orphan-split', [orphan]);
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /orphan split|no valid child continuation|protocol integrity/iu
    );
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.blockingWorkstreams).toHaveLength(1);
    expect(readiness.blockingWorkstreams[0]?.role).toBe('orphan_split');
  });

  it('A5: independent unresolved CRITICAL lineage still blocks', () => {
    const ready = makeProtocol('ws_ready_lineage', 'finalise_ready', 'ckpt_ready');
    const other = makeProtocol('ws_other_critical', 'review_closed', null);
    const repoRoot = writeProtocolFixture('independent-lineages', [ready, other], {
      workstreamId: 'ws_ready_lineage',
      checkpointId: 'ckpt_ready',
    });
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(
      /CRITICAL workstream ws_other_critical is in phase review_closed/iu
    );
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(false);
    expect(readiness.blockingWorkstreams.map((row) => row.workstreamId)).toContain(
      'ws_other_critical'
    );
  });

  it('A7: init-only sibling CRITICAL does not block a matching finalise_ready leaf', () => {
    const ready = makeProtocol('ws_ready_lineage', 'finalise_ready', 'ckpt_ready');
    const unstarted = makeProtocol('ws_unstarted_sibling', 'initialized', null);
    const repoRoot = writeProtocolFixture('unstarted-sibling', [ready, unstarted], {
      workstreamId: 'ws_ready_lineage',
      checkpointId: 'ckpt_ready',
    });
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).not.toThrow();
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(true);
    expect(readiness.blockingWorkstreams).toHaveLength(0);
    expect(readiness.lineages.find((row) => row.workstreamId === 'ws_unstarted_sibling')?.role).toBe(
      'parked_unstarted'
    );
    expect(readProtocolRecord(repoRoot, 'ws_unstarted_sibling')?.phase).toBe('initialized');
    expect(formatFinaliseProtocolReadinessReport(readiness)).toMatch(/Parked unstarted/i);
  });

  it('A6: reports all blockers instead of stopping at the first ID', () => {
    const first = makeProtocol('ws_block_b', 'initialized', null);
    const second = makeProtocol('ws_block_a', 'review_closed', null);
    const repoRoot = writeProtocolFixture('all-blockers', [first, second]);
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.blockingWorkstreams.map((row) => row.workstreamId).sort()).toEqual([
      'ws_block_a',
      'ws_block_b',
    ]);
    const report = formatFinaliseProtocolReadinessReport(readiness);
    expect(report).toMatch(/ws_block_a/);
    expect(report).toMatch(/ws_block_b/);
    expect(() => assertFinaliseAllowedForProtocol(repoRoot)).toThrow(/ws_block_a[\s\S]*ws_block_b|ws_block_b[\s\S]*ws_block_a/u);
  });

  it('D1: readiness evaluation does not mutate protocol records', () => {
    const parent = makeProtocol('ws_parked', 'split', null);
    const leaf = makeProtocol('ws_closed', 'review_closed', null, {
      sourceWorkstreamIds: ['ws_parked'],
    });
    const repoRoot = writeProtocolFixture('readiness-no-mutate', [parent, leaf]);
    const before = readFileSync(
      path.join(repoRoot, 'docs_private', 'automation', 'workstreams', 'ws_parked', 'protocol.json'),
      'utf8'
    );
    getFinaliseProtocolReadiness(repoRoot);
    const after = readFileSync(
      path.join(repoRoot, 'docs_private', 'automation', 'workstreams', 'ws_parked', 'protocol.json'),
      'utf8'
    );
    expect(after).toBe(before);
    expect(readProtocolRecord(repoRoot, 'ws_parked')?.phase).toBe('split');
    expect(shouldApplyFinaliseCorrelation({ scriptName: 'finalise', args: ['--dry-run'] })).toBe(
      false
    );
  });

  it('B4: descendant finalise preserves ancestor split history', () => {
    const parent = makeProtocol('ws_hist_parent', 'split', null, {
      openBlockerIds: ['AUDIT-1'],
    });
    const child = makeProtocol('ws_hist_child', 'finalise_ready', 'ckpt_hist', {
      sourceWorkstreamIds: ['ws_hist_parent'],
    });
    const repoRoot = writeProtocolFixture('preserve-split-history', [parent, child], {
      workstreamId: 'ws_hist_child',
      checkpointId: 'ckpt_hist',
    });
    const state = {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: {
        ws_hist_parent: parent,
        ws_hist_child: child,
      },
      activeFinaliseContext: {
        workstreamId: 'ws_hist_child',
        checkpointId: 'ckpt_hist',
        activatedAt: new Date().toISOString(),
      },
    };
    const next = applyFinaliseCorrelationToState({
      state,
      matched: [
        {
          workstreamId: 'ws_hist_child',
          branchName: 'main',
          headCommit: child.headCommit,
          taskIds: [],
          eventIds: [],
          status: 'open',
          updatedAt: child.updatedAt,
        },
      ],
      finaliseRunId: 'run_hist',
      finaliseOutcome: 'passed',
      resultingCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      repoRoot,
    });
    expect(next.protocolRecords?.ws_hist_child?.phase).toBe('finalised');
    expect(readProtocolRecord(repoRoot, 'ws_hist_parent')?.phase).toBe('split');
    expect(readProtocolRecord(repoRoot, 'ws_hist_parent')?.openBlockerIds).toEqual(['AUDIT-1']);
  });
});

