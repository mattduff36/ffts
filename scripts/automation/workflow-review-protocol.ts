import { createHash, randomBytes } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import type {
  WorkflowActiveFinaliseContext,
  WorkflowProtocolPhase,
  WorkflowProtocolRecord,
  WorkflowProtocolReviewAttempt,
  WorkflowProtocolReviewPass,
  WorkflowReviewState,
} from './types';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
  saveWorkflowReviewState,
  upsertWorkstreamRecord,
  withWorkflowLock,
  writeJsonAtomic,
} from './workflow-events';
import {
  assertSafeOpaqueId,
  extractPlanContractMarker,
  isCriticalPlanContract,
  resolvePlanPath,
  resolveRequiredTestIdsForWorkstream,
} from './workflow-plan-contract';
import { getCurrentTreeFingerprint } from './workflow-evidence-manifest';

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
    updatedAt: nowIso(params.now),
  };
}

export function isWorkflowProtocolRecord(value: unknown): value is WorkflowProtocolRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkflowProtocolRecord>;
  return (
    candidate.schemaVersion === '1' &&
    typeof candidate.workstreamId === 'string' &&
    candidate.identityStatus === 'present' &&
    typeof candidate.baseCommit === 'string' &&
    typeof candidate.phase === 'string' &&
    typeof candidate.failedPremiumReviewCount === 'number' &&
    Array.isArray(candidate.reviewAttempts)
  );
}

