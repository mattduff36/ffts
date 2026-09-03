import type {
  WorkflowProtocolPhase,
  WorkflowProtocolRecord,
  WorkflowProtocolReviewAttempt,
  WorkflowProtocolReviewPass,
  WorkflowRehomeProvenance,
} from './types';
import { assertSafeOpaqueId, parseOptionalRehomeProvenance } from './workflow-plan-contract';
import {
  isNonReleaseDispositionPhase,
  lineageBudgetExhausted,
  lineageFailedPremiumReviewCount,
} from './workflow-v24-disposition';

const CURRENT_SCHEMA = '1' as const;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const COMMIT_RE = /^[0-9a-f]{7,64}$/iu;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/u;
const TOKEN_RE = /^rev_(first|closure|delta)_[A-Za-z0-9_-]{1,80}$/u;
const REVIEW_PASSES = new Set<WorkflowProtocolReviewPass>(['first', 'closure', 'delta']);
const ACTIVE_REVIEW_PHASES = new Set<WorkflowProtocolPhase>([
  'first_review',
  'closure_review',
  'delta_review',
]);
const SUCCESS_PHASES = new Set<WorkflowProtocolPhase>([
  'review_closed',
  'finalise_ready',
  'finalised',
]);
const CURRENT_PHASES = new Set<WorkflowProtocolPhase>([
  'initialized',
  'preflight_ready',
  'first_review',
  'fix_sweep_required',
  'fix_recorded',
  'closure_review',
  'delta_review',
  'review_closed',
  'routing_required',
  'split',
  'finalise_ready',
  'finalised',
  'removed_from_release',
  'reverted',
  'superseded',
  'rehomed',
]);

export type ProtocolValidationResult =
  | { ok: true; record: WorkflowProtocolRecord; historic?: false }
  | { ok: false; message: string };

function fail(message: string): ProtocolValidationResult {
  return { ok: false, message: `protocol record is malformed: ${message}` };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}

function isCommitToken(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_RE.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim());
}

function isNullableString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

function validateAttemptStructure(
  value: unknown,
  index: number
): { ok: true; attempt: WorkflowProtocolReviewAttempt } | { ok: false; message: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: `reviewAttempts[${index}] is not an object` };
  }
  const attempt = value as Partial<WorkflowProtocolReviewAttempt>;
  if (!REVIEW_PASSES.has(attempt.pass as WorkflowProtocolReviewPass)) {
    return { ok: false, message: `reviewAttempts[${index}].pass is invalid` };
  }
  if (typeof attempt.token !== 'string' || !TOKEN_RE.test(attempt.token)) {
    return { ok: false, message: `reviewAttempts[${index}].token is invalid` };
  }
  if (!isIsoTimestamp(attempt.startedAt)) {
    return { ok: false, message: `reviewAttempts[${index}].startedAt is invalid` };
  }
  if (attempt.headCommit != null && !isCommitToken(attempt.headCommit)) {
    return { ok: false, message: `reviewAttempts[${index}].headCommit is invalid` };
  }
  if (
    attempt.treeFingerprint != null &&
    (typeof attempt.treeFingerprint !== 'string' || !attempt.treeFingerprint.trim())
  ) {
    return { ok: false, message: `reviewAttempts[${index}].treeFingerprint is invalid` };
  }
  if (attempt.result !== undefined) {
    if (attempt.result !== 'passed' && attempt.result !== 'failed') {
      return { ok: false, message: `reviewAttempts[${index}].result is invalid` };
    }
    if (!isIsoTimestamp(attempt.recordedAt)) {
      return { ok: false, message: `reviewAttempts[${index}].recordedAt is required when result is set` };
    }
    if (attempt.result === 'passed') {
      if (!isCommitToken(attempt.headCommit) || typeof attempt.treeFingerprint !== 'string') {
        return {
          ok: false,
          message: `reviewAttempts[${index}] passed result requires headCommit and treeFingerprint`,
        };
      }
    }
    if (attempt.result === 'failed') {
      if (!isStringArray(attempt.blockerFamilies ?? []) || !isStringArray(attempt.blockerIds ?? [])) {
        return {
          ok: false,
          message: `reviewAttempts[${index}] failed result requires blockerFamilies and blockerIds`,
        };
      }
    }
  }
  if (attempt.blockerFamilies !== undefined && !isStringArray(attempt.blockerFamilies)) {
    return { ok: false, message: `reviewAttempts[${index}].blockerFamilies is invalid` };
  }
  if (attempt.blockerIds !== undefined && !isStringArray(attempt.blockerIds)) {
    return { ok: false, message: `reviewAttempts[${index}].blockerIds is invalid` };
  }
  if (attempt.siblingSurfaces !== undefined && !isStringArray(attempt.siblingSurfaces)) {
    return { ok: false, message: `reviewAttempts[${index}].siblingSurfaces is invalid` };
  }
  return { ok: true, attempt: attempt as WorkflowProtocolReviewAttempt };
}

