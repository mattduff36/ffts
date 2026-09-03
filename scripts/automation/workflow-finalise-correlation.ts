import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  WorkflowFinaliseCorrelation,
  WorkflowProtocolPhase,
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
  loadWorkflowReviewStateStrict,
  upsertWorkstreamRecord,
} from './workflow-events';
import {
  applyFinaliseProtocolOutcome,
  getActiveFinaliseContext,
  getProtocolRecordPath,
  hasIncompleteFinalisePassedCommit,
  isWorkflowProtocolRecord,
  readProtocolRecord,
  resolveProtocolPlanAbsolutePath,
  reviewAuthorizesProtectedFinalise,
} from './workflow-review-protocol';
import {
  latestLegalFinalDiffAttempt,
  validateCurrentV24ProtocolRecord,
} from './workflow-v24-protocol-validator';
import {
  inspectCommitAncestry,
  isNonReleaseDispositionPhase,
  lineageBudgetExhausted,
  revalidateRouteDisposition,
} from './workflow-v24-disposition';
import { lastOwnedCommit, readWorkflowGitBinding } from './workflow-git-binding';

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
  const inspection = inspectCommitAncestry(
    params.repoRoot,
    params.ancestorCommit,
    params.descendantCommit
  );
  if (inspection.status === 'error') {
    throw new Error(inspection.message);
  }
  return inspection.status === 'ancestor';
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

/** Discover protocol.json records on disk even when state.protocolRecords is partial. */
export function listDiskProtocolWorkstreamIds(repoRoot: string): string[] {
  return listDiskProtocolInventory(repoRoot).safeWorkstreamIds;
}

export function listDiskProtocolInventory(repoRoot: string): {
  safeWorkstreamIds: string[];
  unsafeDirectoryNames: string[];
} {
  const root = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
  if (!existsSync(root)) return { safeWorkstreamIds: [], unsafeDirectoryNames: [] };
  const safeWorkstreamIds: string[] = [];
  const unsafeDirectoryNames: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name);
    if (pathHasSymlinkComponent(directory) || entry.isSymbolicLink()) {
      unsafeDirectoryNames.push(entry.name);
      continue;
    }
    const safe = assertSafeOpaqueId(entry.name, 'workstreamId');
    if (!safe.ok) {
      unsafeDirectoryNames.push(entry.name);
      continue;
    }
    if (!existsSync(path.join(directory, 'protocol.json'))) continue;
    safeWorkstreamIds.push(safe.value);
  }
  return { safeWorkstreamIds, unsafeDirectoryNames };
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

export type WorkflowProtocolLineageRole =
  | 'active_leaf'
  | 'parked_split_ancestor'
  | 'parked_unstarted'
  | 'orphan_split'
  | 'finalised'
  | 'non_critical'
  | 'other_branch'
  | 'non_release_disposition'
  | 'malformed';

export interface WorkflowProtocolHeadDrift {
  workstreamId: string;
  reviewedHeadCommit: string | null;
  currentHead: string | null;
  extraCommits: string[];
}

export interface WorkflowProtocolReadinessBlocker {
  workstreamId: string;
  role: WorkflowProtocolLineageRole;
  phase: WorkflowProtocolPhase | 'unknown';
  message: string;
  lineageRootWorkstreamId: string | null;
  parentWorkstreamId: string | null;
  childWorkstreamIds: string[];
  nextAction: string | null;
  openBlockerIds: string[];
  suggestedCommands: string[];
}

export interface WorkflowFinaliseProtocolReadiness {
  allowed: boolean;
  currentHead: string | null;
  lineages: WorkflowProtocolReadinessBlocker[];
  blockingWorkstreams: WorkflowProtocolReadinessBlocker[];
  warnings: string[];
  headDrift: WorkflowProtocolHeadDrift[];
  suggestedActions: string[];
}

function immediateParentId(record: WorkflowProtocolRecord): string | null {
  return record.sourceWorkstreamIds?.[0] ?? null;
}

