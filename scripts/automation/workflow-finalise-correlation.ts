import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  WorkflowFinaliseCorrelation,
  WorkflowProtocolRecord,
  WorkflowReviewState,
  WorkflowWorkstreamRecord,
} from './types';
import {
  assertSafeOpaqueId,
  extractPlanContractMarker,
  isCriticalPlanContract,
  pathHasSymlinkComponent,
} from './workflow-plan-contract';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
  upsertWorkstreamRecord,
} from './workflow-events';
import {
  applyFinaliseProtocolOutcome,
  getActiveFinaliseContext,
  getProtocolRecordPath,
  isWorkflowProtocolRecord,
  readProtocolRecord,
  resolveProtocolPlanAbsolutePath,
} from './workflow-review-protocol';

function runGit(repoRoot: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim();
}

export function isGitAncestor(params: {
  repoRoot: string;
  ancestorCommit: string;
  descendantCommit: string;
}): boolean {
  if (!params.ancestorCommit || !params.descendantCommit) return false;
  if (params.ancestorCommit === params.descendantCommit) return true;
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', params.ancestorCommit, params.descendantCommit],
    {
      cwd: params.repoRoot,
      encoding: 'utf8',
      shell: false,
    }
  );
  return result.status === 0;
}

function resolveProtocolRecord(
  repoRoot: string,
  state: WorkflowReviewState,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const fromDisk = readProtocolRecord(repoRoot, workstreamId);
  if (fromDisk && isWorkflowProtocolRecord(fromDisk)) return fromDisk;
  const fromState = state.protocolRecords?.[workstreamId];
  return fromState && isWorkflowProtocolRecord(fromState) ? fromState : null;
}

/**
 * Fail closed when protocol.json exists but cannot be parsed/validated.
 * Returns null only when no disk protocol file is present (state fallback allowed).
 */
function requireProtocolRecordForGating(
  repoRoot: string,
  state: WorkflowReviewState,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const diskPath = getProtocolRecordPath(repoRoot, workstreamId);
  if (existsSync(diskPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(diskPath, 'utf8')) as unknown;
    } catch {
      throw new Error(
        `protocol record for ${workstreamId} exists but is unreadable; refuse finalise`
      );
    }
    if (!isWorkflowProtocolRecord(parsed)) {
      throw new Error(
        `protocol record for ${workstreamId} exists but is malformed; refuse finalise`
      );
    }
    return parsed;
  }
  const fromState = state.protocolRecords?.[workstreamId];
  return fromState && isWorkflowProtocolRecord(fromState) ? fromState : null;
}

/** Discover protocol.json records on disk even when state.protocolRecords is partial. */
export function listDiskProtocolWorkstreamIds(repoRoot: string): string[] {
  const root = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
  if (!existsSync(root)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const safe = assertSafeOpaqueId(entry.name, 'workstreamId');
    if (!safe.ok) continue;
    const directory = path.join(root, entry.name);
    if (pathHasSymlinkComponent(directory)) continue;
    if (!existsSync(path.join(directory, 'protocol.json'))) continue;
    ids.push(safe.value);
  }
  return ids;
}

function collectProtocolWorkstreamIds(
  repoRoot: string,
  state: WorkflowReviewState
): string[] {
  const fromState = Object.keys(state.protocolRecords ?? {});
  const fromDisk = listDiskProtocolWorkstreamIds(repoRoot);
  return [...new Set([...fromState, ...fromDisk])].sort();
}

function workstreamRecordFromProtocol(
  protocol: WorkflowProtocolRecord,
  fallbackBranch: string,
  fallbackHead: string
): WorkflowWorkstreamRecord {
  return {
    workstreamId: protocol.workstreamId,
    branchName: protocol.branchName ?? fallbackBranch,
    headCommit: protocol.headCommit ?? fallbackHead,
    taskIds: [],
    eventIds: [],
    status: 'open',
    updatedAt: protocol.updatedAt,
  };
}