function validateRehome(value: unknown): { ok: true } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true };
  const parsed = parseOptionalRehomeProvenance(value);
  if (parsed.errors.length > 0) {
    return { ok: false, message: `rehomeProvenance is malformed: ${parsed.errors.join('; ')}` };
  }
  const provenance = value as WorkflowRehomeProvenance;
  if (provenance.schemaVersion !== '1') {
    return { ok: false, message: 'rehomeProvenance.schemaVersion is unsupported' };
  }
  if (provenance.predecessorPassedReview !== false) {
    return { ok: false, message: 'rehomeProvenance cannot claim predecessorPassedReview' };
  }
  if (provenance.predecessorHeadIsAncestor !== false) {
    return { ok: false, message: 'rehomeProvenance cannot claim predecessorHeadIsAncestor' };
  }
  return { ok: true };
}

export function validateWorkflowProtocolRecordStructure(
  value: unknown
): ProtocolValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('unsupported or malformed schema');
  }
  const candidate = value as Partial<WorkflowProtocolRecord> & Record<string, unknown>;
  if (candidate.schemaVersion !== CURRENT_SCHEMA) {
    return fail('unsupported or malformed schema');
  }
  if (typeof candidate.workstreamId !== 'string') {
    return fail('workstreamId missing');
  }
  const safeId = assertSafeOpaqueId(candidate.workstreamId, 'workstreamId');
  if (!safeId.ok) return fail(safeId.error);
  if (candidate.identityStatus !== 'present') {
    return fail('identityStatus must be present');
  }
  if (
    typeof candidate.inheritedFailedReviewCount !== 'number' ||
    !Number.isInteger(candidate.inheritedFailedReviewCount) ||
    candidate.inheritedFailedReviewCount < 0
  ) {
    return fail('inheritedFailedReviewCount is invalid');
  }
  if (candidate.branchName != null && (typeof candidate.branchName !== 'string' || !BRANCH_RE.test(candidate.branchName))) {
    return fail('branchName is invalid');
  }
  if (!isCommitToken(candidate.baseCommit)) {
    return fail('baseCommit is invalid');
  }
  if (candidate.headCommit != null && !isCommitToken(candidate.headCommit)) {
    return fail('headCommit is invalid');
  }
  if (
    typeof candidate.phase !== 'string' ||
    !CURRENT_PHASES.has(candidate.phase as WorkflowProtocolPhase)
  ) {
    return fail('phase is invalid');
  }
  if (typeof candidate.nextAction !== 'string' || !candidate.nextAction.trim()) {
    return fail('nextAction is invalid');
  }
  if (
    typeof candidate.failedPremiumReviewCount !== 'number' ||
    !Number.isInteger(candidate.failedPremiumReviewCount) ||
    candidate.failedPremiumReviewCount < 0
  ) {
    return fail('failedPremiumReviewCount is invalid');
  }
  if (candidate.activeReviewToken != null) {
    if (typeof candidate.activeReviewToken !== 'string' || !TOKEN_RE.test(candidate.activeReviewToken)) {
      return fail('activeReviewToken is invalid');
    }
  }
  if (candidate.activeReviewPass != null && !REVIEW_PASSES.has(candidate.activeReviewPass)) {
    return fail('activeReviewPass is invalid');
  }
  if (!Array.isArray(candidate.reviewAttempts)) {
    return fail('reviewAttempts must be an array');
  }
  const attempts: WorkflowProtocolReviewAttempt[] = [];
  for (const [index, raw] of candidate.reviewAttempts.entries()) {
    const checked = validateAttemptStructure(raw, index);
    if (!checked.ok) return fail(checked.message);
    attempts.push(checked.attempt);
  }
  if (!isStringArray(candidate.blockerFamilies)) {
    return fail('blockerFamilies is invalid');
  }
  if (!isStringArray(candidate.openBlockerIds)) {
    return fail('openBlockerIds is invalid');
  }
  if (!isNullableString(candidate.evidenceManifestPath ?? null) && candidate.evidenceManifestPath !== null) {
    return fail('evidenceManifestPath is invalid');
  }
  if (!isNullableString(candidate.fixDeltaManifestPath ?? null) && candidate.fixDeltaManifestPath !== null) {
    return fail('fixDeltaManifestPath is invalid');
  }
  if (!isNullableString(candidate.activeCheckpointId ?? null) && candidate.activeCheckpointId !== null) {
    return fail('activeCheckpointId is invalid');
  }
  if (!isNullableString(candidate.planPath ?? null) && candidate.planPath !== null) {
    return fail('planPath is invalid');
  }
  if (
    candidate.reviewedTreeFingerprint != null &&
    (typeof candidate.reviewedTreeFingerprint !== 'string' || !candidate.reviewedTreeFingerprint.trim())
  ) {
    return fail('reviewedTreeFingerprint is invalid');
  }
  if (!isIsoTimestamp(candidate.updatedAt)) {
    return fail('updatedAt is invalid');
  }
  if (candidate.sourceWorkstreamIds !== undefined && !isStringArray(candidate.sourceWorkstreamIds)) {
    return fail('sourceWorkstreamIds is invalid');
  }
  if (
    candidate.rehomeProvenance != null &&
    (typeof candidate.rehomeProvenance !== 'object' || Array.isArray(candidate.rehomeProvenance))
  ) {
    return fail('rehomeProvenance is malformed');
  }
  return { ok: true, record: candidate as WorkflowProtocolRecord };
}