function indexImmediateChildren(
  records: Iterable<WorkflowProtocolRecord>
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const record of records) {
    const parentId = immediateParentId(record);
    if (!parentId) continue;
    const existing = children.get(parentId) ?? [];
    existing.push(record.workstreamId);
    children.set(parentId, existing);
  }
  return children;
}

function lineageRootId(
  record: WorkflowProtocolRecord,
  byId: Map<string, WorkflowProtocolRecord>
): string {
  const seen = new Set<string>();
  let current: WorkflowProtocolRecord | undefined = record;
  while (current) {
    if (seen.has(current.workstreamId)) return current.workstreamId;
    seen.add(current.workstreamId);
    const parentId = immediateParentId(current);
    if (!parentId) return current.workstreamId;
    current = byId.get(parentId);
    if (!current) return parentId;
  }
  return record.workstreamId;
}

function hasAncestorCycle(
  record: WorkflowProtocolRecord,
  byId: Map<string, WorkflowProtocolRecord>
): boolean {
  const seen = new Set<string>();
  let current: WorkflowProtocolRecord | undefined = record;
  while (current) {
    if (seen.has(current.workstreamId)) return true;
    seen.add(current.workstreamId);
    const parentId = immediateParentId(current);
    if (!parentId) return false;
    current = byId.get(parentId);
  }
  return false;
}

export function listCommitsAfter(params: {
  repoRoot: string;
  fromCommit: string;
  toCommit: string;
}): string[] {
  if (!params.fromCommit || !params.toCommit || params.fromCommit === params.toCommit) {
    return [];
  }
  const output = runGit(params.repoRoot, [
    'log',
    '--format=%H',
    `${params.fromCommit}..${params.toCommit}`,
  ]);
  if (!output) return [];
  return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function protocolCommand(workstreamId: string, command: string, extra = ''): string {
  return `npx tsx scripts/workflow-protocol.ts ${command} --workstream ${workstreamId}${extra}`;
}

function protocolDiskStateDiverges(
  disk: WorkflowProtocolRecord,
  fromState: WorkflowProtocolRecord
): boolean {
  return (
    JSON.stringify({
      phase: disk.phase,
      headCommit: disk.headCommit,
      activeCheckpointId: disk.activeCheckpointId,
      nextAction: disk.nextAction,
      sourceWorkstreamIds: [...(disk.sourceWorkstreamIds ?? [])].sort(),
    }) !==
    JSON.stringify({
      phase: fromState.phase,
      headCommit: fromState.headCommit,
      activeCheckpointId: fromState.activeCheckpointId,
      nextAction: fromState.nextAction,
      sourceWorkstreamIds: [...(fromState.sourceWorkstreamIds ?? [])].sort(),
    })
  );
}

function loadGatedProtocol(
  repoRoot: string,
  state: WorkflowReviewState,
  workstreamId: string
):
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'malformed' }
  | { status: 'divergence'; protocol: WorkflowProtocolRecord }
  | { status: 'ok'; protocol: WorkflowProtocolRecord } {
  const diskPath = getProtocolRecordPath(repoRoot, workstreamId);
  const fromState = state.protocolRecords?.[workstreamId];
  if (existsSync(diskPath)) {
    try {
      const parsed = JSON.parse(readFileSync(diskPath, 'utf8')) as unknown;
      if (!isWorkflowProtocolRecord(parsed)) return { status: 'malformed' };
      if (
        parsed.phase === 'review_closed' ||
        parsed.phase === 'finalise_ready' ||
        parsed.phase === 'finalised'
      ) {
        if (!validateCurrentV24ProtocolRecord(parsed).ok) return { status: 'malformed' };
      }
      if (
        fromState &&
        isWorkflowProtocolRecord(fromState) &&
        protocolDiskStateDiverges(parsed, fromState)
      ) {
        return { status: 'divergence', protocol: parsed };
      }
      return { status: 'ok', protocol: parsed };
    } catch {
      return { status: 'unreadable' };
    }
  }
  if (fromState && isWorkflowProtocolRecord(fromState)) {
    return { status: 'divergence', protocol: fromState };
  }
  if (fromState) return { status: 'malformed' };
  return { status: 'missing' };
}