export function readProtocolRecord(
  repoRoot: string,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const filePath = getProtocolRecordPath(repoRoot, workstreamId);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return isWorkflowProtocolRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeProtocolRecord(repoRoot: string, record: WorkflowProtocolRecord): string {
  const filePath = getProtocolRecordPath(repoRoot, record.workstreamId);
  writeJsonAtomic(filePath, record);
  return filePath;
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
    if (params.requireKind === 'preflight') {
      const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
      if (commands.length === 0) {
        return { ok: false, message: 'preflight manifest requires executed commands', absolutePath };
      }
      const requiredTests = Array.isArray(parsed.requiredTests) ? parsed.requiredTests : [];
      const incomplete = requiredTests.filter((entry) => {
        if (!entry || typeof entry !== 'object') return true;
        const row = entry as Record<string, unknown>;
        return row.status !== 'completed' || row.behavioral !== true || row.executed !== true;
      });
      if (requiredTests.length > 0 && incomplete.length > 0) {
        return {
          ok: false,
          message: 'preflight requiredTests must be behavioral and executed',
          absolutePath,
        };
      }
      if (params.expectedRequiredTestIds && params.expectedRequiredTestIds.length > 0) {
        const presentIds = new Set(
          requiredTests
            .map((entry) =>
              entry && typeof entry === 'object'
                ? (entry as Record<string, unknown>).id
                : null
            )
            .filter((id): id is string => typeof id === 'string')
        );
        const missingPlanIds = params.expectedRequiredTestIds.filter((id) => !presentIds.has(id));
        if (missingPlanIds.length > 0) {
          return {
            ok: false,
            message: `preflight missing plan requiredTests: ${missingPlanIds.join(', ')}`,
            absolutePath,
          };
        }
      }
    }
    if (params.requireKind === 'fix-delta') {
      const closed = Array.isArray(parsed.closedBlockerIds)
        ? parsed.closedBlockerIds.filter((id): id is string => typeof id === 'string')
        : [];
      const evidence = Array.isArray(parsed.blockerEvidence) ? parsed.blockerEvidence : [];
      const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
      if (closed.length === 0) {
        return { ok: false, message: 'fix-delta requires closedBlockerIds', absolutePath };
      }
      if (evidence.length === 0) {
        return { ok: false, message: 'fix-delta requires blockerEvidence mappings', absolutePath };
      }
      for (const blockerId of closed) {
        const matched = evidence.find((entry) => {
          if (!entry || typeof entry !== 'object') return false;
          return (entry as Record<string, unknown>).blockerId === blockerId;
        }) as Record<string, unknown> | undefined;
        if (!matched) {
          return {
            ok: false,
            message: `fix-delta missing blockerEvidence for ${blockerId}`,
            absolutePath,
          };
        }
        if (typeof matched.evidenceLabel !== 'string' || !matched.evidenceLabel.trim()) {
          return {
            ok: false,
            message: `fix-delta blockerEvidence for ${blockerId} lacks evidenceLabel`,
            absolutePath,
          };
        }
        if (typeof matched.commandName !== 'string' || !matched.commandName.trim()) {
          return {
            ok: false,
            message: `fix-delta blockerEvidence for ${blockerId} lacks commandName`,
            absolutePath,
          };
        }
        const commandPassed = commands.some((entry) => {
          if (!entry || typeof entry !== 'object') return false;
          const row = entry as Record<string, unknown>;
          return row.name === matched.commandName && row.status === 'passed';
        });
        if (!commandPassed) {
          return {
            ok: false,
            message: `fix-delta blockerEvidence for ${blockerId} commandName was not a passed command`,
            absolutePath,
          };
        }
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

  const existing = readProtocolRecord(params.repoRoot, workstreamId);
  if (existing && existing.phase !== 'initialized') {
    return fail(`protocol already exists in phase ${existing.phase}`, existing);
  }

  if (sourceWorkstreamIds?.length) {
    for (const sourceId of sourceWorkstreamIds) {
      const source = readProtocolRecord(params.repoRoot, sourceId);
      if (source) {
        inheritedFailedReviewCount = Math.max(
          inheritedFailedReviewCount,
          source.failedPremiumReviewCount
        );
      }
    }
  }

  const baseCommit =
    params.baseCommit?.trim() ||
    runGit(params.repoRoot, ['rev-parse', 'HEAD']) ||
    '';
  if (!/^[0-9a-f]{7,64}$/i.test(baseCommit)) {
    return fail('baseCommit must be an explicit git commit hash');
  }

  const record = createEmptyProtocolRecord({
    workstreamId,
    baseCommit,
    branchName: runGit(params.repoRoot, ['branch', '--show-current']),
    headCommit: runGit(params.repoRoot, ['rev-parse', 'HEAD']),
    planPath,
    sourceWorkstreamIds,
    inheritedFailedReviewCount,
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
  if (current.phase !== 'initialized' && current.phase !== 'preflight_ready') {
    return fail(`preflight-record not allowed in phase ${current.phase}`, current);
  }
  let expectedRequiredTestIds: string[] | undefined;
  if (current.planPath) {
    const absolutePlanPath = resolveProtocolPlanAbsolutePath(
      params.repoRoot,
      current.planPath
    );
    if (!existsSync(absolutePlanPath)) {
      return fail(
        `preflight plan missing or unreadable: ${current.planPath}`,
        current
      );
    }
    let parsedPlan: ReturnType<typeof extractPlanContractMarker>;
    try {
      parsedPlan = extractPlanContractMarker(readFileSync(absolutePlanPath, 'utf8'));
    } catch (error) {
      return fail(
        `preflight plan unreadable: ${
          error instanceof Error ? error.message : 'unknown read error'
        }`,
        current
      );
    }
    if (parsedPlan.status !== 'present' || !parsedPlan.contract) {
      return fail(
        `preflight plan contract ${parsedPlan.status}: ${
          parsedPlan.errors.join('; ') || 'malformed'
        }`,
        current
      );
    }
    // Child workstreams bind to child-owned requiredTestIds; master uses requiredTests.
    expectedRequiredTestIds = resolveRequiredTestIdsForWorkstream(
      parsedPlan.contract,
      params.workstreamId
    )
      // Deferred pay behavioral IDs are inventory obligations until live-db mode.
      .filter((id) => !id.startsWith('WF-PAY-'));
  }

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

  if (current.phase === 'routing_required') {
    return fail(
      'routing_required: launch premium-fix-routing or split; review-start rejected',
      current,
      WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
    );
  }

  if (params.pass === 'delta') {
    if (current.phase !== 'review_closed' && current.phase !== 'finalise_ready') {
      return fail(`delta review-start requires review_closed (have ${current.phase})`, current);
    }
    const token = createToken('rev_delta');
    const attempt: WorkflowProtocolReviewAttempt = {
      pass: 'delta',
      token,
      startedAt: nowIso(params.now),
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

  if (params.pass === 'first') {
    if (current.phase !== 'preflight_ready') {
      return fail(`first review-start requires preflight_ready (have ${current.phase})`, current);
    }
    if (!current.evidenceManifestPath) {
      return fail('first review requires a recorded preflight manifest', current);
    }
    const validation = validateEvidenceManifest({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: current.evidenceManifestPath,
      requireKind: 'preflight',
      expectedBaseCommit: current.baseCommit,
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
    if (current.failedPremiumReviewCount >= 2) {
      return fail(
        'review budget exhausted; routing_required',
        current,
        WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
      );
    }
    const validation = validateEvidenceManifest({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: current.fixDeltaManifestPath,
      requireKind: 'fix-delta',
      expectedBaseCommit: current.baseCommit,
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
  if (current.phase !== 'first_review' && current.phase !== 'closure_review' && current.phase !== 'delta_review') {
    return fail(`review-record not allowed in phase ${current.phase}`, current);
  }
  if (!current.activeReviewToken || current.activeReviewToken !== params.token) {
    return fail('invalid or consumed review token', current);
  }
  if (!current.activeReviewPass) {
    return fail('active review pass missing', current);
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
    if (
      (current.activeReviewPass === 'closure' || current.activeReviewPass === 'delta') &&
      current.openBlockerIds.length > 0
    ) {
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
    phase = 'fix_sweep_required';
    nextAction = 'consolidated_fix_record';
    message = 'delta review failed; consolidated fix sweep required';
  } else {
    failedCount += 1;
    if (failedCount >= 2) {
      phase = 'routing_required';
      nextAction = 'premium_fix_routing_or_split';
      exitCode = WORKFLOW_ROUTING_REQUIRED_EXIT_CODE;
      message = 'second failed premium review; routing_required';
    } else {
      phase = 'fix_sweep_required';
      nextAction = 'consolidated_fix_record';
      message = 'first failed review; consolidated fix sweep required';
    }
  }

  const reviewedHead =
    params.result === 'passed' ? runGit(params.repoRoot, ['rev-parse', 'HEAD']) : null;
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
    headCommit: reviewedHead ?? current.headCommit,
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
  const validation = validateEvidenceManifest({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    manifestPath: params.manifestPath,
    requireKind: 'fix-delta',
    expectedBaseCommit: current.baseCommit,
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
    splitWorkstreamId: childId,
    // Attach child via message channel; persistProtocolTransition writes both.
  };
}

export function reduceFinaliseStart(params: {
  repoRoot: string;
  workstreamId: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (current.phase !== 'review_closed' && current.phase !== 'finalise_ready') {
    return fail(`finalise-start requires review_closed (have ${current.phase})`, current);
  }
  const currentHead = runGit(params.repoRoot, ['rev-parse', 'HEAD']);
  if (!currentHead) {
    return fail('finalise-start requires a readable git HEAD', current);
  }
  if (!current.headCommit) {
    return fail('finalise-start requires a reviewed headCommit bound by a successful review', current);
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
  if (current.phase !== 'finalise_ready' && current.phase !== 'finalised') {
    return { state: params.state, record: current };
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
  // Intentionally do not write protocol.json yet — commit after state save.
  let nextState = upsertProtocolInState(params.state, finalized);
  if (nextState.activeFinaliseContext?.workstreamId === params.workstreamId) {
    nextState = setActiveFinaliseContext(nextState, null);
  }
  return { state: nextState, record: finalized };
}

/**
 * Persist shared workflow state first, then mark matched protocols finalised on disk.
 * If either step fails, restore prior protocol records and prior state when possible.
 */
export function commitFinaliseCorrelationStateAndProtocols(params: {
  repoRoot: string;
  statePath: string;
  previousState: WorkflowReviewState;
  nextState: WorkflowReviewState;
  workstreamIds: string[];
}): void {
  const protocolBackups = new Map<string, WorkflowProtocolRecord | null>();
  for (const workstreamId of params.workstreamIds) {
    protocolBackups.set(workstreamId, readProtocolRecord(params.repoRoot, workstreamId));
  }

  const restore = (): void => {
    for (const [, previous] of protocolBackups) {
      if (previous) {
        writeProtocolRecord(params.repoRoot, previous);
      }
    }
    try {
      saveWorkflowReviewState(params.statePath, params.previousState);
    } catch {
      // Best-effort restore; original error is rethrown by caller.
    }
  };

  try {
    saveWorkflowReviewState(params.statePath, params.nextState);
    for (const workstreamId of params.workstreamIds) {
      const record = params.nextState.protocolRecords?.[workstreamId];
      if (record && isWorkflowProtocolRecord(record) && record.phase === 'finalised') {
        writeProtocolRecord(params.repoRoot, record);
      }
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

function createSplitChildRecord(params: {
  parent: WorkflowProtocolRecord;
  newWorkstreamId: string;
  narrowerPartition: boolean;
  hasFixDelta: boolean;
  failedPremiumReviewCount: number;
  openBlockerIds: string[];
  blockerFamilies: string[];
  now?: () => Date;
}): WorkflowProtocolRecord {
  const inheritBudget =
    params.narrowerPartition || params.hasFixDelta
      ? params.failedPremiumReviewCount
      : Math.max(params.failedPremiumReviewCount, 2);
  const child = createEmptyProtocolRecord({
    workstreamId: params.newWorkstreamId,
    baseCommit: params.parent.baseCommit,
    branchName: params.parent.branchName,
    headCommit: params.parent.headCommit,
    planPath: params.parent.planPath,
    sourceWorkstreamIds: [params.parent.workstreamId, ...(params.parent.sourceWorkstreamIds ?? [])],
    inheritedFailedReviewCount: inheritBudget,
    now: params.now,
  });
  child.openBlockerIds = [...params.openBlockerIds];
  child.blockerFamilies = [...params.blockerFamilies];
  if (!params.narrowerPartition && !params.hasFixDelta) {
    child.phase = 'routing_required';
    child.nextAction = 'premium_fix_routing_or_split';
  }
  return child;
}

function persistParentAndOptionalChildUnlocked(params: {
  repoRoot: string;
  parent: WorkflowProtocolRecord;
  child?: WorkflowProtocolRecord;
  activateFinalise?: boolean;
}): void {
  const paths = getWorkflowPaths(params.repoRoot);
  writeProtocolRecord(params.repoRoot, params.parent);
  if (params.child) {
    writeProtocolRecord(params.repoRoot, params.child);
  }
  let state = loadWorkflowReviewState(paths.statePath);
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
    state = setActiveFinaliseContext(state, {
      workstreamId: params.parent.workstreamId,
      checkpointId: params.parent.activeCheckpointId,
      activatedAt: params.parent.updatedAt,
    });
  }
  saveWorkflowReviewState(paths.statePath, state);
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
    const parentBefore = readProtocolRecord(params.repoRoot, params.workstreamId);
    const result = reduceSplit({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      newWorkstreamId: params.newWorkstreamId,
      narrowerPartition: Boolean(params.narrowerPartition),
      hasFixDelta: Boolean(params.hasFixDelta),
      now: params.now,
    });
    if (result.ok && result.record && result.splitWorkstreamId) {
      const child = createSplitChildRecord({
        parent: result.record,
        newWorkstreamId: result.splitWorkstreamId,
        narrowerPartition: Boolean(params.narrowerPartition),
        hasFixDelta: Boolean(params.hasFixDelta),
        failedPremiumReviewCount: parentBefore?.failedPremiumReviewCount ?? 0,
        openBlockerIds: parentBefore?.openBlockerIds ?? [],
        blockerFamilies: parentBefore?.blockerFamilies ?? [],
        now: params.now,
      });
      persistParentAndOptionalChildUnlocked({
        repoRoot: params.repoRoot,
        parent: result.record,
        child,
      });
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
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  // Status is read-only and does not need the mutation lock.
  if (params.command === 'status') {
    return applyProtocolTransitionUnlocked(params);
  }
  const paths = getWorkflowPaths(params.repoRoot);
  return withWorkflowLock(paths.lockPath, () => applyProtocolTransitionUnlocked(params));
}
