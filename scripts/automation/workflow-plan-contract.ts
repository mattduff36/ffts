import { createHash, randomBytes } from 'crypto';
import { existsSync, lstatSync, realpathSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type {
  WorkflowCommitStatus,
  WorkflowGateDecision,
  WorkflowHandoffStatus,
  WorkflowLane,
  WorkflowParentTier,
  WorkflowPlanArchitectureGateEvidence,
  WorkflowPlanContract,
  WorkflowPlanModels,
  WorkflowRehomeProvenance,
  WorkflowRequiredTest,
  WorkflowReviewSource,
  WorkflowRisk,
  WorkflowRoutingDecision,
  WorkflowSwitchTiming,
  WorkflowTaskType,
} from './types';
import {
  WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
  classifyWorkflowModelTier,
  getWorkflowModelRole,
} from './workflow-model-tier';
import { hashIdentifier } from './workflow-privacy';

export const PLAN_CONTRACT_MARKER_PREFIX_V2 = '<!-- plan-contract-marker:v2';
export const PLAN_CONTRACT_MARKER_PREFIX_V1 = '<!-- plan-contract-marker:v1';
export const PLAN_CONTRACT_MARKER_PREFIX = PLAN_CONTRACT_MARKER_PREFIX_V2;
export const PLAN_CONTRACT_MARKER_SUFFIX = '-->';
export const PLAN_CONTRACT_MAX_BYTES = 512_000;
export const FFTS_CANONICAL_PLAN_ROOT = path.join('docs_private', 'automation', 'plans');

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/u;
const TASK_TYPES = new Set<WorkflowTaskType>(['change', 'planning', 'review']);
const LANES = new Set<WorkflowLane>(['fast', 'standard', 'guarded', 'critical']);
const RISKS = new Set<WorkflowRisk>(['high', 'routine']);
const PARENT_TIERS = new Set<WorkflowParentTier>(['premium', 'economical', 'unknown']);
const ROUTING_DECISIONS = new Set<WorkflowRoutingDecision>([
  'switched_to_economical',
  'continued_premium',
  'economical_default',
  'explicit_premium',
  'not_applicable',
  'unknown',
]);
const GATE_DECISIONS = new Set<WorkflowGateDecision>([
  'approved',
  'approved_with_conditions',
  'blocked',
  'skipped',
  'not_applicable',
  'unknown',
]);
const REVIEW_SOURCES = new Set<WorkflowReviewSource>([
  'independent_subagent',
  'parent_structured',
  'local',
  'not_applicable',
  'unknown',
]);
const COMMIT_STATES = new Set<WorkflowCommitStatus>([
  'completed',
  'not_applicable',
  'pending',
  'unknown',
]);
const HANDOFF_STATES = new Set<WorkflowHandoffStatus>(['completed', 'pending', 'unknown']);
const SWITCH_TIMINGS = new Set<string>([
  'before_substantive_implementation',
  'after_plan_approval',
  'after-plan-and-architecture-approval',
  'not_applicable',
]);

const REQUIRED_HEADINGS = [
  '## Classification',
  '## Recommended build model',
  '## Architecture gate',
  '## Implementation contract',
  '## Required tests',
  '## Final review',
  '## Commit and handoff',
];

export interface ParsedPlanContract {
  status: 'present' | 'missing' | 'malformed';
  contract: WorkflowPlanContract | null;
  errors: string[];
  raw?: string;
}

export interface PlanPathResolution {
  status: 'ok' | 'rejected';
  absolutePath: string | null;
  source: 'repo_relative' | 'external_hashed' | 'unavailable';
  pathRef: string | null;
  errors: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function assertSafeOpaqueId(
  value: string,
  fieldName = 'id'
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: `${fieldName} is required` };
  if (trimmed.length > 96) return { ok: false, error: `${fieldName} exceeds 96 characters` };
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return { ok: false, error: `${fieldName} contains path separators or traversal` };
  }
  if (!OPAQUE_ID_PATTERN.test(trimmed)) {
    return { ok: false, error: `${fieldName} is not a path-safe opaque identifier` };
  }
  return { ok: true, value: trimmed };
}

export function createWorkflowWorkstreamId(prefix = 'ws'): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_]/gu, '').slice(0, 24) || 'ws';
  return `${safePrefix}_${randomBytes(8).toString('hex')}`;
}

export function getArchitectureGateDecision(
  architectureGate: WorkflowPlanContract['architectureGate']
): WorkflowGateDecision | null {
  if (typeof architectureGate === 'string') {
    return GATE_DECISIONS.has(architectureGate) ? architectureGate : null;
  }
  if (isObject(architectureGate)) {
    const decision = asString(architectureGate.decision) as WorkflowGateDecision | null;
    return decision && GATE_DECISIONS.has(decision) ? decision : null;
  }
  return null;
}

export function isCriticalPlanContract(contract: WorkflowPlanContract): boolean {
  if (contract.lane === 'critical') return true;
  if (contract.risk === 'high') return true;
  return false;
}

/** Prefer child-owned requiredTestIds when the active workstream is a declared child. */
export function resolveRequiredTestIdsForWorkstream(
  contract: WorkflowPlanContract,
  workstreamId: string
): string[] {
  const child = (contract.childWorkstreams ?? []).find(
    (entry) => entry.workstreamId === workstreamId
  );
  if (child) {
    return [...new Set(child.requiredTestIds.filter((id) => id.trim()))];
  }
  if (contract.workstreamId === workstreamId) {
    return contract.requiredTests.map((test) => test.id);
  }
  return contract.requiredTests.map((test) => test.id);
}

export function laneToLegacyRisk(lane: WorkflowLane): WorkflowRisk {
  return lane === 'critical' || lane === 'guarded' ? 'high' : 'routine';
}