export type LatestLegalFinalDiffAttemptResult =
  | { ok: true; attempt: WorkflowProtocolReviewAttempt | null }
  | { ok: false; message: string };

/**
 * Latest applicable legal premium final-diff attempt.
 * Considers `first`, then `closure` only if legally used.
 * Architecture, economical challenge, fix-delta, route, split, historical
 * non-final-diff attempts, and illegal extra first/closure rows are not
 * current premium final-diff authority. Duplicate or impossible ordering
 * fails closed.
 */
export function latestLegalFinalDiffAttempt(
  record: Pick<WorkflowProtocolRecord, 'reviewAttempts' | 'inheritedFailedReviewCount'>
): LatestLegalFinalDiffAttemptResult {
  const inherited = record.inheritedFailedReviewCount;
  if (inherited >= 2) {
    return { ok: true, attempt: null };
  }

  let first: WorkflowProtocolReviewAttempt | undefined;
  let closure: WorkflowProtocolReviewAttempt | undefined;
  let firstIndex = -1;
  let closureIndex = -1;

  for (const [index, attempt] of record.reviewAttempts.entries()) {
    if (attempt.pass === 'first') {
      if (inherited >= 1 || first || closure) {
        return { ok: false, message: 'impossible first/closure attempt ordering' };
      }
      first = attempt;
      firstIndex = index;
      continue;
    }
    if (attempt.pass === 'closure') {
      if (closure) {
        return { ok: false, message: 'impossible first/closure attempt ordering' };
      }
      if (!first && inherited < 1) {
        return { ok: false, message: 'impossible first/closure attempt ordering' };
      }
      if (first && index < firstIndex) {
        return { ok: false, message: 'impossible first/closure attempt ordering' };
      }
      closure = attempt;
      closureIndex = index;
    }
  }

  if (first && closure && closureIndex < firstIndex) {
    return { ok: false, message: 'impossible first/closure attempt ordering' };
  }

  return { ok: true, attempt: closure ?? first ?? null };
}

