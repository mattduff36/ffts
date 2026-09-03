import { createHash, randomBytes } from 'crypto';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import type {
  WorkflowActiveFinaliseContext,
  WorkflowProtocolPhase,
  WorkflowProtocolRecord,
  WorkflowProtocolReviewAttempt,
  WorkflowProtocolReviewPass,
  WorkflowRehomeProvenance,
  WorkflowReviewState,
  WorkflowRouteDispositionTarget,
} from './types';
import {
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  saveWorkflowReviewState,
  upsertWorkstreamRecord,
  withWorkflowLock,
  writeJsonAtomic,
} from './workflow-events';
import {
  assertSafeOpaqueId,
  extractPlanContractMarker,
  isCriticalPlanContract,
  parseOptionalRehomeProvenance,
  resolvePlanPath,
  resolveRequiredTestIdsForWorkstream,
  getArchitectureGateDecision,
  pathHasExistingSymlinkComponent,
} from './workflow-plan-contract';
import { resolveCanonicalReviewRequiredIds } from './workflow-v24-required-id-set';
import {
  latestLegalFinalDiffAttempt,
  validateCurrentV24ProtocolRecord,
  validateWorkflowProtocolRecordStructure,
} from './workflow-v24-protocol-validator';
import {
  assertCandidateTypecheckLintEvidence,
  getCurrentTreeFingerprint,
  recomputeManifestProvenIds,
  type EvidenceCommandResult,
} from './workflow-evidence-manifest';
import {
  assertReviewCandidateFrozen,
  inspectCandidateGitScope,
  requiredTestIdsForBlocker,
} from './workflow-verification-ledger';
import {
  appendOwnedCommit,
  assertNamedBranchForInit,
  assertProtocolGitBinding,
  lastOwnedCommit,
  readWorkflowGitBinding,
} from './workflow-git-binding';
import {
  buildBoundRehomeProvenance,
  buildRouteDisposition,
  computeWorkingTreeProductFingerprint,
  isApprovalValidReviewEvidence,
  isNonReleaseDispositionPhase,
  lineageBudgetExhausted,
  lineageFailedPremiumReviewCount,
  lineageFirstConsumed,
  planRequiresBoundRehome,
  resolveCommitObject,
  revalidateBoundRehomeProvenance,
} from './workflow-v24-disposition';

/** Resolve a protocol-stored planPath (repo-relative POSIX or legacy absolute) to an absolute path. */
export function resolveProtocolPlanAbsolutePath(
  repoRoot: string,
  planPath: string
): string {
  return path.isAbsolute(planPath) ? planPath : path.resolve(repoRoot, planPath);
}

function toRepoRelativePosixPath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

export const WORKFLOW_PROTOCOL_VERSION = '1' as const;
export const WORKFLOW_ROUTING_REQUIRED_EXIT_CODE = 2;

export type WorkflowProtocolCommand =
  | 'init'
  | 'preflight-record'
  | 'review-start'
  | 'review-record'
  | 'fix-record'
  | 'split'
  | 'route'
  | 'rehome-bind'
  | 'finalise-start'
  | 'status';

export interface WorkflowProtocolTransitionResult {
  ok: boolean;
  exitCode: number;
  record: WorkflowProtocolRecord | null;
  message: string;
  reviewToken?: string;
  checkpointId?: string;
  splitWorkstreamId?: string;
  childRecord?: WorkflowProtocolRecord;
}

function isLiveWorkflowRuntimePath(relative: string): boolean {
  return (
    /^docs_private\/automation\/workstreams\/[^/]+\/protocol\.json$/u.test(relative) ||
    relative === 'docs_private/automation/knowledge/workflow-review-state.json' ||
    relative === 'docs_private/automation/knowledge/workflow-review.lock' ||
    relative.startsWith('docs_private/automation/runs/') ||
    relative.startsWith('docs_private/automation/reviews/') ||
    relative.startsWith('docs_private/automation/follow-ups/')
  );
}

function nowIso(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
}