const PLAN_COMMIT_SHA_RE = /^[0-9a-f]{7,64}$/i;
const PLAN_SHA256_RE = /^[0-9a-f]{64}$/i;

export function parseOptionalRehomeProvenance(
  value: unknown
): { provenance?: WorkflowRehomeProvenance; errors: string[] } {
  if (value === undefined || value === null) {
    return { errors: [] };
  }
  if (!isObject(value)) {
    return { errors: ['rehomeProvenance must be an object'] };
  }
  const errors: string[] = [];
  const schemaVersion = asString(value.schemaVersion);
  const predecessorRootWorkstreamId = asString(value.predecessorRootWorkstreamId);
  const predecessorDescendantWorkstreamId = asString(value.predecessorDescendantWorkstreamId);
  const predecessorHeadCommit = asString(value.predecessorHeadCommit);
  const predecessorReleaseContext = asString(value.predecessorReleaseContext);
  const successorBranchName = asString(value.successorBranchName);
  const successorBaselineCommit = asString(value.successorBaselineCommit);
  const sourcePatchSha256 = asString(value.sourcePatchSha256);
  const sourceProductTreeFingerprint = asString(value.sourceProductTreeFingerprint);
  if (schemaVersion !== '1') errors.push('rehomeProvenance.schemaVersion must be "1"');
  if (!predecessorRootWorkstreamId) errors.push('rehomeProvenance.predecessorRootWorkstreamId is required');
  if (!predecessorDescendantWorkstreamId) {
    errors.push('rehomeProvenance.predecessorDescendantWorkstreamId is required');
  }
  if (!predecessorHeadCommit || !PLAN_COMMIT_SHA_RE.test(predecessorHeadCommit)) {
    errors.push('rehomeProvenance.predecessorHeadCommit must be a git commit hash');
  }
  if (!predecessorReleaseContext || !predecessorReleaseContext.includes('#')) {
    errors.push('rehomeProvenance.predecessorReleaseContext must be path#branch');
  }
  if (!successorBranchName) errors.push('rehomeProvenance.successorBranchName is required');
  if (!successorBaselineCommit || !PLAN_COMMIT_SHA_RE.test(successorBaselineCommit)) {
    errors.push('rehomeProvenance.successorBaselineCommit must be a git commit hash');
  }
  if (!sourcePatchSha256 || !PLAN_SHA256_RE.test(sourcePatchSha256)) {
    errors.push('rehomeProvenance.sourcePatchSha256 must be a sha256 hex digest');
  }
  if (!sourceProductTreeFingerprint || !PLAN_SHA256_RE.test(sourceProductTreeFingerprint)) {
    errors.push('rehomeProvenance.sourceProductTreeFingerprint must be a sha256 hex digest');
  }
  if (value.predecessorPassedReview === true) {
    errors.push('rehomeProvenance must not claim the predecessor passed review');
  }
  if (value.predecessorHeadIsAncestor === true) {
    errors.push('rehomeProvenance must not claim the predecessor HEAD is an ancestor');
  }
  const sourceHeadCommit = asString(value.sourceHeadCommit);
  const sourceBaselineCommit = asString(value.sourceBaselineCommit);
  if (sourceHeadCommit && !PLAN_COMMIT_SHA_RE.test(sourceHeadCommit)) {
    errors.push('rehomeProvenance.sourceHeadCommit must be a git commit hash');
  }
  if (sourceBaselineCommit && !PLAN_COMMIT_SHA_RE.test(sourceBaselineCommit)) {
    errors.push('rehomeProvenance.sourceBaselineCommit must be a git commit hash');
  }
  if (errors.length > 0) return { errors };
  return {
    provenance: {
      schemaVersion: '1',
      status: 'declared',
      predecessorRootWorkstreamId: predecessorRootWorkstreamId!,
      predecessorDescendantWorkstreamId: predecessorDescendantWorkstreamId!,
      predecessorHeadCommit: predecessorHeadCommit!,
      predecessorReleaseContext: predecessorReleaseContext!,
      successorBranchName: successorBranchName!,
      successorBaselineCommit: successorBaselineCommit!,
      sourcePatchSha256: sourcePatchSha256!,
      sourceProductTreeFingerprint: sourceProductTreeFingerprint!,
      sourceReleaseContext: asString(value.sourceReleaseContext) ?? undefined,
      sourceHeadCommit: sourceHeadCommit ?? undefined,
      sourceBaselineCommit: sourceBaselineCommit ?? undefined,
      sourceReviewWorkstreamId: asString(value.sourceReviewWorkstreamId) ?? undefined,
      predecessorHeadIsAncestor: false,
      predecessorPassedReview: false,
    },
    errors: [],
  };
}

function parseRequiredTests(value: unknown): { tests: WorkflowRequiredTest[]; errors: string[] } {
  if (!Array.isArray(value)) return { tests: [], errors: ['requiredTests must be an array'] };
  const tests: WorkflowRequiredTest[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      errors.push(`requiredTests[${index}] must be an object`);
      continue;
    }
    const id = asString(entry.id);
    const status = asString(entry.status);
    if (!id || (status !== 'completed' && status !== 'unresolved')) {
      errors.push(`requiredTests[${index}] requires id and status completed|unresolved`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`requiredTests[${index}] duplicates id ${id}`);
      continue;
    }
    ids.add(id);
    tests.push({ id, status, note: asString(entry.note) ?? undefined });
  }
  return { tests, errors };
}