/**
 * Historical/audit identity only. Never grants current protected-finalise authority.
 */
function lastPassedLegalAttempt(
  record: WorkflowProtocolRecord
): WorkflowProtocolReviewAttempt | null {
  for (let index = record.reviewAttempts.length - 1; index >= 0; index -= 1) {
    const attempt = record.reviewAttempts[index];
    if (attempt.result !== 'passed' || !isCommitToken(attempt.headCommit) || typeof attempt.treeFingerprint !== 'string') {
      continue;
    }
    if (attempt.pass === 'first' || attempt.pass === 'closure') {
      return attempt;
    }
    if (attempt.pass === 'delta') {
      const priorLegal = record.reviewAttempts
        .slice(0, index)
        .some(
          (prior) =>
            prior.result === 'passed' && (prior.pass === 'first' || prior.pass === 'closure')
        );
      if (priorLegal) return attempt;
    }
  }
  return null;
}

export function validateWorkflowProtocolRecordSemantics(
  record: WorkflowProtocolRecord
): ProtocolValidationResult {
  const failedAttempts = record.reviewAttempts.filter(
    (attempt) =>
      attempt.result === 'failed' && (attempt.pass === 'first' || attempt.pass === 'closure')
  ).length;
  if (record.failedPremiumReviewCount < failedAttempts) {
    return fail('failedPremiumReviewCount is lower than recorded failed first/closure attempts');
  }
  if (record.failedPremiumReviewCount < record.inheritedFailedReviewCount) {
    return fail('failedPremiumReviewCount cannot be lower than inheritedFailedReviewCount');
  }
  if (
    record.phase !== 'routing_required' &&
    record.failedPremiumReviewCount > record.inheritedFailedReviewCount + failedAttempts
  ) {
    return fail('failedPremiumReviewCount is inconsistent with inherited and recorded failures');
  }
  const rehome = validateRehome(record.rehomeProvenance);
  if (!rehome.ok) return fail(rehome.message);

  const latestLegal = latestLegalFinalDiffAttempt(record);
  if (!latestLegal.ok) return fail(latestLegal.message);
  const passes = record.reviewAttempts.map((attempt) => attempt.pass);
  const deltaIndex = passes.indexOf('delta');
  if (deltaIndex !== -1) {
    const priorPassed = record.reviewAttempts.some(
      (attempt, index) =>
        index < deltaIndex &&
        attempt.result === 'passed' &&
        (attempt.pass === 'first' || attempt.pass === 'closure')
    );
    if (!priorPassed) {
      return fail('delta attempt without prior passed first or closure');
    }
  }

  if (ACTIVE_REVIEW_PHASES.has(record.phase)) {
    const expectedPass =
      record.phase === 'first_review'
        ? 'first'
        : record.phase === 'closure_review'
          ? 'closure'
          : 'delta';
    if (!record.activeReviewToken || record.activeReviewPass !== expectedPass) {
      return fail('inconsistent active review token');
    }
    const match = record.reviewAttempts.find((attempt) => attempt.token === record.activeReviewToken);
    if (!match || match.pass !== record.activeReviewPass || match.result) {
      return fail('inconsistent active review token');
    }
  } else if (record.activeReviewToken !== null || record.activeReviewPass !== null) {
    return fail('inconsistent active review token');
  }

  const exhausted =
    lineageBudgetExhausted(record) || record.phase === 'routing_required';
  const reviewedIdentity = lastPassedLegalAttempt(record);
  if (exhausted && SUCCESS_PHASES.has(record.phase)) {
    return fail('failed/routing record claims successful review authority');
  }
  if (SUCCESS_PHASES.has(record.phase)) {
    if (!latestLegal.attempt || latestLegal.attempt.result !== 'passed') {
      return fail('latest legal final-diff attempt does not authorize success phase');
    }
  }
  if (record.phase === 'routing_required' && lineageFailedPremiumReviewCount(record) < 2) {
    return fail('routing_required requires an exhausted premium-review budget');
  }

  if (SUCCESS_PHASES.has(record.phase)) {
    if (
      !reviewedIdentity ||
      !record.headCommit ||
      record.headCommit !== reviewedIdentity.headCommit ||
      !record.reviewedTreeFingerprint ||
      record.reviewedTreeFingerprint !== reviewedIdentity.treeFingerprint
    ) {
      return fail('inconsistent reviewed HEAD/fingerprint state');
    }
  }

  if (record.phase === 'finalise_ready') {
    if (!record.activeCheckpointId) {
      return fail('inconsistent finalise state');
    }
    if (record.activeReviewToken !== null || record.activeReviewPass !== null) {
      return fail('inconsistent finalise state');
    }
  }
  if (record.phase === 'finalised') {
    if (record.activeCheckpointId !== null) {
      return fail('inconsistent finalise state');
    }
    if (record.activeReviewToken !== null || record.activeReviewPass !== null) {
      return fail('inconsistent finalise state');
    }
    if (record.nextAction !== 'done') {
      return fail('inconsistent finalise state');
    }
  }
  if (isNonReleaseDispositionPhase(record.phase) && SUCCESS_PHASES.has(record.phase)) {
    return fail('inconsistent finalise state');
  }

  return { ok: true, record };
}