/** Protocol-managed workstreams are CRITICAL two-pass unless a plan explicitly says otherwise. */
export function isCriticalProtocolWorkstream(
  repoRoot: string,
  protocol: WorkflowProtocolRecord
): boolean {
  if (!protocol.planPath) {
    return true;
  }
  const absolutePlanPath = resolveProtocolPlanAbsolutePath(repoRoot, protocol.planPath);
  if (!existsSync(absolutePlanPath)) {
    return true;
  }
  try {
    const parsed = extractPlanContractMarker(readFileSync(absolutePlanPath, 'utf8'));
    if (parsed.status !== 'present' || !parsed.contract) {
      return true;
    }
    return isCriticalPlanContract(parsed.contract);
  } catch {
    return true;
  }
}

/**
 * Block mutating finalise when an open CRITICAL protocol workstream is not finalise_ready,
 * when activeFinaliseContext is stale / wrong-phase, or when finalise_ready exists without a
 * matching explicit activeFinaliseContext (no anonymous finalise_ready proceed).
 */
export function assertFinaliseAllowedForProtocol(repoRoot: string): void {
  const paths = getWorkflowPaths(repoRoot);
  const state = loadWorkflowReviewState(paths.statePath);
  const active = getActiveFinaliseContext(state);
  if (active) {
    const protocol = requireProtocolRecordForGating(repoRoot, state, active.workstreamId);
    if (
      !protocol ||
      protocol.phase !== 'finalise_ready' ||
      protocol.activeCheckpointId !== active.checkpointId
    ) {
      throw new Error(
        `active finalise context is stale or not finalise_ready (workstream=${active.workstreamId}, phase=${protocol?.phase ?? 'missing'})`
      );
    }
  }

  for (const workstreamId of collectProtocolWorkstreamIds(repoRoot, state)) {
    const protocol = requireProtocolRecordForGating(repoRoot, state, workstreamId);
    // Skip only when there is truly no protocol file/record to evaluate.
    if (!protocol) continue;
    if (protocol.phase === 'finalised') continue;

    if (protocol.phase === 'finalise_ready') {
      if (
        !active ||
        active.workstreamId !== workstreamId ||
        active.checkpointId !== protocol.activeCheckpointId ||
        !protocol.activeCheckpointId
      ) {
        throw new Error(
          `finalise_ready workstream ${workstreamId} requires matching activeFinaliseContext (checkpoint=${protocol.activeCheckpointId ?? 'missing'})`
        );
      }
      continue;
    }

    if (!isCriticalProtocolWorkstream(repoRoot, protocol)) continue;
    throw new Error(
      `CRITICAL workstream ${workstreamId} is in phase ${protocol.phase}; complete review and run finalise-start before finalise`
    );
  }
}

function explicitContextIsValid(
  repoRoot: string,
  state: WorkflowReviewState,
  workstreamId: string,
  checkpointId: string
): { ok: true; protocol: WorkflowProtocolRecord } | { ok: false; reason: string } {
  const protocol = resolveProtocolRecord(repoRoot, state, workstreamId);
  if (!protocol) {
    return { ok: false, reason: 'protocol-missing' };
  }
  if (protocol.phase !== 'finalise_ready') {
    return { ok: false, reason: `phase=${protocol.phase}` };
  }
  if (protocol.activeCheckpointId !== checkpointId) {
    return { ok: false, reason: 'checkpoint-mismatch' };
  }
  return { ok: true, protocol };
}