function parseUnresolvedRisks(value: unknown): {
  risks: Array<{ id: string; note: string } | string>;
  errors: string[];
} {
  if (value === undefined) return { risks: [], errors: [] };
  if (!Array.isArray(value)) return { risks: [], errors: ['unresolvedRisks must be an array'] };
  const risks: Array<{ id: string; note: string } | string> = [];
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry === 'string' && entry.trim()) {
      risks.push(entry.trim());
      continue;
    }
    if (!isObject(entry)) {
      errors.push(`unresolvedRisks[${index}] must be a string or object`);
      continue;
    }
    const id = asString(entry.id);
    const note = asString(entry.note);
    if (!id || !note) {
      errors.push(`unresolvedRisks[${index}] requires id and note`);
      continue;
    }
    risks.push({ id, note });
  }
  return { risks, errors };
}

function parseModelAssignment(
  value: unknown,
  fieldName: string,
  options?: { requireSwitchTiming?: boolean }
): { assignment: WorkflowPlanModels[keyof WorkflowPlanModels] | null; errors: string[] } {
  if (!isObject(value)) {
    return { assignment: null, errors: [`${fieldName} must be an object`] };
  }
  const errors: string[] = [];
  const role = asString(value.role);
  const modelId = asString(value.modelId);
  const tier = asString(value.tier) as WorkflowParentTier | null;
  const switchTiming = asString(value.switchTiming);
  if (!role || !getWorkflowModelRole(role)) {
    errors.push(`${fieldName}.role must be a known registry role`);
  }
  if (!modelId) errors.push(`${fieldName}.modelId is required`);
  if (!tier || !PARENT_TIERS.has(tier)) errors.push(`${fieldName}.tier is invalid`);
  if (role && modelId) {
    const knownRole = getWorkflowModelRole(role);
    if (
      knownRole &&
      !knownRole.modelIds.some((id) => id.toLowerCase() === modelId.toLowerCase())
    ) {
      errors.push(`${fieldName}.modelId ${modelId} is not registered for role ${role}`);
    }
  }
  if (tier && modelId) {
    const classified = classifyWorkflowModelTier(modelId);
    if (classified !== 'unknown' && classified !== tier) {
      errors.push(`${fieldName}.tier ${tier} conflicts with model ${modelId}`);
    }
  }
  if (options?.requireSwitchTiming) {
    if (!switchTiming || !SWITCH_TIMINGS.has(switchTiming)) {
      errors.push(`${fieldName}.switchTiming is invalid`);
    }
  } else if (switchTiming && !SWITCH_TIMINGS.has(switchTiming)) {
    errors.push(`${fieldName}.switchTiming is invalid`);
  }
  if (errors.length > 0 || !role || !modelId || !tier) {
    return { assignment: null, errors };
  }
  return {
    assignment: {
      role,
      modelId,
      tier,
      ...(switchTiming ? { switchTiming } : {}),
    },
    errors: [],
  };
}

function parseModels(value: unknown): { models: WorkflowPlanModels | null; errors: string[] } {
  if (!isObject(value)) return { models: null, errors: ['models must be an object'] };
  const planning = parseModelAssignment(value.planning, 'models.planning');
  const implementation = parseModelAssignment(value.implementation, 'models.implementation', {
    requireSwitchTiming: true,
  });
  const architecture = parseModelAssignment(value.architecture, 'models.architecture');
  const finalReview = parseModelAssignment(value.finalReview, 'models.finalReview');
  const fixRouting = parseModelAssignment(value.fixRouting, 'models.fixRouting');
  const errors = [
    ...planning.errors,
    ...implementation.errors,
    ...architecture.errors,
    ...finalReview.errors,
    ...fixRouting.errors,
  ];
  if (
    errors.length > 0 ||
    !planning.assignment ||
    !implementation.assignment ||
    !architecture.assignment ||
    !finalReview.assignment ||
    !fixRouting.assignment
  ) {
    return { models: null, errors };
  }
  return {
    models: {
      planning: planning.assignment,
      implementation: implementation.assignment,
      architecture: architecture.assignment,
      finalReview: finalReview.assignment,
      fixRouting: fixRouting.assignment,
    },
    errors: [],
  };
}

function parseArchitectureGateV2(
  value: unknown
): { gate: WorkflowPlanArchitectureGateEvidence | null; errors: string[] } {
  if (!isObject(value)) {
    return { gate: null, errors: ['architectureGate must be an object for schemaVersion 2'] };
  }
  const decision = asString(value.decision) as WorkflowGateDecision | null;
  const source = asString(value.source) as WorkflowReviewSource | null;
  const modelId = asString(value.modelId) ?? undefined;
  const reviewRef = asString(value.reviewRef) ?? undefined;
  const errors: string[] = [];
  if (!decision || !GATE_DECISIONS.has(decision)) {
    errors.push('architectureGate.decision is invalid');
  }
  if (!source || !REVIEW_SOURCES.has(source)) {
    errors.push('architectureGate.source is invalid');
  }
  if (errors.length > 0 || !decision || !source) {
    return { gate: null, errors };
  }
  return { gate: { decision, source, modelId, reviewRef }, errors: [] };
}