/**
 * Strict current-V2.4 validator. Does not repair records.
 */
export function validateCurrentV24ProtocolRecord(value: unknown): ProtocolValidationResult {
  const structure = validateWorkflowProtocolRecordStructure(value);
  if (!structure.ok) return structure;
  return validateWorkflowProtocolRecordSemantics(structure.record);
}

/**
 * Bounded historic audit path. Never grants review or finalise authority.
 */
export function validateHistoricProtocolRecordForAudit(
  value: unknown
): ProtocolValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('unsupported historic schema');
  }
  const candidate = value as Partial<WorkflowProtocolRecord>;
  if (candidate.schemaVersion !== '1') {
    return fail('unsupported historic schema');
  }
  if (typeof candidate.workstreamId !== 'string') {
    return fail('historic workstreamId missing');
  }
  if (!assertSafeOpaqueId(candidate.workstreamId, 'workstreamId').ok) {
    return fail('historic workstreamId is invalid');
  }
  if (candidate.identityStatus !== 'present') {
    return fail('historic identityStatus is invalid');
  }
  if (typeof candidate.baseCommit !== 'string' || !candidate.baseCommit) {
    return fail('historic baseCommit is invalid');
  }
  if (typeof candidate.phase !== 'string' || !CURRENT_PHASES.has(candidate.phase as WorkflowProtocolPhase)) {
    return fail('historic phase is invalid');
  }
  if (typeof candidate.nextAction !== 'string') {
    return fail('historic nextAction is invalid');
  }
  if (
    typeof candidate.failedPremiumReviewCount !== 'number' ||
    !Number.isInteger(candidate.failedPremiumReviewCount) ||
    candidate.failedPremiumReviewCount < 0
  ) {
    return fail('historic failedPremiumReviewCount is invalid');
  }
  if (!Array.isArray(candidate.reviewAttempts) || !Array.isArray(candidate.blockerFamilies) || !Array.isArray(candidate.openBlockerIds)) {
    return fail('historic arrays are invalid');
  }
  return { ok: true, record: candidate as WorkflowProtocolRecord, historic: false };
}

export function isCurrentV24ProtocolRecord(value: unknown): value is WorkflowProtocolRecord {
  return validateCurrentV24ProtocolRecord(value).ok;
}