export function resolveFinaliseWorkstreamMatches(params: {
  state: WorkflowReviewState;
  repoRoot: string;
  branchName: string;
  headCommit: string;
}): {
  correlation: WorkflowFinaliseCorrelation;
  matched: WorkflowWorkstreamRecord[];
} {
  const active = getActiveFinaliseContext(params.state);
  if (active) {
    const validity = explicitContextIsValid(
      params.repoRoot,
      params.state,
      active.workstreamId,
      active.checkpointId
    );
    if (!validity.ok) {
      return {
        matched: [],
        correlation: {
          workstreamIds: [],
          matchedBy: 'none',
          branchName: params.branchName,
          headCommit: params.headCommit,
          resultingCommit: null,
          identityStatus: 'missing',
          checkpointId: active.checkpointId,
        },
      };
    }
    const record =
      params.state.workstreams?.[active.workstreamId] ??
      workstreamRecordFromProtocol(validity.protocol, params.branchName, params.headCommit);
    return {
      matched: [record],
      correlation: {
        workstreamIds: [record.workstreamId],
        matchedBy: 'explicit_context',
        branchName: params.branchName,
        headCommit: params.headCommit,
        resultingCommit: null,
        identityStatus: 'present',
        checkpointId: active.checkpointId,
      },
    };
  }

  // CRITICAL: never use ancestry/branch heuristics as sole identity.
  return {
    matched: [],
    correlation: {
      workstreamIds: [],
      matchedBy: 'none',
      branchName: params.branchName,
      headCommit: params.headCommit,
      resultingCommit: null,
      identityStatus: 'missing',
      checkpointId: null,
    },
  };
}

export function applyFinaliseCorrelationToState(params: {
  state: WorkflowReviewState;
  matched: WorkflowWorkstreamRecord[];
  finaliseRunId: string;
  finaliseOutcome: 'passed' | 'failed' | 'unknown';
  resultingCommit: string | null;
  repoRoot?: string;
}): WorkflowReviewState {
  let next = params.state;
  const now = new Date().toISOString();
  for (const record of params.matched) {
    next = upsertWorkstreamRecord(next, {
      ...record,
      status: params.finaliseOutcome === 'passed' ? 'finalised' : record.status,
      finaliseRunId: params.finaliseRunId,
      finaliseOutcome: params.finaliseOutcome,
      finaliseCommit: params.resultingCommit ?? undefined,
      updatedAt: now,
    });

    if (params.repoRoot) {
      const protocolResult = applyFinaliseProtocolOutcome({
        repoRoot: params.repoRoot,
        state: next,
        workstreamId: record.workstreamId,
        outcome: params.finaliseOutcome,
        now: () => new Date(now),
      });
      next = protocolResult.state;
    }
  }

  if (
    params.finaliseOutcome === 'passed' &&
    next.activeFinaliseContext &&
    params.matched.some(
      (record) => record.workstreamId === next.activeFinaliseContext?.workstreamId
    )
  ) {
    next = {
      ...next,
      activeFinaliseContext: null,
    };
  }

  return next;
}

export function shouldApplyFinaliseCorrelation(params: {
  scriptName: string;
  mode?: string;
  args?: string[];
}): boolean {
  if (params.scriptName !== 'finalise') return false;
  const args = params.args ?? [];
  if (args.includes('--help') || args.includes('-h') || args.includes('--dry-run')) {
    return false;
  }
  if (params.mode === 'dry-run' || params.mode === 'help') {
    return false;
  }
  return true;
}

export function correlateFinaliseRun(params: {
  state: WorkflowReviewState;
  repoRoot: string;
  finaliseRunId: string;
  finaliseOutcome: 'passed' | 'failed' | 'unknown';
  resultingCommit?: string | null;
}): {
  state: WorkflowReviewState;
  correlation: WorkflowFinaliseCorrelation;
} {
  const branchName =
    runGit(params.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown';
  const headCommit = runGit(params.repoRoot, ['rev-parse', 'HEAD']) ?? '';
  const resultingCommit = params.resultingCommit ?? headCommit;
  const { matched, correlation } = resolveFinaliseWorkstreamMatches({
    state: params.state,
    repoRoot: params.repoRoot,
    branchName,
    headCommit,
  });

  return {
    state: applyFinaliseCorrelationToState({
      state: params.state,
      matched,
      finaliseRunId: params.finaliseRunId,
      finaliseOutcome: params.finaliseOutcome,
      resultingCommit,
      repoRoot: params.repoRoot,
    }),
    correlation: {
      ...correlation,
      resultingCommit,
    },
  };
}