function parseLegacyV1Contract(value: Record<string, unknown>): ParsedPlanContract {
  const errors: string[] = [];
  const registryVersion = asString(value.registryVersion);
  const workstreamId = asString(value.workstreamId);
  const taskId = asString(value.taskId);
  const taskType = asString(value.taskType) as WorkflowTaskType | null;
  const risk = asString(value.risk) as WorkflowRisk | null;
  const architectureGate = asString(value.architectureGate) as WorkflowGateDecision | null;
  const architectureReviewSource = asString(
    value.architectureReviewSource
  ) as WorkflowReviewSource | null;
  const finalReviewRequired = asBoolean(value.finalReviewRequired);
  const finalReviewSource = asString(value.finalReviewSource) as WorkflowReviewSource | null;
  const commit = asString(value.commit) as WorkflowCommitStatus | null;
  const handoff = asString(value.handoff) as WorkflowHandoffStatus | null;
  const initialParentTier = asString(value.initialParentTier) as WorkflowParentTier | null;
  const routingDecision = asString(value.routingDecision) as WorkflowRoutingDecision | null;

  if (!registryVersion) errors.push('registryVersion is required');
  if (!workstreamId) errors.push('workstreamId is required');
  else {
    const idCheck = assertSafeOpaqueId(workstreamId, 'workstreamId');
    if (!idCheck.ok) errors.push(idCheck.error);
  }
  if (!taskId) errors.push('taskId is required');
  if (!taskType || !TASK_TYPES.has(taskType)) errors.push('taskType must be change|planning|review');
  if (!risk || !RISKS.has(risk)) errors.push('risk must be high|routine');
  if (!architectureGate || !GATE_DECISIONS.has(architectureGate)) {
    errors.push('architectureGate is invalid');
  }
  if (!architectureReviewSource || !REVIEW_SOURCES.has(architectureReviewSource)) {
    errors.push('architectureReviewSource is invalid');
  }
  if (finalReviewRequired === null) errors.push('finalReviewRequired must be boolean');
  if (!finalReviewSource || !REVIEW_SOURCES.has(finalReviewSource)) {
    errors.push('finalReviewSource is invalid');
  }
  if (!commit || !COMMIT_STATES.has(commit)) errors.push('commit is invalid');
  if (!handoff || !HANDOFF_STATES.has(handoff)) errors.push('handoff is invalid');
  if (!initialParentTier || !PARENT_TIERS.has(initialParentTier)) {
    errors.push('initialParentTier is invalid');
  }
  if (!routingDecision || !ROUTING_DECISIONS.has(routingDecision)) {
    errors.push('routingDecision is invalid');
  }

  const requiredTests = parseRequiredTests(value.requiredTests);
  const unresolvedRisks = parseUnresolvedRisks(value.unresolvedRisks);
  errors.push(...requiredTests.errors, ...unresolvedRisks.errors);

  if (risk === 'high' && requiredTests.tests.length === 0) {
    errors.push('high-risk plans require stable requiredTests IDs');
  }

  if (errors.length > 0) {
    return { status: 'malformed', contract: null, errors };
  }

  return {
    status: 'present',
    contract: {
      schemaVersion: '1',
      registryVersion: registryVersion!,
      workstreamId: workstreamId!,
      sourceWorkstreamIds: Array.isArray(value.sourceWorkstreamIds)
        ? value.sourceWorkstreamIds
            .map(asString)
            .filter((entry): entry is string => Boolean(entry))
        : undefined,
      taskId: taskId!,
      taskType: taskType!,
      risk: risk!,
      lane: risk === 'high' ? 'critical' : 'standard',
      initialParentTier: initialParentTier!,
      routingDecision: routingDecision!,
      recommendedBuildModel: isObject(value.recommendedBuildModel)
        ? (value.recommendedBuildModel as unknown as WorkflowPlanContract['recommendedBuildModel'])
        : undefined,
      architectureGate: architectureGate!,
      architectureReviewSource: architectureReviewSource!,
      independentReviewRequired: asBoolean(value.independentReviewRequired) ?? risk === 'high',
      independentReviewReasons: Array.isArray(value.independentReviewReasons)
        ? value.independentReviewReasons
            .map(asString)
            .filter((entry): entry is string => Boolean(entry))
        : [],
      requiredTests: requiredTests.tests,
      unresolvedRisks: unresolvedRisks.risks,
      finalReviewRequired: finalReviewRequired!,
      finalReviewSource: finalReviewSource!,
      commit: commit!,
      handoff: handoff!,
      implementationContract: isObject(value.implementationContract)
        ? (value.implementationContract as WorkflowPlanContract['implementationContract'])
        : undefined,
      reviewClosureProtocol:
        asString(value.reviewClosureProtocol) === 'two-pass-v1' ? 'two-pass-v1' : undefined,
    },
    errors: [],
  };
}