function isUnstartedInitializedProtocol(protocol: WorkflowProtocolRecord): boolean {
  return (
    protocol.phase === 'initialized' &&
    protocol.activeCheckpointId == null &&
    protocol.activeReviewToken == null &&
    protocol.reviewAttempts.length === 0
  );
}

function hasMatchingFinaliseReadyContext(
  active: { workstreamId: string; checkpointId: string } | null,
  byId: Map<string, WorkflowProtocolRecord>
): boolean {
  if (!active) return false;
  const ready = byId.get(active.workstreamId);
  return Boolean(
    ready &&
      ready.phase === 'finalise_ready' &&
      ready.activeCheckpointId === active.checkpointId
  );
}

function makeBlocker(params: {
  workstreamId: string;
  role: WorkflowProtocolLineageRole;
  phase: WorkflowProtocolPhase | 'unknown';
  message: string;
  protocol?: WorkflowProtocolRecord | null;
  byId?: Map<string, WorkflowProtocolRecord>;
  childWorkstreamIds?: string[];
  suggestedCommands?: string[];
}): WorkflowProtocolReadinessBlocker {
  const parentWorkstreamId = params.protocol ? immediateParentId(params.protocol) : null;
  return {
    workstreamId: params.workstreamId,
    role: params.role,
    phase: params.phase,
    message: params.message,
    lineageRootWorkstreamId: params.protocol && params.byId
      ? lineageRootId(params.protocol, params.byId)
      : params.workstreamId,
    parentWorkstreamId,
    childWorkstreamIds: params.childWorkstreamIds ?? [],
    nextAction: params.protocol?.nextAction ?? null,
    openBlockerIds: params.protocol?.openBlockerIds ?? [],
    suggestedCommands: params.suggestedCommands ?? [],
  };
}

/**
 * Read-only protocol gate evaluation. Reports every relevant lineage/blocker.
 * Does not mutate protocol JSON or workflow state.
 */