function createToken(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function createCheckpointId(workstreamId: string): string {
  const stamp = Date.now().toString(36);
  return `ckpt_${workstreamId}_${stamp}_${randomBytes(4).toString('hex')}`;
}

function runGit(repoRoot: string, args: string[]): string | null {
  // Lazy require to keep unit tests free of spawn unless needed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

function requireSafeOpaqueId(workstreamId: string, fieldName = 'workstreamId'): string {
  const checked = assertSafeOpaqueId(workstreamId, fieldName);
  if (!checked.ok) {
    throw new Error(checked.error);
  }
  return checked.value;
}

export function getProtocolDirectory(repoRoot: string, workstreamId: string): string {
  const safeId = requireSafeOpaqueId(workstreamId);
  return path.join(repoRoot, 'docs_private', 'automation', 'workstreams', safeId);
}

export function getProtocolRecordPath(repoRoot: string, workstreamId: string): string {
  return path.join(getProtocolDirectory(repoRoot, workstreamId), 'protocol.json');
}

export function createEmptyProtocolRecord(params: {
  workstreamId: string;
  baseCommit: string;
  branchName?: string | null;
  headCommit?: string | null;
  planPath?: string | null;
  sourceWorkstreamIds?: string[];
  inheritedFailedReviewCount?: number;
  rehomeProvenance?: WorkflowRehomeProvenance | null;
  now?: () => Date;
}): WorkflowProtocolRecord {
  return {
    schemaVersion: WORKFLOW_PROTOCOL_VERSION,
    workstreamId: params.workstreamId,
    identityStatus: 'present',
    sourceWorkstreamIds: params.sourceWorkstreamIds,
    inheritedFailedReviewCount: params.inheritedFailedReviewCount ?? 0,
    branchName: params.branchName ?? null,
    baseCommit: params.baseCommit,
    headCommit: params.headCommit ?? null,
    phase: 'initialized',
    nextAction: 'run_preflight',
    failedPremiumReviewCount: params.inheritedFailedReviewCount ?? 0,
    activeReviewToken: null,
    activeReviewPass: null,
    reviewAttempts: [],
    blockerFamilies: [],
    openBlockerIds: [],
    evidenceManifestPath: null,
    fixDeltaManifestPath: null,
    activeCheckpointId: null,
    planPath: params.planPath ?? null,
    rehomeProvenance: params.rehomeProvenance ?? null,
    routeDisposition: null,
    updatedAt: nowIso(params.now),
  };
}

function normalizeBoundPlanPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/').trim();
  return normalized || null;
}

function rehomeBindingKey(provenance: WorkflowRehomeProvenance): string {
  return [
    provenance.predecessorRootWorkstreamId,
    provenance.predecessorDescendantWorkstreamId,
    provenance.predecessorHeadCommit,
    provenance.predecessorReleaseContext,
    provenance.successorBranchName,
    provenance.successorBaselineCommit,
    provenance.sourcePatchSha256,
    provenance.sourceProductTreeFingerprint,
    provenance.sourceReleaseContext ?? '',
    provenance.sourceHeadCommit ?? '',
    provenance.sourceBaselineCommit ?? '',
    provenance.sourceReviewWorkstreamId ?? '',
  ].join('\0');
}

function boundSecurityFieldConflict(
  existing: WorkflowRehomeProvenance,
  incoming: WorkflowRehomeProvenance
): string | null {
  const comparisons: Array<[string, unknown, unknown]> = [
    ['predecessorRootWorkstreamId', existing.predecessorRootWorkstreamId, incoming.predecessorRootWorkstreamId],
    ['predecessorDescendantWorkstreamId', existing.predecessorDescendantWorkstreamId, incoming.predecessorDescendantWorkstreamId],
    ['predecessorHeadCommit', existing.predecessorHeadCommit, incoming.predecessorHeadCommit],
    ['predecessorReleaseContext', existing.predecessorReleaseContext, incoming.predecessorReleaseContext],
    ['successorBranchName', existing.successorBranchName, incoming.successorBranchName],
    ['successorBaselineCommit', existing.successorBaselineCommit, incoming.successorBaselineCommit],
    ['sourcePatchSha256', existing.sourcePatchSha256, incoming.sourcePatchSha256],
    ['sourceProductTreeFingerprint', existing.sourceProductTreeFingerprint, incoming.sourceProductTreeFingerprint],
  ];
  for (const [label, left, right] of comparisons) {
    if (right && left !== right) return label;
  }
  if (incoming.sourceReleaseContext && incoming.sourceReleaseContext !== existing.sourceReleaseContext) {
    return 'sourceReleaseContext';
  }
  if (incoming.sourceHeadCommit && incoming.sourceHeadCommit !== existing.sourceHeadCommit) {
    return 'sourceHeadCommit';
  }
  if (incoming.sourceBaselineCommit && incoming.sourceBaselineCommit !== existing.sourceBaselineCommit) {
    return 'sourceBaselineCommit';
  }
  if (
    incoming.sourceReviewWorkstreamId &&
    incoming.sourceReviewWorkstreamId !== existing.sourceReviewWorkstreamId
  ) {
    return 'sourceReviewWorkstreamId';
  }
  if (incoming.predecessorHeadIsAncestor !== false && incoming.predecessorHeadIsAncestor !== existing.predecessorHeadIsAncestor) {
    return 'predecessorHeadIsAncestor';
  }
  return null;
}

function mergeInitializedSecurityBindings(params: {
  repoRoot: string;
  existing: WorkflowProtocolRecord;
  incomingPlanPath: string | null;
  incomingRehome: WorkflowRehomeProvenance | null;
  incomingBaseCommit: string;
  incomingBranchName: string;
  incomingHeadCommit: string | null;
  incomingSourceWorkstreamIds?: string[];
  inheritedFailedReviewCount: number;
}): { ok: true; record: WorkflowProtocolRecord } | { ok: false; message: string } {
  const existing = params.existing;
  const existingPlanPath = normalizeBoundPlanPath(existing.planPath);
  const incomingPlanPath = normalizeBoundPlanPath(params.incomingPlanPath);
  if (existingPlanPath && incomingPlanPath && existingPlanPath !== incomingPlanPath) {
    return {
      ok: false,
      message: `re-init planPath conflict: existing ${existingPlanPath} incoming ${incomingPlanPath}`,
    };
  }

  if (existing.rehomeProvenance) {
    if (existing.rehomeProvenance.status === 'bound') {
      const bound = revalidateBoundRehomeProvenance({
        repoRoot: params.repoRoot,
        provenance: existing.rehomeProvenance,
      });
      if (!bound.ok) {
        return {
          ok: false,
          message: `existing rehome provenance is malformed; refuse to erase: ${bound.message}`,
        };
      }
    } else {
      const parsedExisting = parseOptionalRehomeProvenance({
        ...existing.rehomeProvenance,
        predecessorPassedReview: false,
        predecessorHeadIsAncestor: false,
      });
      if (parsedExisting.errors.length > 0) {
        return {
          ok: false,
          message: `existing rehome provenance is malformed; refuse to erase: ${parsedExisting.errors.join('; ')}`,
        };
      }
    }
    if (params.incomingRehome) {
      const fieldConflict = boundSecurityFieldConflict(
        existing.rehomeProvenance,
        params.incomingRehome
      );
      if (
        fieldConflict ||
        rehomeBindingKey(existing.rehomeProvenance) !== rehomeBindingKey(params.incomingRehome)
      ) {
        return {
          ok: false,
          message: `re-init cannot replace bound security field ${fieldConflict ?? 'identity'}`,
        };
      }
    }
  }

  if (existing.branchName && existing.branchName !== params.incomingBranchName) {
    return {
      ok: false,
      message: `re-init cannot rebind branch ${existing.branchName} to ${params.incomingBranchName}`,
    };
  }
  if (existing.baseCommit && existing.baseCommit !== params.incomingBaseCommit) {
    return {
      ok: false,
      message: `re-init cannot replace bound baseCommit ${existing.baseCommit}`,
    };
  }

  const inheritedFailedReviewCount = Math.max(
    params.inheritedFailedReviewCount,
    lineageFailedPremiumReviewCount(existing)
  );
  const sourceWorkstreamIds = [
    ...new Set([...(existing.sourceWorkstreamIds ?? []), ...(params.incomingSourceWorkstreamIds ?? [])]),
  ];
  return {
    ok: true,
    record: {
      ...existing,
      identityStatus: 'present',
      sourceWorkstreamIds: sourceWorkstreamIds.length > 0 ? sourceWorkstreamIds : existing.sourceWorkstreamIds,
      inheritedFailedReviewCount,
      failedPremiumReviewCount: Math.max(existing.failedPremiumReviewCount, inheritedFailedReviewCount),
      branchName: existing.branchName ?? params.incomingBranchName,
      baseCommit: existing.baseCommit || params.incomingBaseCommit,
      headCommit: existing.headCommit ?? params.incomingHeadCommit,
      planPath: existingPlanPath ?? incomingPlanPath,
      rehomeProvenance: existing.rehomeProvenance ?? params.incomingRehome,
    },
  };
}

export function isWorkflowProtocolRecord(value: unknown): value is WorkflowProtocolRecord {
  return validateWorkflowProtocolRecordStructure(value).ok;
}

export function readProtocolRecord(
  repoRoot: string,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const filePath = getProtocolRecordPath(repoRoot, workstreamId);
  if (!existsSync(filePath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    throw new Error(`protocol record is malformed; refuse to proceed: ${workstreamId}`);
  }
  if (!isWorkflowProtocolRecord(parsed)) {
    throw new Error(`protocol record is malformed; refuse to proceed: ${workstreamId}`);
  }
  return parsed;
}

export function writeProtocolRecord(repoRoot: string, record: WorkflowProtocolRecord): string {
  const filePath = getProtocolRecordPath(repoRoot, record.workstreamId);
  writeJsonAtomic(filePath, record);
  return filePath;
}

function getBoundCriticalReviewContract(
  repoRoot: string,
  record: WorkflowProtocolRecord
): { ok: true; requiredTestIds: string[] } | { ok: false; message: string } {
  if (!record.planPath) {
    return { ok: false, message: 'CRITICAL review requires a bound plan contract' };
  }
  const absolutePlanPath = resolveProtocolPlanAbsolutePath(repoRoot, record.planPath);
  if (!existsSync(absolutePlanPath)) {
    return { ok: false, message: `CRITICAL plan missing or unreadable: ${record.planPath}` };
  }
  let parsed: ReturnType<typeof extractPlanContractMarker>;
  try {
    parsed = extractPlanContractMarker(readFileSync(absolutePlanPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      message: `CRITICAL plan unreadable: ${error instanceof Error ? error.message : 'unknown read error'}`,
    };
  }
  if (parsed.status !== 'present' || !parsed.contract) {
    return {
      ok: false,
      message: `CRITICAL plan contract ${parsed.status}: ${parsed.errors.join('; ') || 'malformed'}`,
    };
  }
  if (!isCriticalPlanContract(parsed.contract)) {
    return { ok: false, message: 'bound plan is not a CRITICAL contract' };
  }
  const requiredTestIds = resolveCanonicalReviewRequiredIds(
    resolveRequiredTestIdsForWorkstream(parsed.contract, record.workstreamId).filter(
      (id) => !id.startsWith('WF-PAY-')
    )
  );
  if (requiredTestIds.length === 0) {
    return { ok: false, message: 'CRITICAL plan requiredTests must not be empty' };
  }
  const decision = getArchitectureGateDecision(parsed.contract.architectureGate);
  if (decision !== 'approved' && decision !== 'approved_with_conditions') {
    return {
      ok: false,
      message: 'CRITICAL architecture gate must be approved before review',
    };
  }
  return { ok: true, requiredTestIds };
}

function upsertProtocolInState(
  state: WorkflowReviewState,
  record: WorkflowProtocolRecord
): WorkflowReviewState {
  return {
    ...state,
    schemaVersion: '2',
    protocolRecords: {
      ...(state.protocolRecords ?? {}),
      [record.workstreamId]: record,
    },
  };
}

function setActiveFinaliseContext(
  state: WorkflowReviewState,
  context: WorkflowActiveFinaliseContext | null
): WorkflowReviewState {
  return {
    ...state,
    schemaVersion: '2',
    activeFinaliseContext: context,
  };
}

export function getActiveFinaliseContext(
  state: WorkflowReviewState
): WorkflowActiveFinaliseContext | null {
  return state.activeFinaliseContext ?? null;
}

export function lastReviewAttempt(
  record: WorkflowProtocolRecord
): WorkflowProtocolRecord['reviewAttempts'][number] | null {
  return record.reviewAttempts[record.reviewAttempts.length - 1] ?? null;
}

export function reviewAuthorizesProtectedFinalise(record: WorkflowProtocolRecord): boolean {
  if (isNonReleaseDispositionPhase(record.phase)) return false;
  if (record.phase === 'routing_required') return false;
  if (record.openBlockerIds.length > 0) return false;
  if (lineageBudgetExhausted(record)) return false;
  const latestLegal = latestLegalFinalDiffAttempt(record);
  if (!latestLegal.ok || !latestLegal.attempt) return false;
  return isApprovalValidReviewEvidence(latestLegal.attempt, record);
}

export function reviewAllowsFinaliseStart(record: WorkflowProtocolRecord): boolean {
  if (record.phase === 'finalised') return false;
  return reviewAuthorizesProtectedFinalise(record);
}

function loadWorkflowReviewStateOrThrow(statePath: string): WorkflowReviewState {
  if (!existsSync(statePath)) {
    throw new Error('workflow review state is missing; refuse product commit');
  }
  try {
    return loadWorkflowReviewStateStrict(statePath);
  } catch (error) {
    if (error instanceof Error && /refuse product commit/.test(error.message)) throw error;
    throw new Error('workflow review state is malformed; refuse product commit');
  }
}

export function assertFinaliseProductCommitAllowed(repoRoot: string): void {
  const paths = getWorkflowPaths(repoRoot);
  if (!existsSync(paths.statePath)) {
    const git = readWorkflowGitBinding(repoRoot);
    if (git.detached || !git.branchName) {
      throw new Error('finalise product commit requires a named branch');
    }
    return;
  }
  const state = loadWorkflowReviewStateOrThrow(paths.statePath);
  const git = readWorkflowGitBinding(repoRoot);
  if (git.detached || !git.branchName) {
    throw new Error('finalise product commit requires a named branch');
  }
  const active = getActiveFinaliseContext(state);
  if (!active) {
    return;
  }
  if (!active.activatedHeadCommit) {
    throw new Error(
      'active finalise context is missing activatedHeadCommit; refuse product commit'
    );
  }
  const expected = lastOwnedCommit(active.ownedCommits, active.activatedHeadCommit);
  const protocol = readProtocolRecord(repoRoot, active.workstreamId);
  if (protocol?.branchName && protocol.branchName !== git.branchName) {
    throw new Error(
      `current branch ${git.branchName} does not match protocol branch ${protocol.branchName}; refuse to authorise a product commit on the wrong branch`
    );
  }
  if (!git.headCommit || !expected || git.headCommit !== expected) {
    throw new Error(
      `HEAD ${git.headCommit ?? 'unknown'} is not the activated/owned finalise SHA ${expected ?? 'missing'}; refuse to authorise a newer Git state`
    );
  }
}

export function recordFinaliseOwnedCommit(repoRoot: string): {
  ok: true;
  ownedCommits: string[];
} | { ok: false; message: string } {
  const paths = getWorkflowPaths(repoRoot);
  return withWorkflowLock(paths.lockPath, () => {
    let state: WorkflowReviewState;
    try {
      state = loadWorkflowReviewStateOrThrow(paths.statePath);
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const active = getActiveFinaliseContext(state);
    if (!active?.activatedHeadCommit) {
      return { ok: false as const, message: 'no active finalise context with activatedHeadCommit' };
    }
    const appended = appendOwnedCommit({
      repoRoot,
      ownedCommits: active.ownedCommits ?? [active.activatedHeadCommit],
      activatedHeadCommit: active.activatedHeadCommit,
    });
    if (!appended.ok) return appended;
    const next: WorkflowReviewState = {
      ...state,
      activeFinaliseContext: {
        ...active,
        ownedCommits: appended.ownedCommits,
      },
    };
    saveWorkflowReviewState(paths.statePath, next);
    return { ok: true as const, ownedCommits: appended.ownedCommits };
  });
}

function validateEvidenceManifest(params: {
  repoRoot: string;
  workstreamId: string;
  manifestPath: string;
  requireKind: 'preflight' | 'fix-delta';
  expectedBaseCommit?: string | null;
  expectedRequiredTestIds?: string[];
}): { ok: boolean; message: string; absolutePath: string | null; contentHash?: string } {
  const repoRoot = path.resolve(params.repoRoot);
  const absolutePath = path.resolve(
    path.isAbsolute(params.manifestPath)
      ? params.manifestPath
      : path.join(repoRoot, params.manifestPath)
  );
  if (
    !(
      absolutePath === repoRoot ||
      absolutePath.startsWith(repoRoot + path.sep)
    )
  ) {
    return {
      ok: false,
      message: 'manifest path escapes repository root',
      absolutePath: null,
    };
  }
  const workstreamDirectory = path.resolve(
    getProtocolDirectory(params.repoRoot, params.workstreamId)
  );
  if (
    !(
      absolutePath === workstreamDirectory ||
      absolutePath.startsWith(workstreamDirectory + path.sep)
    )
  ) {
    return {
      ok: false,
      message: 'manifest path must stay under the workstream protocol directory',
      absolutePath: null,
    };
  }
  if (!existsSync(absolutePath)) {
    return { ok: false, message: `manifest missing: ${params.manifestPath}`, absolutePath: null };
  }
  if (pathHasExistingSymlinkComponent(absolutePath)) {
    return {
      ok: false,
      message: 'manifest path must not contain a symlink component',
      absolutePath: null,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
    if (parsed.schemaVersion !== '1') {
      return { ok: false, message: 'manifest schemaVersion must be 1', absolutePath };
    }
    if (parsed.workstreamId !== params.workstreamId) {
      return { ok: false, message: 'manifest workstreamId mismatch', absolutePath };
    }
    if (parsed.kind !== params.requireKind) {
      return {
        ok: false,
        message: `manifest kind must be ${params.requireKind}`,
        absolutePath,
      };
    }
    if (parsed.status !== 'passed') {
      return { ok: false, message: 'manifest status must be passed', absolutePath };
    }
    if (typeof parsed.contentHash !== 'string' || !parsed.contentHash) {
      return { ok: false, message: 'manifest contentHash missing', absolutePath };
    }
    const expectedName = `${params.requireKind}-${parsed.contentHash}.json`;
    if (path.basename(absolutePath) !== expectedName) {
      return {
        ok: false,
        message: `manifest filename must bind to contentHash as ${expectedName}`,
        absolutePath,
      };
    }
    if (typeof parsed.bodyHash !== 'string' || parsed.bodyHash !== parsed.contentHash) {
      return { ok: false, message: 'manifest contentHash must equal bodyHash', absolutePath };
    }
    const { contentHash: _contentHash, bodyHash: _bodyHash, ...body } = parsed;
    const recomputedBodyHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex')
      .slice(0, 32);
    if (recomputedBodyHash !== parsed.bodyHash) {
      return { ok: false, message: 'manifest bodyHash does not match canonical body', absolutePath };
    }
    if (typeof parsed.baseCommit !== 'string' || !parsed.baseCommit) {
      return { ok: false, message: 'manifest baseCommit missing', absolutePath };
    }
    if (params.expectedBaseCommit && parsed.baseCommit !== params.expectedBaseCommit) {
      return { ok: false, message: 'manifest baseCommit mismatch', absolutePath };
    }
    if (typeof parsed.headCommit !== 'string' || !parsed.headCommit) {
      return { ok: false, message: 'manifest headCommit missing', absolutePath };
    }
    if (typeof parsed.inputFingerprint !== 'string' || !parsed.inputFingerprint) {
      return { ok: false, message: 'manifest inputFingerprint missing', absolutePath };
    }
    if (typeof parsed.createdAt !== 'string' || !parsed.createdAt) {
      return { ok: false, message: 'manifest createdAt missing', absolutePath };
    }
    const createdMs = Date.parse(parsed.createdAt);
    if (!Number.isFinite(createdMs) || Date.now() - createdMs > 6 * 60 * 60 * 1000) {
      return { ok: false, message: 'manifest is stale (>6h) or has invalid createdAt', absolutePath };
    }
    const current = getCurrentTreeFingerprint(params.repoRoot);
    if (parsed.inputFingerprint !== current.inputFingerprint) {
      return { ok: false, message: 'manifest inputFingerprint is stale vs current tree', absolutePath };
    }
    if (parsed.headCommit !== current.headCommit) {
      return { ok: false, message: 'manifest headCommit is stale vs current HEAD', absolutePath };
    }
    const productTree = computeWorkingTreeProductFingerprint(params.repoRoot);
    if (typeof productTree === 'object') {
      return { ok: false, message: productTree.error, absolutePath };
    }
    if (
      typeof parsed.productTreeFingerprint === 'string' &&
      parsed.productTreeFingerprint !== productTree
    ) {
      return { ok: false, message: 'manifest productTreeFingerprint is stale vs current tree', absolutePath };
    }
    const commands = Array.isArray(parsed.commands)
      ? (parsed.commands as EvidenceCommandResult[])
      : [];
    const typecheckLint = assertCandidateTypecheckLintEvidence({
      repoRoot: params.repoRoot,
      baseCommit: parsed.baseCommit,
      headCommit: current.headCommit,
      productTreeFingerprint: productTree,
      commands,
    });
    if (!typecheckLint.ok) {
      return { ok: false, message: typecheckLint.message, absolutePath };
    }
    if (params.requireKind === 'preflight') {
      if (commands.length === 0) {
        return { ok: false, message: 'preflight manifest requires executed commands', absolutePath };
      }
      const requiredTests = Array.isArray(parsed.requiredTests) ? parsed.requiredTests : [];
      const proven = recomputeManifestProvenIds({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        parsed,
        extraRequiredIds: params.expectedRequiredTestIds,
      });
      if (!proven.ok) {
        return { ok: false, message: proven.message, absolutePath };
      }
      const incomplete = requiredTests.filter((entry) => {
        if (!entry || typeof entry !== 'object') return true;
        const row = entry as Record<string, unknown>;
        if (typeof row.id !== 'string') return true;
        return !proven.executedIds.has(row.id);
      });
      if (requiredTests.length > 0 && incomplete.length > 0) {
        return {
          ok: false,
          message: 'preflight requiredTests must be proven by verification ledger or exact command',
          absolutePath,
        };
      }
      if (params.expectedRequiredTestIds) {
        if (params.expectedRequiredTestIds.length === 0) {
          return {
            ok: false,
            message: 'CRITICAL plan requiredTests must not be empty',
            absolutePath,
          };
        }
        const missingPlanIds = params.expectedRequiredTestIds.filter(
          (id) => !proven.executedIds.has(id)
        );
        if (missingPlanIds.length > 0) {
          return {
            ok: false,
            message: `preflight missing proven plan requiredTests: ${missingPlanIds.join(', ')}`,
            absolutePath,
          };
        }
      } else {
        return {
          ok: false,
          message: 'preflight requires bound plan requiredTests',
          absolutePath,
        };
      }
    }
    if (params.requireKind === 'fix-delta') {
      const closed = Array.isArray(parsed.closedBlockerIds)
        ? parsed.closedBlockerIds.filter((id): id is string => typeof id === 'string')
        : [];
      if (closed.length === 0) {
        return { ok: false, message: 'fix-delta requires closedBlockerIds', absolutePath };
      }
      if (new Set(closed).size !== closed.length) {
        return { ok: false, message: 'fix-delta closedBlockerIds contains duplicates', absolutePath };
      }
      const proven = recomputeManifestProvenIds({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        parsed,
        extraRequiredIds: params.expectedRequiredTestIds,
      });
      if (!proven.ok) {
        return { ok: false, message: proven.message, absolutePath };
      }
      for (const blockerId of closed) {
        const expectedIds = requiredTestIdsForBlocker(blockerId);
        const missing = expectedIds.filter((id) => !proven.executedIds.has(id));
        if (missing.length > 0) {
          return {
            ok: false,
            message: `fix-delta blocker ${blockerId} lacks proven ledger tests: ${missing.join(', ')}`,
            absolutePath,
          };
        }
      }
      if (!params.expectedRequiredTestIds || params.expectedRequiredTestIds.length === 0) {
        return {
          ok: false,
          message: 'fix-delta requires the complete bound required-ID set',
          absolutePath,
        };
      }
      const missingPlanIds = params.expectedRequiredTestIds.filter(
        (id) => !proven.executedIds.has(id)
      );
      if (missingPlanIds.length > 0) {
        return {
          ok: false,
          message: `fix-delta missing proven required IDs: ${missingPlanIds.join(', ')}`,
          absolutePath,
        };
      }
    }
    return {
      ok: true,
      message: 'manifest accepted',
      absolutePath,
      contentHash: parsed.contentHash,
    };
  } catch (error) {
    return {
      ok: false,
      message: `manifest unreadable: ${error instanceof Error ? error.message : String(error)}`,
      absolutePath,
    };
  }
}

function fail(
  message: string,
  record: WorkflowProtocolRecord | null = null,
  exitCode = 1
): WorkflowProtocolTransitionResult {
  return { ok: false, exitCode, record, message };
}

function succeed(
  message: string,
  record: WorkflowProtocolRecord,
  extras?: Partial<WorkflowProtocolTransitionResult>
): WorkflowProtocolTransitionResult {
  return {
    ok: true,
    exitCode: 0,
    record,
    message,
    ...extras,
  };
}

export function reduceProtocolInit(params: {
  repoRoot: string;
  workstreamId?: string;
  planPath?: string;
  baseCommit?: string;
  sourceWorkstreamIds?: string[];
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  let workstreamId = params.workstreamId?.trim() || '';
  let sourceWorkstreamIds = params.sourceWorkstreamIds;
  let planPath = params.planPath ?? null;
  let inheritedFailedReviewCount = 0;
  let rehomeProvenance: WorkflowRehomeProvenance | null = null;

  if (params.planPath) {
    const resolved = resolvePlanPath({
      candidatePath: params.planPath,
      repoRoot: params.repoRoot,
    });
    if (resolved.status !== 'ok' || !resolved.absolutePath) {
      return fail(`invalid plan path: ${resolved.errors.join('; ') || 'unresolved'}`);
    }
    // Persist repo-relative POSIX only — never absolute host paths.
    planPath = toRepoRelativePosixPath(params.repoRoot, resolved.absolutePath);
    if (!planPath || planPath.startsWith('..') || path.isAbsolute(planPath)) {
      return fail('plan path must resolve to a repo-relative path');
    }
    const raw = readFileSync(resolved.absolutePath, 'utf8');
    const parsed = extractPlanContractMarker(raw);
    if (parsed.status !== 'present' || !parsed.contract) {
      return fail(`plan contract ${parsed.status}: ${parsed.errors.join('; ')}`);
    }
    const childIds = (parsed.contract.childWorkstreams ?? []).map(
      (child) => child.workstreamId
    );
    if (
      workstreamId &&
      parsed.contract.workstreamId &&
      workstreamId !== parsed.contract.workstreamId &&
      !childIds.includes(workstreamId)
    ) {
      return fail(
        `workstreamId mismatch: --workstream=${workstreamId} plan=${parsed.contract.workstreamId}`
      );
    }
    workstreamId = workstreamId || parsed.contract.workstreamId;
    sourceWorkstreamIds =
      sourceWorkstreamIds ??
      (workstreamId && childIds.includes(workstreamId)
        ? [parsed.contract.workstreamId, ...(parsed.contract.sourceWorkstreamIds ?? [])]
        : parsed.contract.sourceWorkstreamIds);
    if (parsed.contract.rehomeProvenance) {
      rehomeProvenance = {
        ...parsed.contract.rehomeProvenance,
        status: 'declared',
        predecessorPassedReview: false,
        predecessorHeadIsAncestor: false,
      };
    }
    if (
      isCriticalPlanContract(parsed.contract) &&
      parsed.contract.reviewClosureProtocol &&
      parsed.contract.reviewClosureProtocol !== 'two-pass-v1'
    ) {
      return fail('unsupported reviewClosureProtocol');
    }
  }

  if (!workstreamId) {
    return fail('workstreamId is required from --workstream or a validated plan contract');
  }
  const safeWorkstream = assertSafeOpaqueId(workstreamId, 'workstreamId');
  if (!safeWorkstream.ok) {
    return fail(safeWorkstream.error);
  }
  workstreamId = safeWorkstream.value;

  let existing: WorkflowProtocolRecord | null = null;
  try {
    existing = readProtocolRecord(params.repoRoot, workstreamId);
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : 'existing protocol.json is malformed; refuse to overwrite'
    );
  }
  if (existing && existing.phase !== 'initialized') {
    return fail(`protocol already exists in phase ${existing.phase}`, existing);
  }

  if (sourceWorkstreamIds?.length) {
    const explicitSources = new Set(params.sourceWorkstreamIds ?? []);
    for (const sourceId of sourceWorkstreamIds) {
      const source = readProtocolRecord(params.repoRoot, sourceId);
      if (!source) {
        if (explicitSources.has(sourceId)) {
          return fail(
            `source workstream ${sourceId} is missing; a new ID cannot mint a fresh review budget`
          );
        }
        continue;
      }
      inheritedFailedReviewCount = Math.max(
        inheritedFailedReviewCount,
        lineageFailedPremiumReviewCount(source)
      );
    }
  }

  const baseCommit =
    params.baseCommit?.trim() ||
    runGit(params.repoRoot, ['rev-parse', 'HEAD']) ||
    '';
  if (!/^[0-9a-f]{7,64}$/i.test(baseCommit)) {
    return fail('baseCommit must be an explicit git commit hash');
  }

  const git = assertNamedBranchForInit(params.repoRoot);
  if (!git.ok) return fail(git.message);

  if (existing) {
    const merged = mergeInitializedSecurityBindings({
      repoRoot: params.repoRoot,
      existing,
      incomingPlanPath: planPath,
      incomingRehome: rehomeProvenance,
      incomingBaseCommit: baseCommit,
      incomingBranchName: git.binding.branchName!,
      incomingHeadCommit: git.binding.headCommit,
      incomingSourceWorkstreamIds: sourceWorkstreamIds,
      inheritedFailedReviewCount,
    });
    if (!merged.ok) return fail(merged.message, existing);
    return succeed('protocol initialized', {
      ...merged.record,
      updatedAt: nowIso(params.now),
    });
  }

  const record = createEmptyProtocolRecord({
    workstreamId,
    baseCommit,
    branchName: git.binding.branchName,
    headCommit: git.binding.headCommit,
    planPath,
    sourceWorkstreamIds,
    inheritedFailedReviewCount,
    rehomeProvenance,
    now: params.now,
  });

  return succeed('protocol initialized', record);
}

export function reducePreflightRecord(params: {
  repoRoot: string;
  workstreamId: string;
  manifestPath: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (lineageBudgetExhausted(current) || lineageFirstConsumed(current) || current.phase === 'routing_required') {
    return fail(
      'preflight cannot reopen an exhausted or first-consumed CRITICAL lineage',
      current,
      WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
    );
  }
  if (current.phase !== 'initialized' && current.phase !== 'preflight_ready') {
    return fail(`preflight-record not allowed in phase ${current.phase}`, current);
  }
  if (planRequiresBoundRehome(current) && current.rehomeProvenance?.status !== 'bound') {
    return fail('rehome-bind required before preflight for a re-homed successor', current);
  }
  if (current.rehomeProvenance?.status === 'bound') {
    const rehome = revalidateBoundRehomeProvenance({
      repoRoot: params.repoRoot,
      provenance: current.rehomeProvenance,
    });
    if (!rehome.ok) return fail(rehome.message, current);
  }
  const bound = getBoundCriticalReviewContract(params.repoRoot, current);
  if (!bound.ok) return fail(bound.message, current);
  const expectedRequiredTestIds = bound.requiredTestIds;

  const validation = validateEvidenceManifest({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    manifestPath: params.manifestPath,
    requireKind: 'preflight',
    expectedBaseCommit: current.baseCommit,
    expectedRequiredTestIds,
  });
  if (!validation.ok || !validation.absolutePath) {
    return fail(validation.message, current);
  }

  const next: WorkflowProtocolRecord = {
    ...current,
    phase: 'preflight_ready',
    nextAction: 'review_start_first',
    evidenceManifestPath: path.relative(params.repoRoot, validation.absolutePath).replace(/\\/g, '/'),
    updatedAt: nowIso(params.now),
  };
  return succeed('preflight recorded', next);
}

export function reduceReviewStart(params: {
  repoRoot: string;
  workstreamId: string;
  pass: WorkflowProtocolReviewPass;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  const protocolCheck = validateCurrentV24ProtocolRecord(current);
  if (!protocolCheck.ok) return fail(protocolCheck.message, current);

  const git = assertProtocolGitBinding({
    repoRoot: params.repoRoot,
    protocol: current,
  });
  if (!git.ok) return fail(git.message, current);
  const frozen = assertReviewCandidateFrozen(params.repoRoot);
  if (!frozen.ok) return fail(frozen.message, current);
  const reviewBaseline = current.baseCommit || git.binding.headCommit;
  if (!reviewBaseline || !resolveCommitObject(params.repoRoot, reviewBaseline)) {
    return fail('review-start cannot determine a Git baseline; refuse to proceed', current);
  }
  const scoped = inspectCandidateGitScope(params.repoRoot, reviewBaseline);
  if (!scoped.ok) return fail(scoped.message, current);
  const transferredAutomation = [...scoped.scope.committed, ...scoped.scope.staged].filter(
    (relative) => {
      const normalized = relative.replace(/\\/g, '/');
      if (!normalized.startsWith('docs_private/automation/')) return false;
      return !isLiveWorkflowRuntimePath(normalized);
    }
  );
  if (transferredAutomation.length > 0) {
    return fail(
      `candidate diff includes forbidden paths: ${[...new Set(transferredAutomation)].sort().join(', ')}`,
      current
    );
  }

  const tree = getCurrentTreeFingerprint(params.repoRoot);

  if (params.pass === 'delta') {
    if (lineageBudgetExhausted(current)) {
      return fail(
        'routing_required: lineage premium review budget exhausted; delta cannot create approval from failed or exhausted evidence',
        current,
        WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
      );
    }
    if (
      current.phase !== 'review_closed' &&
      current.phase !== 'finalise_ready' &&
      current.phase !== 'delta_review'
    ) {
      return fail(`delta review-start requires review_closed (have ${current.phase})`, current);
    }
    const hasPassedLegalReview = current.reviewAttempts.some(
      (attempt) =>
        attempt.result === 'passed' &&
        (attempt.pass === 'first' || attempt.pass === 'closure')
    );
    if (!hasPassedLegalReview) {
      return fail(
        'delta cannot create approval from missing or exhausted review evidence',
        current
      );
    }
    const token = createToken('rev_delta');
    const attempt: WorkflowProtocolReviewAttempt = {
      pass: 'delta',
      token,
      startedAt: nowIso(params.now),
      headCommit: git.binding.headCommit,
      treeFingerprint: tree.inputFingerprint,
    };
    const next: WorkflowProtocolRecord = {
      ...current,
      phase: 'delta_review',
      nextAction: 'review_record',
      activeReviewToken: token,
      activeReviewPass: 'delta',
      activeCheckpointId: null,
      reviewAttempts: [...current.reviewAttempts, attempt],
      updatedAt: nowIso(params.now),
    };
    return succeed('delta review token issued', next, { reviewToken: token });
  }

  if (current.phase === 'routing_required' || lineageBudgetExhausted(current)) {
    return fail(
      'routing_required: lineage premium review budget exhausted; route, isolate, remove, revert, or evidence-backed supersede. review-start rejected',
      current,
      WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
    );
  }

  if (params.pass === 'first') {
    if (lineageFirstConsumed(current)) {
      return fail(
        'first review already consumed in this CRITICAL lineage; split does not mint a new first',
        current,
        WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
      );
    }
    if (current.phase !== 'preflight_ready') {
      return fail(`first review-start requires preflight_ready (have ${current.phase})`, current);
    }
    if (!current.evidenceManifestPath) {
      return fail('first review requires a recorded preflight manifest', current);
    }
    const bound = getBoundCriticalReviewContract(params.repoRoot, current);
    if (!bound.ok) return fail(bound.message, current);
    const validation = validateEvidenceManifest({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: current.evidenceManifestPath,
      requireKind: 'preflight',
      expectedBaseCommit: current.baseCommit,
      expectedRequiredTestIds: bound.requiredTestIds,
    });
    if (!validation.ok) {
      return fail(`first review evidence is stale or invalid: ${validation.message}`, current);
    }
  } else {
    if (current.phase !== 'fix_recorded') {
      return fail(`closure review-start requires fix_recorded (have ${current.phase})`, current);
    }
    if (!current.fixDeltaManifestPath) {
      return fail('closure review requires a recorded fix-delta manifest', current);
    }
    if (lineageFailedPremiumReviewCount(current) >= 2) {
      return fail(
        'review budget exhausted; routing_required',
        current,
        WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
      );
    }
    const bound = getBoundCriticalReviewContract(params.repoRoot, current);
    if (!bound.ok) return fail(bound.message, current);
    const validation = validateEvidenceManifest({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: current.fixDeltaManifestPath,
      requireKind: 'fix-delta',
      expectedBaseCommit: current.baseCommit,
      expectedRequiredTestIds: bound.requiredTestIds,
    });
    if (!validation.ok) {
      return fail(`closure review evidence is stale or invalid: ${validation.message}`, current);
    }
  }

  const token = createToken(`rev_${params.pass}`);
  const attempt: WorkflowProtocolReviewAttempt = {
    pass: params.pass,
    token,
    startedAt: nowIso(params.now),
    headCommit: git.binding.headCommit,
    treeFingerprint: tree.inputFingerprint,
  };
  const next: WorkflowProtocolRecord = {
    ...current,
    phase: params.pass === 'first' ? 'first_review' : 'closure_review',
    nextAction: 'review_record',
    activeReviewToken: token,
    activeReviewPass: params.pass,
    reviewAttempts: [...current.reviewAttempts, attempt],
    updatedAt: nowIso(params.now),
  };
  return succeed(`${params.pass} review token issued`, next, { reviewToken: token });
}

export function reduceReviewRecord(params: {
  repoRoot: string;
  workstreamId: string;
  token: string;
  result: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  const protocolCheck = validateCurrentV24ProtocolRecord(current);
  if (!protocolCheck.ok) return fail(protocolCheck.message, current);
  const git = assertProtocolGitBinding({
    repoRoot: params.repoRoot,
    protocol: current,
  });
  if (!git.ok) return fail(git.message, current);
  if (current.phase !== 'first_review' && current.phase !== 'closure_review' && current.phase !== 'delta_review') {
    return fail(`review-record not allowed in phase ${current.phase}`, current);
  }
  if (!current.activeReviewToken || current.activeReviewToken !== params.token) {
    return fail('invalid or consumed review token', current);
  }
  if (!current.activeReviewPass) {
    return fail('active review pass missing', current);
  }
  const startedAttempt = current.reviewAttempts.find((attempt) => attempt.token === params.token);
  const startedHead = startedAttempt?.headCommit ?? null;
  const recordHead = runGit(params.repoRoot, ['rev-parse', 'HEAD']);
  if (startedHead && recordHead && startedHead !== recordHead) {
    return fail(
      `HEAD moved during review (started ${startedHead}, now ${recordHead}); re-run review-start. Do not rewrite review metadata to the current HEAD.`,
      current
    );
  }
  const treeAtRecord = getCurrentTreeFingerprint(params.repoRoot);
  if (
    startedAttempt?.treeFingerprint &&
    treeAtRecord.inputFingerprint !== startedAttempt.treeFingerprint
  ) {
    return fail(
      'working tree fingerprint moved since review-start; re-run review-start. Do not rewrite review metadata to the current tree.',
      current
    );
  }

  const families = [...new Set((params.blockerFamilies ?? []).map((v) => v.trim()).filter(Boolean))];
  const blockers = [...new Set((params.blockerIds ?? []).map((v) => v.trim()).filter(Boolean))];
  const siblings = [...new Set((params.siblingSurfaces ?? []).map((v) => v.trim()).filter(Boolean))];

  if (params.result === 'failed') {
    if (families.length === 0 || blockers.length === 0 || siblings.length === 0) {
      return fail(
        'failed review-record requires blockerFamilies, blockerIds, and siblingSurfaces',
        current
      );
    }
  }

  const attempts = current.reviewAttempts.map((attempt) =>
    attempt.token === params.token
      ? {
          ...attempt,
          result: params.result,
          blockerFamilies: families,
          blockerIds: blockers,
          siblingSurfaces: siblings,
          recordedAt: nowIso(params.now),
        }
      : attempt
  );

  let failedCount = current.failedPremiumReviewCount;
  let phase: WorkflowProtocolPhase = current.phase;
  let nextAction = current.nextAction;
  let exitCode = 0;
  let message = `review ${params.result}`;

  if (params.result === 'passed') {
    if (current.activeReviewPass === 'closure' && current.openBlockerIds.length > 0) {
      return fail(
        `closure pass cannot pass while open blockers remain: ${current.openBlockerIds.join(', ')}`,
        current
      );
    }
    if (
      (current.activeReviewPass === 'closure' || current.activeReviewPass === 'delta') &&
      blockers.length > 0
    ) {
      return fail('closure pass=passed must not introduce open blockerIds', current);
    }
    phase = 'review_closed';
    nextAction = 'finalise_start';
    message = 'review closed';
  } else if (current.activeReviewPass === 'delta') {
    phase = 'review_closed';
    nextAction = 'review_start_delta';
    message = 'delta review failed; retry review-start --pass delta after addressing blockers';
  } else {
    failedCount += 1;
    if (failedCount >= 2) {
      phase = 'routing_required';
      nextAction = 'route_or_isolate';
      exitCode = WORKFLOW_ROUTING_REQUIRED_EXIT_CODE;
      message = 'second failed premium review; routing_required';
    } else {
      phase = 'fix_sweep_required';
      nextAction = 'consolidated_fix_record';
      message = 'first failed review; consolidated fix sweep required';
    }
  }

  const reviewedHead =
    params.result === 'passed' ? git.binding.headCommit ?? recordHead : current.headCommit;
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const next: WorkflowProtocolRecord = {
    ...current,
    phase,
    nextAction,
    failedPremiumReviewCount: failedCount,
    activeReviewToken: null,
    activeReviewPass: null,
    reviewAttempts: attempts,
    blockerFamilies: [...new Set([...current.blockerFamilies, ...families])],
    openBlockerIds: params.result === 'passed' ? [] : blockers,
    headCommit: reviewedHead,
    reviewedTreeFingerprint:
      params.result === 'passed' ? tree.inputFingerprint : current.reviewedTreeFingerprint,
    updatedAt: nowIso(params.now),
  };

  return {
    ok: exitCode === 0,
    exitCode,
    record: next,
    message,
  };
}

export function reduceFixRecord(params: {
  repoRoot: string;
  workstreamId: string;
  manifestPath: string;
  closedBlockerIds?: string[];
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (current.phase !== 'fix_sweep_required') {
    return fail(`fix-record requires fix_sweep_required (have ${current.phase})`, current);
  }
  if (!params.closedBlockerIds || params.closedBlockerIds.length === 0) {
    return fail('fix-record requires explicit --closed-blocker-ids', current);
  }
  const bound = getBoundCriticalReviewContract(params.repoRoot, current);
  if (!bound.ok) return fail(bound.message, current);
  const validation = validateEvidenceManifest({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    manifestPath: params.manifestPath,
    requireKind: 'fix-delta',
    expectedBaseCommit: current.baseCommit,
    expectedRequiredTestIds: bound.requiredTestIds,
  });
  if (!validation.ok || !validation.absolutePath) {
    return fail(validation.message, current);
  }

  const closed = new Set(params.closedBlockerIds.map((id) => id.trim()).filter(Boolean));
  const remaining = current.openBlockerIds.filter((id) => !closed.has(id));
  if (remaining.length > 0) {
    return fail(
      `fix-record incomplete; open blockers remain: ${remaining.join(', ')}`,
      current
    );
  }
  try {
    const manifest = JSON.parse(
      readFileSync(validation.absolutePath, 'utf8')
    ) as {
      closedBlockerIds?: string[];
      blockerEvidence?: Array<{ blockerId?: string }>;
    };
    const manifestClosed = new Set(manifest.closedBlockerIds ?? []);
    for (const id of closed) {
      if (!manifestClosed.has(id)) {
        return fail(`fix-record closed id ${id} missing from manifest closedBlockerIds`, current);
      }
      const hasEvidence = (manifest.blockerEvidence ?? []).some(
        (entry) => entry.blockerId === id
      );
      if (!hasEvidence) {
        return fail(`fix-record closed id ${id} missing blockerEvidence`, current);
      }
    }
  } catch (error) {
    return fail(
      `unable to bind fix evidence: ${error instanceof Error ? error.message : String(error)}`,
      current
    );
  }

  const next: WorkflowProtocolRecord = {
    ...current,
    phase: 'fix_recorded',
    nextAction: 'review_start_closure',
    fixDeltaManifestPath: path.relative(params.repoRoot, validation.absolutePath).replace(/\\/g, '/'),
    openBlockerIds: [],
    updatedAt: nowIso(params.now),
  };
  return succeed('fix delta recorded', next);
}

export function reduceSplit(params: {
  repoRoot: string;
  workstreamId: string;
  newWorkstreamId: string;
  narrowerPartition: boolean;
  hasFixDelta: boolean;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (current.phase !== 'routing_required' && current.phase !== 'fix_sweep_required') {
    return fail(`split not allowed in phase ${current.phase}`, current);
  }
  if (!params.newWorkstreamId.trim()) {
    return fail('newWorkstreamId required', current);
  }
  const childId = params.newWorkstreamId.trim();
  if (childId === current.workstreamId) {
    return fail('split child cannot be the parent', current);
  }
  if ((current.sourceWorkstreamIds ?? []).includes(childId)) {
    return fail('split would create a lineage cycle', current);
  }
  if (readProtocolRecord(params.repoRoot, childId)) {
    return fail('newWorkstreamId already exists', current);
  }
  if (listImmediateChildWorkstreamIds(params.repoRoot, current.workstreamId).length > 0) {
    return fail('split already has a continuation child', current);
  }

  const inheritBudget = lineageFailedPremiumReviewCount(current);
  void params.narrowerPartition;
  void params.hasFixDelta;

  const child = createEmptyProtocolRecord({
    workstreamId: childId,
    baseCommit: current.baseCommit,
    branchName: current.branchName,
    headCommit: current.headCommit,
    planPath: current.planPath,
    sourceWorkstreamIds: [current.workstreamId, ...(current.sourceWorkstreamIds ?? [])],
    inheritedFailedReviewCount: inheritBudget,
    now: params.now,
  });
  child.failedPremiumReviewCount = inheritBudget;
  child.blockerFamilies = [...current.blockerFamilies];
  child.openBlockerIds = [...current.openBlockerIds];
  child.fixDeltaManifestPath = current.fixDeltaManifestPath;
  child.reviewedTreeFingerprint = current.reviewedTreeFingerprint;
  if (inheritBudget >= 2) {
    child.phase = 'routing_required';
    child.nextAction = 'route_or_isolate';
  } else {
    child.phase = current.phase;
    child.nextAction =
      current.phase === 'routing_required' ? 'route_or_isolate' : 'consolidated_fix_record';
  }

  const parent: WorkflowProtocolRecord = {
    ...current,
    phase: 'split',
    nextAction: 'use_split_workstream',
    updatedAt: nowIso(params.now),
  };

  return {
    ok: true,
    exitCode: 0,
    record: parent,
    message: 'workstream split recorded',
    splitWorkstreamId: child.workstreamId,
    childRecord: child,
  };
}

export function reduceRoute(params: {
  repoRoot: string;
  workstreamId: string;
  disposition: WorkflowRouteDispositionTarget;
  reason: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  const built = buildRouteDisposition({
    repoRoot: params.repoRoot,
    record: current,
    target: params.disposition,
    reason: params.reason,
    implementationCommits: params.implementationCommits,
    revertCommit: params.revertCommit,
    supersedeCommit: params.supersedeCommit,
    successorRepo: params.successorRepo,
    successorBranch: params.successorBranch,
    successorBaseline: params.successorBaseline,
    predecessorHead: params.predecessorHead,
    nowIso: nowIso(params.now),
  });
  if (!built.ok) return fail(built.message, current);
  const next: WorkflowProtocolRecord = {
    ...current,
    phase: params.disposition,
    nextAction: 'non_release_disposition',
    activeReviewToken: null,
    activeReviewPass: null,
    activeCheckpointId: null,
    routeDisposition: built.disposition,
    failedPremiumReviewCount: current.failedPremiumReviewCount,
    inheritedFailedReviewCount: current.inheritedFailedReviewCount,
    reviewAttempts: current.reviewAttempts,
    headCommit: current.headCommit,
    reviewedTreeFingerprint: current.reviewedTreeFingerprint,
    updatedAt: nowIso(params.now),
  };
  return succeed(`route recorded as ${params.disposition}; not approval and not finalised`, next);
}

export function reduceRehomeBind(params: {
  repoRoot: string;
  workstreamId: string;
  predecessorRootWorkstreamId: string;
  predecessorDescendantWorkstreamId: string;
  predecessorHeadCommit: string;
  predecessorReleaseContext: string;
  successorBaselineCommit: string;
  successorBranchName: string;
  sourcePatchSha256: string;
  sourceProductTreeFingerprint: string;
  sourceReleaseContext: string;
  sourceHeadCommit: string;
  sourceBaselineCommit: string;
  sourceReviewWorkstreamId?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (current.phase !== 'initialized') {
    return fail(`rehome-bind requires initialized (have ${current.phase})`, current);
  }
  if (!current.rehomeProvenance) {
    return fail('rehome-bind requires declared plan/protocol rehomeProvenance', current);
  }
  const bound = buildBoundRehomeProvenance({
    repoRoot: params.repoRoot,
    record: current,
    declared: current.rehomeProvenance,
    predecessorRootWorkstreamId: params.predecessorRootWorkstreamId,
    predecessorDescendantWorkstreamId: params.predecessorDescendantWorkstreamId,
    predecessorHeadCommit: params.predecessorHeadCommit,
    predecessorReleaseContext: params.predecessorReleaseContext,
    successorBaselineCommit: params.successorBaselineCommit,
    successorBranchName: params.successorBranchName,
    sourcePatchSha256: params.sourcePatchSha256,
    sourceProductTreeFingerprint: params.sourceProductTreeFingerprint,
    sourceReleaseContext: params.sourceReleaseContext,
    sourceHeadCommit: params.sourceHeadCommit,
    sourceBaselineCommit: params.sourceBaselineCommit,
    sourceReviewWorkstreamId: params.sourceReviewWorkstreamId,
    nowIso: nowIso(params.now),
  });
  if (!bound.ok) return fail(bound.message, current);
  const next: WorkflowProtocolRecord = {
    ...current,
    rehomeProvenance: bound.provenance,
    failedPremiumReviewCount: 0,
    inheritedFailedReviewCount: 0,
    updatedAt: nowIso(params.now),
  };
  return succeed('rehome provenance bound; predecessor is not claimed as passed', next);
}

export function reduceFinaliseStart(params: {
  repoRoot: string;
  workstreamId: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  const protocolCheck = validateCurrentV24ProtocolRecord(current);
  if (!protocolCheck.ok) return fail(protocolCheck.message, current);
  if (current.phase !== 'review_closed' && current.phase !== 'finalise_ready') {
    return fail(`finalise-start requires review_closed (have ${current.phase})`, current);
  }
  if (!reviewAllowsFinaliseStart(current)) {
    return fail(
      'finalise-start requires a successful review with no open blockers; if HEAD or the tree drifted, run review-start --pass delta and record a passing delta review first',
      current
    );
  }
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const git = assertProtocolGitBinding({
    repoRoot: params.repoRoot,
    protocol: current,
    expectedHeadCommit: current.headCommit,
    expectedTreeFingerprint: current.reviewedTreeFingerprint,
    currentTreeFingerprint: tree.inputFingerprint,
  });
  if (!git.ok) {
    if (/HEAD has moved/i.test(git.message) || /fingerprint moved/i.test(git.message)) {
      return fail(
        `${git.message} Run npx tsx scripts/workflow-protocol.ts review-start --workstream ${current.workstreamId} --pass delta to refresh the final-diff review. Do not rewrite review metadata to the current HEAD.`,
        current
      );
    }
    return fail(git.message, current);
  }
  const currentHead = git.binding.headCommit;
  if (!currentHead) {
    return fail('finalise-start requires a readable git HEAD', current);
  }
  if (!current.headCommit) {
    return fail('finalise-start requires a reviewed headCommit bound by a successful review', current);
  }
  const currentState = loadWorkflowReviewStateStrict(getWorkflowPaths(params.repoRoot).statePath);
  const existingOwner = getActiveFinaliseContext(currentState);
  if (existingOwner && existingOwner.workstreamId !== params.workstreamId) {
    return fail(
      `active finalise owner ${existingOwner.workstreamId} cannot be replaced by ${params.workstreamId}`,
      current
    );
  }
  if (currentHead !== current.headCommit) {
    const extraOutput = runGit(params.repoRoot, [
      'log',
      '--format=%H',
      `${current.headCommit}..${currentHead}`,
    ]);
    const extra = extraOutput
      ? extraOutput
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(', ')
      : 'unable to list';
    return fail(
      `HEAD has moved since the reviewed commit ${current.headCommit}; current HEAD is ${currentHead}; extra commits: ${extra}. Run npx tsx scripts/workflow-protocol.ts review-start --workstream ${current.workstreamId} --pass delta to refresh the final-diff review. Do not rewrite review metadata to the current HEAD.`,
      current
    );
  }
  // Reuse the bound checkpoint when already finalise_ready so repair evidence stays valid.
  const checkpointId =
    current.phase === 'finalise_ready' && current.activeCheckpointId
      ? current.activeCheckpointId
      : createCheckpointId(current.workstreamId);
  const next: WorkflowProtocolRecord = {
    ...current,
    phase: 'finalise_ready',
    nextAction: 'run_finalise',
    activeCheckpointId: checkpointId,
    updatedAt: nowIso(params.now),
  };
  return succeed('finalise context activated', next, { checkpointId });
}

/**
 * Safe finalise completion/failure transition. Does not invent review tokens.
 * Passed: phase -> finalised, clear activeCheckpointId in memory only.
 * Disk persistence of `finalised` is deferred until shared workflow state is saved
 * (see commitFinaliseCorrelationStateAndProtocols) so a state-save failure cannot
 * leave an irreversible finalised protocol that blocks retry.
 * Failed/unknown: keep finalise_ready (or current); disk write is safe to retry.
 */
export function applyFinaliseProtocolOutcome(params: {
  repoRoot: string;
  state: WorkflowReviewState;
  workstreamId: string;
  outcome: 'passed' | 'failed' | 'unknown';
  now?: () => Date;
}): {
  state: WorkflowReviewState;
  record: WorkflowProtocolRecord | null;
} {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current || !isWorkflowProtocolRecord(current)) {
    return { state: params.state, record: null };
  }
  const protocolCheck = validateCurrentV24ProtocolRecord(current);
  if (!protocolCheck.ok) {
    if (params.outcome === 'passed') {
      throw new Error(
        `protected finish requires a current V2.4 protocol with valid review authority: ${protocolCheck.message}`
      );
    }
    return { state: params.state, record: current };
  }
  if (current.phase !== 'finalise_ready' && current.phase !== 'finalised') {
    return { state: params.state, record: current };
  }
  if (params.outcome === 'passed' && !reviewAuthorizesProtectedFinalise(current)) {
    throw new Error(
      'protected finish requires a successful current V2.4 review; structure-only finalise_ready is not authority'
    );
  }

  const updatedAt = nowIso(params.now);
  if (params.outcome !== 'passed') {
    const failedRecord: WorkflowProtocolRecord = {
      ...current,
      nextAction: 'rerun_or_repair_finalise',
      updatedAt,
    };
    writeJsonAtomic(getProtocolRecordPath(params.repoRoot, params.workstreamId), failedRecord);
    return {
      state: upsertProtocolInState(params.state, failedRecord),
      record: failedRecord,
    };
  }

  const finalized: WorkflowProtocolRecord = {
    ...current,
    phase: 'finalised',
    nextAction: 'done',
    activeCheckpointId: null,
    updatedAt,
  };
  // Intentionally do not write protocol.json yet — the guarded finish path
  // commits protocol.json only after C9 validation and a pending transaction marker.
  let nextState = upsertProtocolInState(params.state, finalized);
  if (nextState.activeFinaliseContext?.workstreamId === params.workstreamId) {
    nextState = setActiveFinaliseContext(nextState, null);
  }
  return { state: nextState, record: finalized };
}

export const FINALISE_PASSED_COMMIT_PENDING_KIND = 'protected-finalise-passed' as const;

interface FinalisePassedCommitPending {
  schemaVersion: '1';
  kind: typeof FINALISE_PASSED_COMMIT_PENDING_KIND;
  createdAt: string;
  workstreamIds: string[];
  previousState: WorkflowReviewState;
  previousProtocols: Record<string, WorkflowProtocolRecord | null>;
}

export function getFinalisePassedCommitPendingPath(repoRoot: string): string {
  return path.join(
    getWorkflowPaths(repoRoot).knowledgeDirectory,
    'finalise-passed-commit.pending.json'
  );
}

function isFinalisePassedCommitPending(value: unknown): value is FinalisePassedCommitPending {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<FinalisePassedCommitPending>;
  return (
    row.schemaVersion === '1' &&
    row.kind === FINALISE_PASSED_COMMIT_PENDING_KIND &&
    typeof row.createdAt === 'string' &&
    Array.isArray(row.workstreamIds) &&
    row.previousState != null &&
    typeof row.previousState === 'object' &&
    row.previousProtocols != null &&
    typeof row.previousProtocols === 'object'
  );
}

export function hasIncompleteFinalisePassedCommit(repoRoot: string): boolean {
  return existsSync(getFinalisePassedCommitPendingPath(repoRoot));
}

function restoreFinalisePassedCommitSnapshot(params: {
  repoRoot: string;
  statePath: string;
  previousState: WorkflowReviewState;
  previousProtocols: Record<string, WorkflowProtocolRecord | null> | Map<string, WorkflowProtocolRecord | null>;
}): void {
  const entries =
    params.previousProtocols instanceof Map
      ? params.previousProtocols
      : new Map(Object.entries(params.previousProtocols));
  for (const [, previous] of entries) {
    if (previous && isWorkflowProtocolRecord(previous)) {
      writeProtocolRecord(params.repoRoot, previous);
    }
  }
  try {
    saveWorkflowReviewState(params.statePath, params.previousState);
  } catch {
    // Best-effort restore; callers rethrow the original error.
  }
}

/**
 * Roll incomplete protected-passed commits back to the pre-commit snapshot.
 * Returns whether a pending marker existed. Malformed pending fails closed.
 */
export function recoverIncompleteFinalisePassedCommit(repoRoot: string): boolean {
  const pendingPath = getFinalisePassedCommitPendingPath(repoRoot);
  if (!existsSync(pendingPath)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pendingPath, 'utf8')) as unknown;
  } catch {
    throw new Error(
      'incomplete protected finalise passed commit is unreadable; refuse finalise'
    );
  }
  if (!isFinalisePassedCommitPending(parsed)) {
    throw new Error(
      'incomplete protected finalise passed commit is malformed; refuse finalise'
    );
  }
  restoreFinalisePassedCommitSnapshot({
    repoRoot,
    statePath: getWorkflowPaths(repoRoot).statePath,
    previousState: parsed.previousState,
    previousProtocols: parsed.previousProtocols,
  });
  try {
    unlinkSync(pendingPath);
  } catch {
    throw new Error(
      'incomplete protected finalise passed commit could not be cleared; refuse finalise'
    );
  }
  return true;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function listFinalisedPersistIds(params: {
  nextState: WorkflowReviewState;
  workstreamIds: string[];
}): string[] {
  return params.workstreamIds.filter((workstreamId) => {
    const record = params.nextState.protocolRecords?.[workstreamId];
    return Boolean(record && isWorkflowProtocolRecord(record) && record.phase === 'finalised');
  });
}

/**
 * Persist shared workflow state, then mark matched protocols finalised on disk.
 * Finalised writes are wrapped in a pending transaction marker so a hard crash
 * cannot be read as successful until the marker is cleared.
 * Disk protocol.json remains the release-authority record; the marker makes
 * partial writes fail closed. Thrown errors still restore the prior snapshot.
 */
export function commitFinaliseCorrelationStateAndProtocols(params: {
  repoRoot: string;
  statePath: string;
  previousState: WorkflowReviewState;
  nextState: WorkflowReviewState;
  workstreamIds: string[];
  fromProtectedFinish?: boolean;
}): void {
  const finalisedIds = listFinalisedPersistIds({
    nextState: params.nextState,
    workstreamIds: params.workstreamIds,
  });
  if (finalisedIds.length > 0 && params.fromProtectedFinish !== true) {
    throw new Error(
      'finalised protocol persist requires AutomationRun.finish after C9 validation'
    );
  }

  const protocolBackups = new Map<string, WorkflowProtocolRecord | null>();
  for (const workstreamId of params.workstreamIds) {
    protocolBackups.set(workstreamId, readProtocolRecord(params.repoRoot, workstreamId));
  }
  const pendingPath = getFinalisePassedCommitPendingPath(params.repoRoot);
  const wrotePending = finalisedIds.length > 0;

  const restore = (): void => {
    restoreFinalisePassedCommitSnapshot({
      repoRoot: params.repoRoot,
      statePath: params.statePath,
      previousState: params.previousState,
      previousProtocols: protocolBackups,
    });
    if (wrotePending && existsSync(pendingPath)) {
      try {
        unlinkSync(pendingPath);
      } catch {
        // Best-effort; leftover pending remains fail-closed for readers.
      }
    }
  };

  try {
    if (wrotePending) {
      const previousProtocols: Record<string, WorkflowProtocolRecord | null> = {};
      for (const [workstreamId, previous] of protocolBackups) {
        previousProtocols[workstreamId] = previous;
      }
      writeJsonAtomic(pendingPath, {
        schemaVersion: '1',
        kind: FINALISE_PASSED_COMMIT_PENDING_KIND,
        createdAt: nowIso(),
        workstreamIds: [...finalisedIds],
        previousState: cloneJson(params.previousState),
        previousProtocols: cloneJson(previousProtocols),
      } satisfies FinalisePassedCommitPending);
    }
    saveWorkflowReviewState(params.statePath, params.nextState);
    for (const workstreamId of params.workstreamIds) {
      const record = params.nextState.protocolRecords?.[workstreamId];
      if (record && isWorkflowProtocolRecord(record) && record.phase === 'finalised') {
        writeProtocolRecord(params.repoRoot, record);
      }
    }
    if (wrotePending && existsSync(pendingPath)) {
      unlinkSync(pendingPath);
    }
  } catch (error) {
    restore();
    throw error;
  }
}

function listImmediateChildWorkstreamIds(repoRoot: string, parentId: string): string[] {
  const root = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
  if (!existsSync(root)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = readProtocolRecord(repoRoot, entry.name);
    if (child?.sourceWorkstreamIds?.[0] === parentId) {
      ids.push(child.workstreamId);
    }
  }
  return ids;
}

function persistParentAndOptionalChildUnlocked(params: {
  repoRoot: string;
  parent: WorkflowProtocolRecord;
  child?: WorkflowProtocolRecord;
  activateFinalise?: boolean;
}): void {
  const paths = getWorkflowPaths(params.repoRoot);
  const previousParent = readProtocolRecord(params.repoRoot, params.parent.workstreamId);
  const previousChild = params.child
    ? readProtocolRecord(params.repoRoot, params.child.workstreamId)
    : null;
  const previousState = loadWorkflowReviewStateStrict(paths.statePath);
  const childWasNew = Boolean(params.child && !previousChild);
  try {
    writeProtocolRecord(params.repoRoot, params.parent);
    if (params.child) {
      writeProtocolRecord(params.repoRoot, params.child);
    }
    let state = previousState;
    state = upsertProtocolInState(state, params.parent);
    if (params.child) {
      state = upsertProtocolInState(state, params.child);
    }
    if (
      state.activeFinaliseContext?.workstreamId === params.parent.workstreamId &&
      params.parent.phase !== 'finalise_ready'
    ) {
      state = setActiveFinaliseContext(state, null);
    }
    state = upsertWorkstreamRecord(state, {
      workstreamId: params.parent.workstreamId,
      branchName: params.parent.branchName,
      headCommit: params.parent.headCommit,
      taskIds: [],
      eventIds: [],
      status: params.parent.phase === 'finalised' ? 'finalised' : 'open',
      sourceWorkstreamIds: params.parent.sourceWorkstreamIds,
      updatedAt: params.parent.updatedAt,
    });
    if (params.child) {
      state = upsertWorkstreamRecord(state, {
        workstreamId: params.child.workstreamId,
        branchName: params.child.branchName,
        headCommit: params.child.headCommit,
        taskIds: [],
        eventIds: [],
        status: 'open',
        sourceWorkstreamIds: params.child.sourceWorkstreamIds,
        updatedAt: params.child.updatedAt,
      });
    }
    if (params.activateFinalise && params.parent.activeCheckpointId) {
      const existingOwner = getActiveFinaliseContext(state);
      if (existingOwner && existingOwner.workstreamId !== params.parent.workstreamId) {
        throw new Error(
          `active finalise owner ${existingOwner.workstreamId} cannot be replaced by ${params.parent.workstreamId}`
        );
      }
      const git = readWorkflowGitBinding(params.repoRoot);
      const tree = getCurrentTreeFingerprint(params.repoRoot);
      state = setActiveFinaliseContext(state, {
        workstreamId: params.parent.workstreamId,
        checkpointId: params.parent.activeCheckpointId,
        activatedAt: params.parent.updatedAt,
        activatedHeadCommit: git.headCommit,
        activatedBranchName: git.branchName,
        activatedTreeFingerprint: tree.inputFingerprint,
        ownedCommits: git.headCommit ? [git.headCommit] : [],
      });
    }
    saveWorkflowReviewState(paths.statePath, state);
  } catch (error) {
    if (previousParent) {
      writeProtocolRecord(params.repoRoot, previousParent);
    }
    if (previousChild) {
      writeProtocolRecord(params.repoRoot, previousChild);
    } else if (params.child && childWasNew) {
      const childPath = getProtocolRecordPath(params.repoRoot, params.child.workstreamId);
      if (existsSync(childPath)) {
        unlinkSync(childPath);
      }
    }
    try {
      saveWorkflowReviewState(paths.statePath, previousState);
    } catch {
      // Best-effort restore; original error is rethrown.
    }
    throw error;
  }
}

function applyProtocolTransitionUnlocked(params: {
  repoRoot: string;
  command: WorkflowProtocolCommand;
  workstreamId?: string;
  planPath?: string;
  baseCommit?: string;
  manifestPath?: string;
  pass?: WorkflowProtocolReviewPass;
  token?: string;
  result?: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  closedBlockerIds?: string[];
  newWorkstreamId?: string;
  narrowerPartition?: boolean;
  hasFixDelta?: boolean;
  sourceWorkstreamIds?: string[];
  disposition?: WorkflowRouteDispositionTarget;
  reason?: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
  predecessorRootWorkstreamId?: string;
  predecessorDescendantWorkstreamId?: string;
  predecessorHeadCommit?: string;
  predecessorReleaseContext?: string;
  successorBaselineCommit?: string;
  successorBranchName?: string;
  sourcePatchSha256?: string;
  sourceProductTreeFingerprint?: string;
  sourceReleaseContext?: string;
  sourceHeadCommit?: string;
  sourceBaselineCommit?: string;
  sourceReviewWorkstreamId?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  if (params.command === 'status') {
    if (!params.workstreamId) return fail('workstreamId required for status');
    const record = readProtocolRecord(params.repoRoot, params.workstreamId);
    if (!record) return fail('protocol record missing');
    return succeed(`phase=${record.phase}`, record);
  }

  if (params.command === 'init') {
    const result = reduceProtocolInit({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      planPath: params.planPath,
      baseCommit: params.baseCommit,
      sourceWorkstreamIds: params.sourceWorkstreamIds,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (!params.workstreamId) {
    return fail('workstreamId required');
  }

  if (params.command === 'preflight-record') {
    if (!params.manifestPath) return fail('manifestPath required');
    const result = reducePreflightRecord({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: params.manifestPath,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'review-start') {
    if (params.pass !== 'first' && params.pass !== 'closure' && params.pass !== 'delta') {
      return fail('pass must be first|closure|delta');
    }
    const result = reduceReviewStart({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      pass: params.pass,
      now: params.now,
    });
    if (
      result.record &&
      (result.ok || result.exitCode === WORKFLOW_ROUTING_REQUIRED_EXIT_CODE)
    ) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'review-record') {
    if (!params.token) return fail('token required');
    if (params.result !== 'passed' && params.result !== 'failed') {
      return fail('result must be passed|failed');
    }
    const result = reduceReviewRecord({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      token: params.token,
      result: params.result,
      blockerFamilies: params.blockerFamilies,
      blockerIds: params.blockerIds,
      siblingSurfaces: params.siblingSurfaces,
      now: params.now,
    });
    if (
      result.record &&
      (result.ok || result.exitCode === WORKFLOW_ROUTING_REQUIRED_EXIT_CODE)
    ) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'fix-record') {
    if (!params.manifestPath) return fail('manifestPath required');
    const result = reduceFixRecord({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: params.manifestPath,
      closedBlockerIds: params.closedBlockerIds,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'split') {
    if (!params.newWorkstreamId) return fail('newWorkstreamId required');
    const result = reduceSplit({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      newWorkstreamId: params.newWorkstreamId,
      narrowerPartition: Boolean(params.narrowerPartition),
      hasFixDelta: Boolean(params.hasFixDelta),
      now: params.now,
    });
    if (result.ok && result.record && result.childRecord) {
      persistParentAndOptionalChildUnlocked({
        repoRoot: params.repoRoot,
        parent: result.record,
        child: result.childRecord,
      });
    }
    return result;
  }

  if (params.command === 'route') {
    if (!params.disposition) return fail('disposition required');
    if (!params.reason) return fail('reason required');
    const result = reduceRoute({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      disposition: params.disposition,
      reason: params.reason,
      implementationCommits: params.implementationCommits,
      revertCommit: params.revertCommit,
      supersedeCommit: params.supersedeCommit,
      successorRepo: params.successorRepo,
      successorBranch: params.successorBranch,
      successorBaseline: params.successorBaseline,
      predecessorHead: params.predecessorHead ?? params.predecessorHeadCommit,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'rehome-bind') {
    const required = {
      predecessorRootWorkstreamId: params.predecessorRootWorkstreamId,
      predecessorDescendantWorkstreamId: params.predecessorDescendantWorkstreamId,
      predecessorHeadCommit: params.predecessorHeadCommit,
      predecessorReleaseContext: params.predecessorReleaseContext,
      successorBaselineCommit: params.successorBaselineCommit,
      successorBranchName: params.successorBranchName,
      sourcePatchSha256: params.sourcePatchSha256,
      sourceProductTreeFingerprint: params.sourceProductTreeFingerprint,
      sourceReleaseContext: params.sourceReleaseContext,
      sourceHeadCommit: params.sourceHeadCommit,
      sourceBaselineCommit: params.sourceBaselineCommit,
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      return fail(`rehome-bind missing ${missing.join(', ')}`);
    }
    const result = reduceRehomeBind({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      ...required,
      sourceReviewWorkstreamId: params.sourceReviewWorkstreamId,
      now: params.now,
    } as Parameters<typeof reduceRehomeBind>[0]);
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'finalise-start') {
    const result = reduceFinaliseStart({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({
        repoRoot: params.repoRoot,
        parent: result.record,
        activateFinalise: true,
      });
    }
    return result;
  }

  return fail(`unknown command ${params.command}`);
}

export function applyProtocolTransition(params: {
  repoRoot: string;
  command: WorkflowProtocolCommand;
  workstreamId?: string;
  planPath?: string;
  baseCommit?: string;
  manifestPath?: string;
  pass?: WorkflowProtocolReviewPass;
  token?: string;
  result?: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  closedBlockerIds?: string[];
  newWorkstreamId?: string;
  narrowerPartition?: boolean;
  hasFixDelta?: boolean;
  sourceWorkstreamIds?: string[];
  disposition?: WorkflowRouteDispositionTarget;
  reason?: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
  predecessorRootWorkstreamId?: string;
  predecessorDescendantWorkstreamId?: string;
  predecessorHeadCommit?: string;
  predecessorReleaseContext?: string;
  successorBaselineCommit?: string;
  successorBranchName?: string;
  sourcePatchSha256?: string;
  sourceProductTreeFingerprint?: string;
  sourceReleaseContext?: string;
  sourceHeadCommit?: string;
  sourceBaselineCommit?: string;
  sourceReviewWorkstreamId?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const runUnlocked = (): WorkflowProtocolTransitionResult => {
    try {
      return applyProtocolTransitionUnlocked(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/malformed/i.test(message)) {
        return fail(message);
      }
      throw error;
    }
  };
  // Status is read-only and does not need the mutation lock.
  if (params.command === 'status') {
    return runUnlocked();
  }
  const paths = getWorkflowPaths(params.repoRoot);
  return withWorkflowLock(paths.lockPath, runUnlocked);
}