function parseNativeV2Contract(value: Record<string, unknown>): ParsedPlanContract {
  const errors: string[] = [];
  const registryVersion = asString(value.registryVersion);
  const workstreamId = asString(value.workstreamId);
  const taskId = asString(value.taskId);
  const taskType = asString(value.taskType) as WorkflowTaskType | null;
  const lane = asString(value.lane) as WorkflowLane | null;

  if (registryVersion !== WORKFLOW_MODEL_TIER_REGISTRY_VERSION) {
    errors.push(
      `registryVersion must be "${WORKFLOW_MODEL_TIER_REGISTRY_VERSION}" for native writers`
    );
  }
  if (!workstreamId) errors.push('workstreamId is required');
  else {
    const idCheck = assertSafeOpaqueId(workstreamId, 'workstreamId');
    if (!idCheck.ok) errors.push(idCheck.error);
  }
  if (!taskId) errors.push('taskId is required');
  if (!taskType || !TASK_TYPES.has(taskType)) errors.push('taskType must be change|planning|review');
  if (!lane || !LANES.has(lane)) errors.push('lane must be fast|standard|guarded|critical');

  const models = parseModels(value.models);
  errors.push(...models.errors);
  const architectureGate = parseArchitectureGateV2(value.architectureGate);
  errors.push(...architectureGate.errors);

  const requiredTests = parseRequiredTests(value.requiredTests);
  const unresolvedRisks = parseUnresolvedRisks(value.unresolvedRisks);
  errors.push(...requiredTests.errors, ...unresolvedRisks.errors);

  const implementationContract = isObject(value.implementationContract)
    ? value.implementationContract
    : null;
  const invariantsDefined = implementationContract
    ? asBoolean(implementationContract.invariantsDefined)
    : null;
  const boundariesDefined = implementationContract
    ? asBoolean(implementationContract.boundariesDefined)
    : null;
  const rollbackDefined = implementationContract
    ? asBoolean(implementationContract.rollbackDefined)
    : null;
  const invariants = implementationContract && Array.isArray(implementationContract.invariants)
    ? implementationContract.invariants
        .map(asString)
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const boundaries = implementationContract && Array.isArray(implementationContract.boundaries)
    ? implementationContract.boundaries
        .map(asString)
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const rollback = implementationContract
    ? asString(implementationContract.rollback) ?? undefined
    : undefined;

  const critical = lane === 'critical';
  if (critical && requiredTests.tests.length === 0) {
    errors.push('critical plans require stable requiredTests IDs');
  }
  if (
    critical &&
    !(
      (invariantsDefined === true && boundariesDefined === true && rollbackDefined === true) ||
      (invariants.length > 0 && boundaries.length > 0 && Boolean(rollback))
    )
  ) {
    errors.push(
      'critical plans require implementationContract invariants/boundaries/rollback (or *Defined flags)'
    );
  }
  if (critical && asString(value.reviewClosureProtocol) !== 'two-pass-v1') {
    errors.push('critical plans require reviewClosureProtocol two-pass-v1');
  }
  const rehome = parseOptionalRehomeProvenance(value.rehomeProvenance);
  errors.push(...rehome.errors);

  const finalReview = isObject(value.finalReview) ? value.finalReview : null;
  const finalReviewRequired = finalReview ? asBoolean(finalReview.required) : null;
  const finalReviewSource = finalReview
    ? (asString(finalReview.source) as WorkflowReviewSource | null)
    : null;
  if (critical) {
    if (finalReviewRequired !== true) {
      errors.push('critical plans require finalReview.required true');
    }
    if (!finalReviewSource || finalReviewSource !== 'independent_subagent') {
      errors.push('critical plans require finalReview.source independent_subagent');
    }
  }

  const commit = isObject(value.commit)
    ? asString(value.commit.status)
    : asString(value.commit);
  const handoff = isObject(value.handoff)
    ? asString(value.handoff.status)
    : asString(value.handoff);
  if (!commit || !COMMIT_STATES.has(commit as WorkflowCommitStatus)) {
    errors.push('commit.status is invalid');
  }
  if (
    !handoff ||
    (handoff !== 'completed' && handoff !== 'pending' && handoff !== 'unknown' && handoff !== 'not_started')
  ) {
    errors.push('handoff.status is invalid');
  }

  const storage = isObject(value.storage) ? value.storage : null;
  if (storage) {
    if (asBoolean(storage.externalRootsAllowed) === true) {
      errors.push('storage.externalRootsAllowed must be false for FFTS native plans');
    }
  }

  if (errors.length > 0 || !models.models || !architectureGate.gate) {
    return { status: 'malformed', contract: null, errors };
  }

  const normalizedHandoff =
    handoff === 'not_started' ? 'pending' : (handoff as WorkflowHandoffStatus);

  return {
    status: 'present',
    contract: {
      schemaVersion: '2',
      registryVersion: registryVersion!,
      workstreamId: workstreamId!,
      sourceWorkstreamIds: Array.isArray(value.sourceWorkstreamIds)
        ? value.sourceWorkstreamIds
            .map(asString)
            .filter((entry): entry is string => Boolean(entry))
        : undefined,
      childWorkstreams: Array.isArray(value.childWorkstreams)
        ? (value.childWorkstreams as WorkflowPlanContract['childWorkstreams'])
        : undefined,
      masterClosure: isObject(value.masterClosure)
        ? (value.masterClosure as unknown as WorkflowPlanContract['masterClosure'])
        : undefined,
      taskId: taskId!,
      taskType: taskType!,
      lane: lane!,
      risk: laneToLegacyRisk(lane!),
      models: models.models,
      executionMode: isObject(value.executionMode)
        ? (value.executionMode as unknown as WorkflowPlanContract['executionMode'])
        : undefined,
      architectureGate: architectureGate.gate,
      architectureReviewSource: architectureGate.gate.source,
      independentReviewRequired: critical,
      independentReviewReasons: critical ? ['critical-lane'] : [],
      requiredTests: requiredTests.tests,
      unresolvedRisks: unresolvedRisks.risks,
      finalReviewRequired: finalReviewRequired ?? critical,
      finalReviewSource: finalReviewSource ?? (critical ? 'independent_subagent' : 'local'),
      finalReview: finalReview
        ? {
            required: finalReviewRequired === true,
            source: finalReviewSource ?? 'unknown',
            modelId: asString(finalReview.modelId) ?? undefined,
            status: (asString(finalReview.status) as 'pending') ?? 'pending',
          }
        : undefined,
      commit: isObject(value.commit)
        ? (value.commit as unknown as WorkflowPlanContract['commit'])
        : (commit as WorkflowCommitStatus),
      handoff: isObject(value.handoff)
        ? (value.handoff as unknown as WorkflowPlanContract['handoff'])
        : normalizedHandoff,
      implementationContract: {
        invariants,
        boundaries,
        rollback,
        invariantsDefined: invariantsDefined ?? invariants.length > 0,
        boundariesDefined: boundariesDefined ?? boundaries.length > 0,
        rollbackDefined: rollbackDefined ?? Boolean(rollback),
      },
      reviewClosureProtocol:
        asString(value.reviewClosureProtocol) === 'two-pass-v1' ? 'two-pass-v1' : undefined,
      rehomeProvenance: rehome.provenance,
      storage: storage
        ? {
            planRoot: asString(storage.planRoot) ?? FFTS_CANONICAL_PLAN_ROOT.replace(/\\/g, '/'),
            visibility: asString(storage.visibility) ?? 'ignored-repository-local',
            externalRootsAllowed: false,
          }
        : {
            planRoot: 'docs_private/automation/plans',
            visibility: 'ignored-repository-local',
            externalRootsAllowed: false,
          },
      recommendedBuildModel: {
        implementation: {
          role: models.models.implementation.role,
          tier: models.models.implementation.tier,
        },
        premiumGates:
          critical
            ? [
                {
                  phase: 'architecture-gate',
                  role: 'premium-architecture-gate',
                  tier: 'premium',
                  mandatory: true,
                },
                {
                  phase: 'final-diff-reviewer',
                  role: 'premium-final-review',
                  tier: 'premium',
                  mandatory: true,
                },
              ]
            : [],
        switchTiming: (models.models.implementation.switchTiming as WorkflowSwitchTiming) ??
          'after_plan_approval',
        rationale: 'Native V2.2 lane-based plan contract',
        fallbackEscalation:
          'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.',
      },
      initialParentTier: models.models.planning.tier,
      routingDecision:
        models.models.implementation.tier === 'economical'
          ? 'economical_default'
          : 'continued_premium',
    },
    errors: [],
  };
}