export function getFinaliseProtocolReadiness(repoRoot: string): WorkflowFinaliseProtocolReadiness {
  const paths = getWorkflowPaths(repoRoot);
  const state = loadWorkflowReviewStateStrict(paths.statePath);
  const git = readWorkflowGitBinding(repoRoot);
  const currentHead = git.headCommit;
  const currentBranch = git.branchName;
  const active = getActiveFinaliseContext(state);
  const lineages: WorkflowProtocolReadinessBlocker[] = [];
  const blockingWorkstreams: WorkflowProtocolReadinessBlocker[] = [];
  const warnings: string[] = [];
  const headDrift: WorkflowProtocolHeadDrift[] = [];
  const suggestedActions: string[] = [];

  const loaded: Array<{
    workstreamId: string;
    protocol: WorkflowProtocolRecord | null;
    loadStatus: 'ok' | 'missing' | 'unreadable' | 'malformed' | 'divergence';
  }> = [];
  for (const workstreamId of collectProtocolWorkstreamIds(repoRoot, state)) {
    const loadedRecord = loadGatedProtocol(repoRoot, state, workstreamId);
    if (loadedRecord.status === 'ok' || loadedRecord.status === 'divergence') {
      loaded.push({
        workstreamId,
        protocol: loadedRecord.protocol,
        loadStatus: loadedRecord.status,
      });
    } else {
      loaded.push({
        workstreamId,
        protocol: null,
        loadStatus: loadedRecord.status,
      });
    }
  }

  const byId = new Map<string, WorkflowProtocolRecord>();
  for (const row of loaded) {
    if (row.protocol) byId.set(row.workstreamId, row.protocol);
  }
  const children = indexImmediateChildren(byId.values());

  const pushBlocker = (blocker: WorkflowProtocolReadinessBlocker): void => {
    lineages.push(blocker);
    blockingWorkstreams.push(blocker);
    suggestedActions.push(...blocker.suggestedCommands);
  };

  const inventory = listDiskProtocolInventory(repoRoot);
  for (const name of inventory.unsafeDirectoryNames) {
    pushBlocker(
      makeBlocker({
        workstreamId: name,
        role: 'malformed',
        phase: 'unknown',
        message: `protocol directory ${name} is unsafe or malformed; refuse finalise`,
      })
    );
  }

  if (existsSync(path.join(repoRoot, '.git')) && (git.detached || !currentBranch)) {
    pushBlocker(
      makeBlocker({
        workstreamId: 'git-binding',
        role: 'malformed',
        phase: 'unknown',
        message: 'HEAD is detached or the current branch is missing; refuse finalise',
      })
    );
  }

  if (hasIncompleteFinalisePassedCommit(repoRoot)) {
    pushBlocker(
      makeBlocker({
        workstreamId: 'finalise-passed-commit',
        role: 'malformed',
        phase: 'unknown',
        message:
          'incomplete protected finalise passed commit; refuse finalise until the pending transaction is recovered',
      })
    );
  }

  if (active) {
    const protocol = byId.get(active.workstreamId);
    if (
      !protocol ||
      protocol.phase !== 'finalise_ready' ||
      protocol.activeCheckpointId !== active.checkpointId
    ) {
      pushBlocker(
        makeBlocker({
          workstreamId: active.workstreamId,
          role: 'active_leaf',
          phase: protocol?.phase ?? 'unknown',
          message: `active finalise context is stale or not finalise_ready (workstream=${active.workstreamId}, phase=${protocol?.phase ?? 'missing'})`,
          protocol,
          byId,
          childWorkstreamIds: children.get(active.workstreamId) ?? [],
        })
      );
    }
  }

  for (const row of loaded) {
    if (row.loadStatus === 'unreadable') {
      pushBlocker(
        makeBlocker({
          workstreamId: row.workstreamId,
          role: 'malformed',
          phase: 'unknown',
          message: `protocol record for ${row.workstreamId} exists but is unreadable; refuse finalise`,
        })
      );
      continue;
    }
    if (row.loadStatus === 'malformed') {
      pushBlocker(
        makeBlocker({
          workstreamId: row.workstreamId,
          role: 'malformed',
          phase: 'unknown',
          message: `protocol record for ${row.workstreamId} exists but is malformed; refuse finalise`,
        })
      );
      continue;
    }
    if (row.loadStatus === 'divergence') {
      pushBlocker(
        makeBlocker({
          workstreamId: row.workstreamId,
          role: 'malformed',
          phase: row.protocol?.phase ?? 'unknown',
          message: `protocol record for ${row.workstreamId} diverges from workflow review state; refuse finalise`,
          protocol: row.protocol,
          byId,
        })
      );
      continue;
    }
    const protocol = row.protocol;
    if (!protocol) continue;

    const childWorkstreamIds = (children.get(protocol.workstreamId) ?? []).filter((id) =>
      byId.has(id)
    );

    if (isNonReleaseDispositionPhase(protocol.phase)) {
      const disposition = revalidateRouteDisposition({ repoRoot, record: protocol });
      if (!disposition.ok) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'malformed',
            phase: protocol.phase,
            message: `non-release disposition for ${protocol.workstreamId} failed Git evidence revalidation: ${disposition.message}`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'non_release_disposition',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is routed as ${protocol.phase}; not approval and not independently finalised`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    const parentId = immediateParentId(protocol);
    if (parentId && !byId.has(parentId)) {
      pushBlocker(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'malformed',
          phase: protocol.phase,
          message: `CRITICAL workstream ${protocol.workstreamId} has dangling parent ${parentId}; protocol integrity error`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (protocol.phase === 'finalised') {
      if (hasIncompleteFinalisePassedCommit(repoRoot)) {
        continue;
      }
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'finalised',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is finalised`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (protocol.phase === 'split') {
      if (hasAncestorCycle(protocol, byId)) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'orphan_split',
            phase: protocol.phase,
            message: `CRITICAL workstream ${protocol.workstreamId} is in phase split with a lineage cycle; protocol integrity error`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      if (childWorkstreamIds.length === 0) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'orphan_split',
            phase: protocol.phase,
            message: `CRITICAL workstream ${protocol.workstreamId} is in phase split with no valid child continuation (orphan split); protocol integrity error`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      if (childWorkstreamIds.length > 1) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'orphan_split',
            phase: protocol.phase,
            message: `CRITICAL workstream ${protocol.workstreamId} is in phase split with ambiguous children ${childWorkstreamIds.join(', ')}; protocol integrity error`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      const parked = makeBlocker({
        workstreamId: protocol.workstreamId,
        role: 'parked_split_ancestor',
        phase: protocol.phase,
        message: `split ancestor ${protocol.workstreamId} is parked historical state; continuation ${childWorkstreamIds.join(', ')} owns completion`,
        protocol,
        byId,
        childWorkstreamIds,
      });
      lineages.push(parked);
      if (protocol.openBlockerIds.length > 0) {
        warnings.push(
          `parked split ancestor ${protocol.workstreamId} retains audit blockers ${protocol.openBlockerIds.join(', ')}; they do not independently block finalise`
        );
      }
      continue;
    }

    if (!isCriticalProtocolWorkstream(repoRoot, protocol)) {
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'non_critical',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is not CRITICAL`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (
      isUnstartedInitializedProtocol(protocol) &&
      active &&
      hasMatchingFinaliseReadyContext(active, byId) &&
      active.workstreamId !== protocol.workstreamId
    ) {
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'parked_unstarted',
          phase: protocol.phase,
          message: `unstarted CRITICAL workstream ${protocol.workstreamId} is parked historical init-only state; ${active.workstreamId} owns the current finalise. It was not marked finalised.`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      warnings.push(
        `parked unstarted workstream ${protocol.workstreamId} remains phase initialized; complete or abandon it after this release`
      );
      continue;
    }

    if (protocol.phase === 'routing_required' || lineageBudgetExhausted(protocol)) {
      pushBlocker(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'active_leaf',
          phase: protocol.phase,
          message: `CRITICAL workstream ${protocol.workstreamId} has exhausted its lineage premium review budget (phase ${protocol.phase}); route, isolate, or prove removal from release`,
          protocol,
          byId,
          childWorkstreamIds,
          suggestedCommands: [
            protocolCommand(protocol.workstreamId, 'route', ' --disposition <target> --reason <text>'),
          ],
        })
      );
      continue;
    }

    const boundToOtherBranch = Boolean(
      protocol.branchName && currentBranch && protocol.branchName !== currentBranch
    );
    if (boundToOtherBranch && active?.workstreamId !== protocol.workstreamId) {
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'other_branch',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is bound to branch ${protocol.branchName}; current branch is ${currentBranch}`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (protocol.phase === 'finalise_ready') {
      const contextMatches = Boolean(
        active &&
          active.workstreamId === protocol.workstreamId &&
          active.checkpointId === protocol.activeCheckpointId &&
          protocol.activeCheckpointId
      );
      if (!contextMatches) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'active_leaf',
            phase: protocol.phase,
            message: `finalise_ready workstream ${protocol.workstreamId} requires matching activeFinaliseContext (checkpoint=${protocol.activeCheckpointId ?? 'missing'})`,
            protocol,
            byId,
            childWorkstreamIds,
            suggestedCommands: [
              protocolCommand(protocol.workstreamId, 'finalise-start'),
            ],
          })
        );
        continue;
      }
      const latestLegal = latestLegalFinalDiffAttempt(protocol);
      if (!latestLegal.ok) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'malformed',
            phase: protocol.phase,
            message: `protocol record for ${protocol.workstreamId} has malformed legal final-diff ordering; refuse finalise`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      if (!reviewAuthorizesProtectedFinalise(protocol)) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'active_leaf',
            phase: protocol.phase,
            message: `CRITICAL workstream ${protocol.workstreamId} latest legal premium final-diff attempt does not authorize protected finalise`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      if (
        currentHead &&
        protocol.headCommit &&
        protocol.headCommit !== currentHead
      ) {
        const extraCommits = listCommitsAfter({
          repoRoot,
          fromCommit: protocol.headCommit,
          toCommit: currentHead,
        });
        headDrift.push({
          workstreamId: protocol.workstreamId,
          reviewedHeadCommit: protocol.headCommit,
          currentHead,
          extraCommits,
        });
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'active_leaf',
            phase: protocol.phase,
            message: `HEAD has moved since the reviewed commit ${protocol.headCommit}; current HEAD is ${currentHead}; extra commits: ${extraCommits.join(', ') || 'unable to list'}. Run ${protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta')} then retry finalise-start. Do not rewrite review metadata to the current HEAD.`,
            protocol,
            byId,
            childWorkstreamIds,
            suggestedCommands: [
              protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta'),
            ],
          })
        );
        continue;
      }
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'active_leaf',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is finalise_ready with matching activeFinaliseContext`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    const suggestedCommands: string[] = [];
    if (protocol.phase === 'review_closed') {
      if (
        currentHead &&
        protocol.headCommit &&
        protocol.headCommit !== currentHead
      ) {
        const extraCommits = listCommitsAfter({
          repoRoot,
          fromCommit: protocol.headCommit,
          toCommit: currentHead,
        });
        headDrift.push({
          workstreamId: protocol.workstreamId,
          reviewedHeadCommit: protocol.headCommit,
          currentHead,
          extraCommits,
        });
        suggestedCommands.push(
          protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta')
        );
      }
      suggestedCommands.push(protocolCommand(protocol.workstreamId, 'finalise-start'));
    }

    pushBlocker(
      makeBlocker({
        workstreamId: protocol.workstreamId,
        role: 'active_leaf',
        phase: protocol.phase,
        message: `CRITICAL workstream ${protocol.workstreamId} is in phase ${protocol.phase}; complete review and run finalise-start before finalise`,
        protocol,
        byId,
        childWorkstreamIds,
        suggestedCommands,
      })
    );
  }

  const uniqueActions = [...new Set(suggestedActions)];
  return {
    allowed: blockingWorkstreams.length === 0,
    currentHead,
    lineages,
    blockingWorkstreams,
    warnings,
    headDrift,
    suggestedActions: uniqueActions,
  };
}

export function formatFinaliseProtocolReadinessReport(
  readiness: WorkflowFinaliseProtocolReadiness
): string {
  const lines: string[] = [
    `Protocol readiness: ${readiness.allowed ? 'allowed' : 'blocked'}`,
  ];
  if (readiness.currentHead) {
    lines.push(`Current HEAD: ${readiness.currentHead}`);
  }
  const parked = readiness.lineages.filter((row) => row.role === 'parked_split_ancestor');
  if (parked.length > 0) {
    lines.push('Parked split ancestors (historical, not independent finalise blockers):');
    for (const row of parked) {
      lines.push(
        `- ${row.workstreamId} phase=${row.phase} parent=${row.parentWorkstreamId ?? 'none'} children=${row.childWorkstreamIds.join(',') || 'none'} next=${row.nextAction ?? 'n/a'}`
      );
    }
  }
  const parkedUnstarted = readiness.lineages.filter((row) => row.role === 'parked_unstarted');
  if (parkedUnstarted.length > 0) {
    lines.push('Parked unstarted workstreams (init-only, not independent finalise blockers):');
    for (const row of parkedUnstarted) {
      lines.push(
        `- ${row.workstreamId} phase=${row.phase} next=${row.nextAction ?? 'n/a'}`
      );
    }
  }
  if (readiness.blockingWorkstreams.length > 0) {
    lines.push('Blockers:');
    for (const blocker of readiness.blockingWorkstreams) {
      lines.push(
        `- ${blocker.workstreamId} role=${blocker.role} phase=${blocker.phase} root=${blocker.lineageRootWorkstreamId ?? blocker.workstreamId} parent=${blocker.parentWorkstreamId ?? 'none'} next=${blocker.nextAction ?? 'n/a'}`
      );
      lines.push(`  ${blocker.message}`);
      if (blocker.suggestedCommands.length > 0) {
        lines.push(`  ${blocker.suggestedCommands.join(' ; ')}`);
      }
    }
  }
  for (const drift of readiness.headDrift) {
    lines.push(
      `HEAD drift for ${drift.workstreamId}: reviewed=${drift.reviewedHeadCommit ?? 'missing'} current=${drift.currentHead ?? 'missing'} extra=${drift.extraCommits.join(', ') || 'unable to list'}`
    );
  }
  for (const warning of readiness.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  return lines.join('\n');
}

/**
 * Block mutating finalise when an open CRITICAL protocol workstream is not finalise_ready,
 * when activeFinaliseContext is stale / wrong-phase, or when finalise_ready exists without a
 * matching explicit activeFinaliseContext (no anonymous finalise_ready proceed).
 * Valid split ancestors are parked history; orphan splits remain protocol-integrity blockers.
 * Init-only CRITICAL workstreams (phase initialized, no review/checkpoint) do not
 * independently block a different matching finalise_ready lineage.
 */
export function assertFinaliseAllowedForProtocol(repoRoot: string): void {
  const readiness = getFinaliseProtocolReadiness(repoRoot);
  if (!readiness.allowed) {
    throw new Error(formatFinaliseProtocolReadinessReport(readiness));
  }
}

function explicitContextIsValid(
  repoRoot: string,
  state: WorkflowReviewState,
  workstreamId: string,
  checkpointId: string,
  branchName: string,
  headCommit: string
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
  const active = getActiveFinaliseContext(state);
  if (!active || active.workstreamId !== workstreamId || active.checkpointId !== checkpointId) {
    return { ok: false, reason: 'active-context-mismatch' };
  }
  if (!branchName || branchName === 'unknown' || branchName === 'HEAD') {
    return { ok: false, reason: 'missing-branch' };
  }
  if (!headCommit) {
    return { ok: false, reason: 'missing-head' };
  }
  if (protocol.branchName && protocol.branchName !== branchName) {
    return { ok: false, reason: 'branch-mismatch' };
  }
  if (!active.activatedHeadCommit) {
    return { ok: false, reason: 'missing-activated-head' };
  }
  if (active.activatedBranchName && active.activatedBranchName !== branchName) {
    return { ok: false, reason: 'activated-branch-mismatch' };
  }
  const expectedHead = lastOwnedCommit(active.ownedCommits, active.activatedHeadCommit);
  if (!expectedHead || headCommit !== expectedHead) {
    return { ok: false, reason: 'owned-head-mismatch' };
  }
  if (existsSync(path.join(repoRoot, '.git'))) {
    const git = readWorkflowGitBinding(repoRoot);
    if (git.detached || !git.branchName || !git.headCommit) {
      return { ok: false, reason: 'git-binding' };
    }
    if (git.branchName !== branchName || git.headCommit !== headCommit) {
      return { ok: false, reason: 'live-git-mismatch' };
    }
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
      active.checkpointId,
      params.branchName,
      params.headCommit
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