export function validatePlanContractObject(value: unknown): ParsedPlanContract {
  if (!isObject(value)) {
    return { status: 'malformed', contract: null, errors: ['plan contract must be a JSON object'] };
  }
  const schemaVersion = asString(value.schemaVersion);
  if (schemaVersion === '2') return parseNativeV2Contract(value);
  if (schemaVersion === '1') return parseLegacyV1Contract(value);
  return {
    status: 'malformed',
    contract: null,
    errors: ['schemaVersion must be "1" (legacy reader) or "2" (native writer)'],
  };
}

export function extractPlanContractMarker(text: string): ParsedPlanContract {
  const v2Start = text.lastIndexOf(PLAN_CONTRACT_MARKER_PREFIX_V2);
  const v1Start = text.lastIndexOf(PLAN_CONTRACT_MARKER_PREFIX_V1);
  const start = Math.max(v2Start, v1Start);
  if (start < 0) {
    return {
      status: 'missing',
      contract: null,
      errors: ['plan-contract-marker:v2 (or legacy v1) not found'],
    };
  }
  const prefix =
    start === v2Start ? PLAN_CONTRACT_MARKER_PREFIX_V2 : PLAN_CONTRACT_MARKER_PREFIX_V1;
  const afterPrefix = text.slice(start + prefix.length);
  const end = afterPrefix.indexOf(PLAN_CONTRACT_MARKER_SUFFIX);
  if (end < 0) {
    return { status: 'malformed', contract: null, errors: ['plan-contract-marker is not closed'] };
  }
  const raw = afterPrefix.slice(0, end).trim();
  try {
    const parsed = validatePlanContractObject(JSON.parse(raw));
    return { ...parsed, raw };
  } catch (error) {
    return {
      status: 'malformed',
      contract: null,
      errors: [error instanceof Error ? error.message : 'plan contract JSON parse failed'],
      raw,
    };
  }
}

export function renderPlanContractMarker(contract: WorkflowPlanContract): string {
  const native: WorkflowPlanContract = {
    ...contract,
    schemaVersion: '2',
    registryVersion: WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
    lane: contract.lane ?? (contract.risk === 'high' ? 'critical' : 'standard'),
  };
  return `${PLAN_CONTRACT_MARKER_PREFIX_V2}\n${JSON.stringify(native, null, 2)}\n${PLAN_CONTRACT_MARKER_SUFFIX}`;
}

export function hasRequiredPlanHeadings(planMarkdown: string): string[] {
  const normalized = planMarkdown.replace(/\r\n/g, '\n');
  return REQUIRED_HEADINGS.filter((heading) => {
    const pattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im');
    return !pattern.test(normalized);
  });
}

export function humanMachineContradictionErrors(
  planMarkdown: string,
  contract: WorkflowPlanContract
): string[] {
  const errors: string[] = [];
  const humanMarkdown = planMarkdown.replace(
    /<!--\s*plan-contract-marker:v[12][\s\S]*?-->/giu,
    ''
  );
  const requiredTests = humanMarkdown.match(/^##\s+Required tests\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/imu)?.[1] ?? '';
  for (const test of contract.requiredTests) {
    if (!requiredTests.includes(test.id)) {
      errors.push(`human Required tests section is missing machine test ID ${test.id}`);
    }
  }
  if (isCriticalPlanContract(contract) && !/architecture gate|architecture-gate/i.test(humanMarkdown)) {
    errors.push('human Architecture gate section is missing expected architecture wording');
  }
  if (contract.lane) {
    const statedLane = humanMarkdown.match(/\blane\s*[:=-]?\s*(fast|standard|guarded|critical)\b/iu)?.[1];
    if (statedLane && statedLane.toLowerCase() !== contract.lane) {
      errors.push(`human lane ${statedLane} contradicts machine lane ${contract.lane}`);
    }
  }
  return errors;
}

function candidateHasTraversalSegment(candidatePath: string): boolean {
  const normalized = candidatePath.replace(/\\/g, '/');
  return normalized.split('/').some((segment) => segment === '..');
}

/** Reject leaf or intermediate symlink components before trusting realpath. */
export function pathHasSymlinkComponent(absolutePath: string): boolean {
  const normalized = path.normalize(absolutePath);
  const { root } = path.parse(normalized);
  const relative = path.relative(root, normalized);
  if (!relative) return false;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Existing prefixes only: a not-yet-created leaf is not treated as a symlink. */
export function pathHasExistingSymlinkComponent(absolutePath: string): boolean {
  const normalized = path.normalize(absolutePath);
  const { root } = path.parse(normalized);
  const relative = path.relative(root, normalized);
  if (!relative) return false;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function rejectsSiblingRepositoryPath(absolutePath: string, repoRoot: string): boolean {
  const normalized = absolutePath.replace(/\\/g, '/').toLowerCase();
  const repo = path.resolve(repoRoot).replace(/\\/g, '/').toLowerCase();
  if (normalized === repo || normalized.startsWith(repo + '/')) return false;
  // Sibling folder under the same parent is rejected.
  const parent = path.dirname(repo).replace(/\\/g, '/');
  if (normalized.startsWith(parent + '/') && !normalized.startsWith(repo + '/')) {
    return true;
  }
  return false;
}

export function resolvePlanPath(params: {
  candidatePath: string;
  repoRoot: string;
  approvedRoots?: string[];
  allowExternalRoots?: boolean;
}): PlanPathResolution {
  const repoRoot = path.resolve(params.repoRoot);
  const defaultRoots = [
    repoRoot,
    path.join(repoRoot, FFTS_CANONICAL_PLAN_ROOT),
    path.join(repoRoot, '.cursor', 'plans'),
  ];
  const approvedRoots = (params.approvedRoots ?? defaultRoots).map((root) => path.resolve(root));
  const candidateIsAbsolute = path.isAbsolute(params.candidatePath);

  if (!candidateIsAbsolute && candidateHasTraversalSegment(params.candidatePath)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['plan path traversal is not allowed'],
    };
  }

  let absolute: string;
  try {
    absolute = candidateIsAbsolute
      ? path.normalize(params.candidatePath)
      : path.resolve(repoRoot, params.candidatePath);
  } catch {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['unable to resolve candidate path'],
    };
  }

  if (!existsSync(absolute)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['plan path does not exist'],
    };
  }

  if (pathHasSymlinkComponent(absolute)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['symbolic links are not allowed for plan paths'],
    };
  }

  let realPath: string;
  try {
    realPath = realpathSync(absolute);
  } catch {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['unable to realpath plan candidate'],
    };
  }

  if (pathHasSymlinkComponent(realPath)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['symbolic links are not allowed for plan paths'],
    };
  }

  if (rejectsSiblingRepositoryPath(realPath, repoRoot)) {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['sibling repository plan paths are not allowed'],
    };
  }

  const underApproved = approvedRoots.some(
    (root) => realPath === root || realPath.startsWith(root + path.sep)
  );
  const underRepo = realPath === repoRoot || realPath.startsWith(repoRoot + path.sep);

  if (!underApproved || !underRepo) {
    // FFTS native contract rejects unauthorized external plan roots.
    if (params.allowExternalRoots !== true) {
      return {
        status: 'rejected',
        absolutePath: null,
        source: 'unavailable',
        pathRef: null,
        errors: ['external plan roots are not allowed'],
      };
    }
    if (!candidateIsAbsolute) {
      return {
        status: 'rejected',
        absolutePath: null,
        source: 'unavailable',
        pathRef: null,
        errors: ['plan path escapes approved roots'],
      };
    }
    return {
      status: 'ok',
      absolutePath: realPath,
      source: 'external_hashed',
      pathRef: hashIdentifier(realPath),
      errors: [],
    };
  }

  try {
    const size = statSync(realPath).size;
    if (size > PLAN_CONTRACT_MAX_BYTES) {
      return {
        status: 'rejected',
        absolutePath: null,
        source: 'unavailable',
        pathRef: null,
        errors: [`plan exceeds ${PLAN_CONTRACT_MAX_BYTES} bytes`],
      };
    }
  } catch {
    return {
      status: 'rejected',
      absolutePath: null,
      source: 'unavailable',
      pathRef: null,
      errors: ['unable to read plan size'],
    };
  }

  return {
    status: 'ok',
    absolutePath: realPath,
    source: 'repo_relative',
    pathRef: path.relative(repoRoot, realPath).split(path.sep).join('/'),
    errors: [],
  };
}

export function validatePlanMarkdown(
  planMarkdown: string,
  options?: { enforceHeadings?: boolean; expectRegistryVersion?: string }
): ParsedPlanContract & { headingErrors: string[]; contradictionErrors: string[] } {
  const extracted = extractPlanContractMarker(planMarkdown);
  const headingErrors =
    options?.enforceHeadings === false ? [] : hasRequiredPlanHeadings(planMarkdown);
  const contradictionErrors =
    extracted.contract && options?.enforceHeadings !== false
      ? humanMachineContradictionErrors(planMarkdown, extracted.contract)
      : [];
  const errors = [...extracted.errors];
  if (headingErrors.length > 0) {
    errors.push(`missing required headings: ${headingErrors.join(', ')}`);
  }
  errors.push(...contradictionErrors);
  if (
    extracted.contract &&
    options?.expectRegistryVersion &&
    extracted.contract.registryVersion !== options.expectRegistryVersion
  ) {
    errors.push(
      `registryVersion ${extracted.contract.registryVersion} differs from current ${options.expectRegistryVersion}`
    );
  }

  if (extracted.status === 'missing') {
    return { ...extracted, headingErrors, contradictionErrors, errors };
  }
  if (errors.length > 0) {
    return {
      status: 'malformed',
      contract: extracted.contract,
      errors,
      raw: extracted.raw,
      headingErrors,
      contradictionErrors,
    };
  }
  return { ...extracted, headingErrors, contradictionErrors, errors: [] };
}

export function validatePlanFile(params: {
  candidatePath: string;
  repoRoot: string;
  approvedRoots?: string[];
  enforceHeadings?: boolean;
}): ParsedPlanContract & {
  pathResolution: PlanPathResolution;
  headingErrors: string[];
  contradictionErrors: string[];
} {
  const pathResolution = resolvePlanPath({
    candidatePath: params.candidatePath,
    repoRoot: params.repoRoot,
    approvedRoots: params.approvedRoots,
  });
  if (pathResolution.status === 'rejected' || !pathResolution.absolutePath) {
    return {
      status: 'malformed',
      contract: null,
      errors: pathResolution.errors,
      pathResolution,
      headingErrors: [],
      contradictionErrors: [],
    };
  }
  const markdown = readFileSync(pathResolution.absolutePath, 'utf8');
  const validated = validatePlanMarkdown(markdown, {
    enforceHeadings: params.enforceHeadings,
    expectRegistryVersion: WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
  });
  return { ...validated, pathResolution };
}

export function createDefaultPlanContract(params: {
  workstreamId?: string;
  sourceWorkstreamIds?: string[];
  taskId: string;
  taskType: WorkflowTaskType;
  /** Preferred native discriminator. */
  lane?: WorkflowLane;
  /** Legacy compatibility input; mapped to lane when lane omitted. */
  risk?: WorkflowRisk;
  initialParentTier?: WorkflowParentTier;
  routingDecision?: WorkflowRoutingDecision;
  rationale: string;
  fallbackEscalation: string;
  requiredTests: WorkflowRequiredTest[];
  independentReviewReasons?: string[];
}): WorkflowPlanContract {
  const lane: WorkflowLane =
    params.lane ??
    (params.risk === 'high' ? 'critical' : params.risk === 'routine' ? 'standard' : 'standard');
  const critical = lane === 'critical';
  const workstreamId = params.workstreamId ?? createWorkflowWorkstreamId();
  return {
    schemaVersion: '2',
    registryVersion: WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
    workstreamId,
    sourceWorkstreamIds: params.sourceWorkstreamIds
      ? [...new Set(params.sourceWorkstreamIds.filter((id) => id.trim()))]
      : undefined,
    taskId: params.taskId,
    taskType: params.taskType,
    lane,
    risk: laneToLegacyRisk(lane),
    models: {
      planning: {
        role: 'premium-planning',
        modelId: 'gpt-5.6-sol-high',
        tier: 'premium',
      },
      implementation: {
        role: 'economical-default',
        modelId: 'cursor-grok-4.5-high-fast',
        tier: 'economical',
        switchTiming: critical
          ? 'after-plan-and-architecture-approval'
          : 'after_plan_approval',
      },
      architecture: {
        role: 'premium-architecture-gate',
        modelId: 'gpt-5.6-sol-high',
        tier: 'premium',
      },
      finalReview: {
        role: 'premium-final-review',
        modelId: 'gpt-5.6-sol-high',
        tier: 'premium',
      },
      fixRouting: {
        role: 'premium-fix-routing',
        modelId: 'gpt-5.6-sol-high',
        tier: 'premium',
      },
    },
    executionMode: {
      recommended: 'agent',
      detected: 'agent',
      advised: false,
      parallelWorkUnits: 1,
      reason: params.rationale,
    },
    architectureGate: {
      decision: critical ? 'approved_with_conditions' : 'skipped',
      source: critical ? 'independent_subagent' : 'not_applicable',
      modelId: 'gpt-5.6-sol-high',
    },
    architectureReviewSource: critical ? 'independent_subagent' : 'not_applicable',
    independentReviewRequired: critical,
    independentReviewReasons:
      params.independentReviewReasons ?? (critical ? ['critical-lane'] : []),
    requiredTests: params.requiredTests,
    unresolvedRisks: [],
    finalReviewRequired: critical,
    finalReviewSource: critical ? 'independent_subagent' : 'local',
    finalReview: {
      required: critical,
      source: critical ? 'independent_subagent' : 'local',
      modelId: 'gpt-5.6-sol-high',
      status: 'pending',
    },
    commit: {
      status: params.taskType === 'change' ? 'pending' : 'not_applicable',
      strategy: 'local-commit',
    },
    handoff: { status: 'pending' },
    reviewClosureProtocol: critical ? 'two-pass-v1' : undefined,
    implementationContract: critical
      ? {
          invariantsDefined: true,
          boundariesDefined: true,
          rollbackDefined: true,
          invariants: [
            'No executable, test, rule, configuration, or generated artifact depends on a sibling repository.',
            'Writers emit native V2.2 lane data and V4 completion markers; readers remain compatible with V1-V3 evidence.',
            'Missing, stale, malformed, or incomplete evidence is unknown, never passed.',
            'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.',
            'The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter initialized / preflight to mint a new first review.',
          ],
          boundaries: [
            'Do not modify product UI, domain behavior, application schema, RLS, or production records in TEE core.',
            'Do not add push-authorizing aliases.',
            'Do not activate trusted fixerrors status in this workstream.',
            'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.',
          ],
          rollback:
            'Disable/remove the stop hook and command integration first, then revert new writers while retaining mixed-version readers.',
        }
      : {
          invariantsDefined: true,
          boundariesDefined: true,
          rollbackDefined: true,
          invariants: ['Follow the approved automation suggestion scope.', params.rationale],
          boundaries: ['Do not expand into unrelated workflow architecture.'],
          rollback: 'Revert the automation upgrade commit if verification fails.',
        },
    storage: {
      planRoot: 'docs_private/automation/plans',
      visibility: 'ignored-repository-local',
      externalRootsAllowed: false,
    },
    recommendedBuildModel: {
      implementation: {
        role: 'economical-default',
        tier: 'economical',
        family: 'cursor-grok',
      },
      premiumGates: critical
        ? [
            {
              phase: 'architecture-gate',
              role: 'premium-architecture-gate',
              tier: 'premium',
              mandatory: true,
            },
            {
              phase: 'final-diff-reviewer',
              role: 'premium-final-review',
              tier: 'premium',
              mandatory: true,
            },
          ]
        : [],
      switchTiming: critical
        ? 'after-plan-and-architecture-approval'
        : 'after_plan_approval',
      rationale: params.rationale,
      fallbackEscalation: params.fallbackEscalation,
    },
    initialParentTier: params.initialParentTier ?? 'economical',
    routingDecision: params.routingDecision ?? 'economical_default',
  };
}

export function fingerprintPlanContract(contract: WorkflowPlanContract): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex').slice(0, 16);
}
