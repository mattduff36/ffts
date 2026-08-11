import type {
  WorkflowCommitStatus,
  WorkflowCompletionMarker,
  WorkflowEvidenceState,
  WorkflowExecutionMode,
  WorkflowExecutionModeDetected,
  WorkflowFinalReviewStatus,
  WorkflowGateDecision,
  WorkflowHandoffStatus,
  WorkflowLane,
  WorkflowParentTier,
  WorkflowPlanRecommendationAdherence,
  WorkflowRecommendedBuildModel,
  WorkflowRequiredTest,
  WorkflowReviewClosureState,
  WorkflowReviewPassRecord,
  WorkflowRisk,
  WorkflowReviewSource,
  WorkflowRoutingDecision,
  WorkflowTaskType,
  WorkflowUnresolvedRisk,
} from './types';
import {
  WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
  isWorkflowRoutingDecisionCoherent,
} from './workflow-model-tier';

export const WORKFLOW_MARKER_PREFIX_V1 = '<!-- workflow-completion-marker:v1';
export const WORKFLOW_MARKER_PREFIX_V2 = '<!-- workflow-completion-marker:v2';
export const WORKFLOW_MARKER_PREFIX_V3 = '<!-- workflow-completion-marker:v3';
export const WORKFLOW_MARKER_PREFIX_V4 = '<!-- workflow-completion-marker:v4';
export const WORKFLOW_MARKER_PREFIX = WORKFLOW_MARKER_PREFIX_V4;
export const WORKFLOW_MARKER_SUFFIX = '-->';

const TASK_TYPES = new Set<WorkflowTaskType>(['change', 'planning', 'review']);
const RISKS = new Set<WorkflowRisk>(['high', 'routine']);
const LANES = new Set<WorkflowLane>(['fast', 'standard', 'guarded', 'critical']);
const GATE_DECISIONS = new Set<WorkflowGateDecision>([
  'approved',
  'approved_with_conditions',
  'blocked',
  'skipped',
  'not_applicable',
  'unknown',
]);
const EVIDENCE_STATES = new Set<WorkflowEvidenceState>(['passed', 'failed', 'unknown']);
const FINAL_REVIEW_STATES = new Set<WorkflowFinalReviewStatus>([
  'passed',
  'failed',
  'skipped',
  'not_applicable',
  'unknown',
]);
const COMMIT_STATES = new Set<WorkflowCommitStatus>(['completed', 'not_applicable', 'pending', 'unknown']);
const HANDOFF_STATES = new Set<WorkflowHandoffStatus>(['completed', 'pending', 'unknown']);
const PARENT_TIERS = new Set<WorkflowParentTier>(['premium', 'economical', 'unknown']);
const ROUTING_DECISIONS = new Set<WorkflowRoutingDecision>([
  'switched_to_economical',
  'continued_premium',
  'economical_default',
  'explicit_premium',
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
const PLAN_ADHERENCE_STATES = new Set<WorkflowPlanRecommendationAdherence>([
  'matched',
  'deviated',
  'not_applicable',
  'unknown',
]);
const REVIEW_PASS_STAGES = new Set<WorkflowReviewPassRecord['stage']>([
  'architecture-gate',
  'final-diff-reviewer',
  'local-review',
  'other',
]);
const REVIEW_PASS_RESULTS = new Set<WorkflowReviewPassRecord['result']>([
  'passed',
  'failed',
  'blocked',
  'unknown',
]);
const EXECUTION_MODES = new Set<WorkflowExecutionMode>(['agent', 'multitask']);
const DETECTED_EXECUTION_MODES = new Set<WorkflowExecutionModeDetected>([
  'agent',
  'multitask',
  'unknown',
]);

export interface ParsedWorkflowMarker {
  status: 'present' | 'missing' | 'malformed';
  marker: WorkflowCompletionMarker | null;
  errors: string[];
  raw?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeWorkflowLaneToRisk(lane: WorkflowLane): WorkflowRisk {
  return lane === 'fast' || lane === 'standard' ? 'routine' : 'high';
}

function parseOptionalStringArray(
  value: unknown,
  fieldName: string
): { values: string[] | undefined; errors: string[] } {
  if (value === undefined) return { values: undefined, errors: [] };
  if (!Array.isArray(value)) {
    return { values: undefined, errors: [`${fieldName} must be an array when provided`] };
  }
  const values = value.map(asString).filter((entry): entry is string => Boolean(entry));
  if (values.length !== value.length) {
    return {
      values: undefined,
      errors: [`${fieldName} must contain only non-empty strings`],
    };
  }
  return { values: [...new Set(values)], errors: [] };
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
    tests.push({
      id,
      status,
      note: asString(entry.note) ?? undefined,
    });
  }
  return { tests, errors };
}

function parseUnresolvedRisks(value: unknown): { risks: WorkflowUnresolvedRisk[]; errors: string[] } {
  if (value === undefined) return { risks: [], errors: [] };
  if (!Array.isArray(value)) return { risks: [], errors: ['unresolvedRisks must be an array'] };
  const risks: WorkflowUnresolvedRisk[] = [];
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      errors.push(`unresolvedRisks[${index}] must be an object`);
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

function parseRecommendedBuildModel(value: unknown): {
  model: WorkflowRecommendedBuildModel | null;
  errors: string[];
} {
  if (!isObject(value)) {
    return { model: null, errors: ['recommendedBuildModel must be an object'] };
  }
  const implementation = isObject(value.implementation) ? value.implementation : null;
  const role = implementation ? asString(implementation.role) : null;
  const tier = implementation
    ? (asString(implementation.tier) as WorkflowParentTier | null)
    : null;
  const family = implementation ? asString(implementation.family) : null;
  const switchTiming = asString(value.switchTiming);
  const rationale = asString(value.rationale);
  const fallbackEscalation = asString(value.fallbackEscalation);
  const errors: string[] = [];

  if (!role) errors.push('recommendedBuildModel.implementation.role is required');
  if (!tier || !PARENT_TIERS.has(tier)) {
    errors.push('recommendedBuildModel.implementation.tier is invalid');
  }
  if (!Array.isArray(value.premiumGates)) {
    errors.push('recommendedBuildModel.premiumGates must be an array');
  }
  const premiumGates: WorkflowRecommendedBuildModel['premiumGates'] = [];
  if (Array.isArray(value.premiumGates)) {
    for (const [index, entry] of value.premiumGates.entries()) {
      if (!isObject(entry)) {
        errors.push(`recommendedBuildModel.premiumGates[${index}] must be an object`);
        continue;
      }
      const phase = asString(entry.phase);
      const gateRole = asString(entry.role);
      const gateTier = asString(entry.tier) as WorkflowParentTier | null;
      if (
        !phase ||
        !gateRole ||
        !gateTier ||
        !PARENT_TIERS.has(gateTier) ||
        typeof entry.mandatory !== 'boolean'
      ) {
        errors.push(
          `recommendedBuildModel.premiumGates[${index}] requires phase, role, tier, mandatory`
        );
        continue;
      }
      premiumGates.push({
        phase,
        role: gateRole,
        tier: gateTier,
        mandatory: entry.mandatory,
      });
    }
  }
  if (
    switchTiming !== 'before_substantive_implementation' &&
    switchTiming !== 'after_plan_approval' &&
    switchTiming !== 'after-plan-and-architecture-approval' &&
    switchTiming !== 'not_applicable'
  ) {
    errors.push('recommendedBuildModel.switchTiming is invalid');
  }
  if (!rationale) errors.push('recommendedBuildModel.rationale is required');
  if (!fallbackEscalation) errors.push('recommendedBuildModel.fallbackEscalation is required');

  if (errors.length > 0 || !role || !tier || !switchTiming || !rationale || !fallbackEscalation) {
    return { model: null, errors };
  }
  return {
    model: {
      implementation: { role, tier, family: family ?? undefined },
      premiumGates,
      switchTiming: switchTiming as WorkflowRecommendedBuildModel['switchTiming'],
      rationale,
      fallbackEscalation,
    },
    errors: [],
  };
}

function parseReviewPasses(value: unknown): {
  passes: WorkflowReviewPassRecord[];
  errors: string[];
} {
  if (!Array.isArray(value)) return { passes: [], errors: ['reviewPasses must be an array'] };
  const passes: WorkflowReviewPassRecord[] = [];
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      errors.push(`reviewPasses[${index}] must be an object`);
      continue;
    }
    const passId = asString(entry.passId);
    const stage = asString(entry.stage) as WorkflowReviewPassRecord['stage'] | null;
    const source = asString(entry.source) as WorkflowReviewSource | null;
    const tier = asString(entry.tier) as WorkflowParentTier | null;
    const result = asString(entry.result) as WorkflowReviewPassRecord['result'] | null;
    const iteration = entry.iteration;
    if (
      !passId ||
      !stage ||
      !REVIEW_PASS_STAGES.has(stage) ||
      !source ||
      !REVIEW_SOURCES.has(source) ||
      !tier ||
      !PARENT_TIERS.has(tier) ||
      !Number.isInteger(iteration) ||
      (iteration as number) < 1 ||
      !result ||
      !REVIEW_PASS_RESULTS.has(result)
    ) {
      errors.push(
        `reviewPasses[${index}] requires valid passId, stage, source, tier, iteration, result`
      );
      continue;
    }
    passes.push({ passId, stage, source, tier, iteration: iteration as number, result });
  }
  return { passes, errors };
}

function parseReviewClosure(value: unknown): {
  closure: WorkflowReviewClosureState | undefined;
  errors: string[];
} {
  if (value === undefined) return { closure: undefined, errors: [] };
  if (!isObject(value)) {
    return { closure: undefined, errors: ['reviewClosure must be an object when provided'] };
  }
  const protocol = asString(value.protocol);
  if (protocol !== 'two-pass-v1') {
    return { closure: undefined, errors: ['reviewClosure.protocol must be two-pass-v1'] };
  }
  const closure: WorkflowReviewClosureState = {
    protocol: 'two-pass-v1',
    protocolVersion: asString(value.protocolVersion) ?? undefined,
    phase: asString(value.phase) as WorkflowReviewClosureState['phase'] | undefined,
    evidenceManifestPath: asString(value.evidenceManifestPath) ?? undefined,
    fixDeltaManifestPath: asString(value.fixDeltaManifestPath) ?? undefined,
    firstPassId: asString(value.firstPassId) ?? undefined,
    deltaPassId: asString(value.deltaPassId) ?? undefined,
    blockerFamilies: Array.isArray(value.blockerFamilies)
      ? value.blockerFamilies.map(asString).filter((entry): entry is string => Boolean(entry))
      : undefined,
    failedPremiumReviewCount:
      typeof value.failedPremiumReviewCount === 'number'
        ? value.failedPremiumReviewCount
        : undefined,
    activeReviewTokenPresent:
      typeof value.activeReviewTokenPresent === 'boolean'
        ? value.activeReviewTokenPresent
        : undefined,
  };
  return { closure, errors: [] };
}

export function validateWorkflowCompletionMarker(value: unknown): ParsedWorkflowMarker {
  if (!isObject(value)) {
    return { status: 'malformed', marker: null, errors: ['marker must be a JSON object'] };
  }

  const errors: string[] = [];
  const schemaVersion = asString(value.schemaVersion);
  const lane = asString(value.lane) as WorkflowLane | null;
  const taskId = asString(value.taskId);
  const taskType = asString(value.taskType) as WorkflowTaskType | null;
  const rawRisk = asString(value.risk) as WorkflowRisk | null;
  const risk =
    schemaVersion === '4' && lane && LANES.has(lane)
      ? normalizeWorkflowLaneToRisk(lane)
      : rawRisk;
  const initialParentTier = asString(value.initialParentTier) as WorkflowParentTier | null;
  const executionParentTier = asString(value.executionParentTier) as WorkflowParentTier | null;
  const routingDecision = asString(value.routingDecision) as WorkflowRoutingDecision | null;
  const architectureGate = asString(value.architectureGate) as WorkflowGateDecision | null;
  const architectureReviewSource = asString(
    value.architectureReviewSource
  ) as WorkflowReviewSource | null;
  const verification = asString(value.verification) as WorkflowEvidenceState | null;
  const finalReview = asString(value.finalReview) as WorkflowFinalReviewStatus | null;
  const finalReviewSource = asString(value.finalReviewSource) as WorkflowReviewSource | null;
  const commit = asString(value.commit) as WorkflowCommitStatus | null;
  const handoff = asString(value.handoff) as WorkflowHandoffStatus | null;
  const exploreCanonical = value.exploreCanonical;
  const executionModeRecommended = asString(
    value.executionModeRecommended
  ) as WorkflowExecutionMode | null;
  const executionModeDetected = asString(
    value.executionModeDetected
  ) as WorkflowExecutionModeDetected | null;
  const parallelismReason = asString(value.parallelismReason);
  const rawEscalationReasons = value.reviewEscalationReasons;
  const reviewEscalationReasons = Array.isArray(rawEscalationReasons)
    ? rawEscalationReasons
        .map(asString)
        .filter((reason): reason is string => Boolean(reason))
    : [];
  const finalReviewRequired =
    lane === 'critical' ||
    (schemaVersion !== '4' && risk === 'high') ||
    reviewEscalationReasons.length > 0 ||
    value.finalReviewRequired === true;
  const rawIndependentReasons = value.independentReviewReasons;
  const independentReviewReasons = Array.isArray(rawIndependentReasons)
    ? rawIndependentReasons
        .map(asString)
        .filter((reason): reason is string => Boolean(reason))
    : [];
  const independentReviewRequired =
    value.independentReviewRequired === true || independentReviewReasons.length > 0;

  if (
    schemaVersion !== '1' &&
    schemaVersion !== '2' &&
    schemaVersion !== '3' &&
    schemaVersion !== '4'
  ) {
    errors.push('schemaVersion must be "1", "2", "3", or "4"');
  }
  if (!taskId) errors.push('taskId is required');
  if (!taskType || !TASK_TYPES.has(taskType)) errors.push('taskType must be change|planning|review');
  if (schemaVersion === '4') {
    if (!lane || !LANES.has(lane)) errors.push('lane must be fast|standard|guarded|critical');
    if (rawRisk && (!RISKS.has(rawRisk) || rawRisk !== risk)) {
      errors.push('risk must match the legacy normalization for lane when provided');
    }
    if (exploreCanonical !== undefined && typeof exploreCanonical !== 'boolean') {
      errors.push('exploreCanonical must be boolean when provided');
    }
  } else {
    if (!risk || !RISKS.has(risk)) errors.push('risk must be high|routine');
    if (typeof exploreCanonical !== 'boolean') errors.push('exploreCanonical must be boolean');
  }
  if (
    value.finalReviewRequired !== undefined &&
    typeof value.finalReviewRequired !== 'boolean'
  ) {
    errors.push('finalReviewRequired must be boolean when provided');
  }
  if (
    value.reviewEscalationReasons !== undefined &&
    !Array.isArray(rawEscalationReasons)
  ) {
    errors.push('reviewEscalationReasons must be an array when provided');
  }
  if (
    Array.isArray(rawEscalationReasons) &&
    reviewEscalationReasons.length !== rawEscalationReasons.length
  ) {
    errors.push('reviewEscalationReasons must contain only non-empty strings');
  }
  if (
    value.independentReviewReasons !== undefined &&
    !Array.isArray(rawIndependentReasons)
  ) {
    errors.push('independentReviewReasons must be an array when provided');
  }
  if (
    Array.isArray(rawIndependentReasons) &&
    independentReviewReasons.length !== rawIndependentReasons.length
  ) {
    errors.push('independentReviewReasons must contain only non-empty strings');
  }
  if (
    value.independentReviewRequired !== undefined &&
    typeof value.independentReviewRequired !== 'boolean'
  ) {
    errors.push('independentReviewRequired must be boolean when provided');
  }
  if (schemaVersion === '2' || schemaVersion === '3') {
    if (typeof value.finalReviewRequired !== 'boolean') {
      errors.push('finalReviewRequired is required for schemaVersion 2');
    }
    if (!Array.isArray(rawEscalationReasons)) {
      errors.push('reviewEscalationReasons is required for schemaVersion 2');
    }
    if (!initialParentTier || !PARENT_TIERS.has(initialParentTier)) {
      errors.push('initialParentTier is invalid');
    }
    if (!executionParentTier || !PARENT_TIERS.has(executionParentTier)) {
      errors.push('executionParentTier is invalid');
    }
    if (!routingDecision || !ROUTING_DECISIONS.has(routingDecision)) {
      errors.push('routingDecision is invalid');
    }
    if (!architectureReviewSource || !REVIEW_SOURCES.has(architectureReviewSource)) {
      errors.push('architectureReviewSource is invalid');
    }
    if (!finalReviewSource || !REVIEW_SOURCES.has(finalReviewSource)) {
      errors.push('finalReviewSource is invalid');
    }
    if (typeof value.independentReviewRequired !== 'boolean') {
      errors.push('independentReviewRequired is required for schemaVersion 2');
    }
    if (!Array.isArray(rawIndependentReasons)) {
      errors.push('independentReviewReasons is required for schemaVersion 2');
    }
    if (value.independentReviewRequired === true && independentReviewReasons.length === 0) {
      errors.push('independentReviewReasons is required when independentReviewRequired is true');
    }
    if (
      initialParentTier &&
      executionParentTier &&
      routingDecision &&
      !isWorkflowRoutingDecisionCoherent({
        initialParentTier,
        executionParentTier,
        routingDecision,
      })
    ) {
      errors.push('routingDecision conflicts with initialParentTier or executionParentTier');
    }
  }
  if (schemaVersion !== '4' || lane === 'critical') {
    if (!architectureGate || !GATE_DECISIONS.has(architectureGate)) {
      errors.push('architectureGate is invalid');
    }
    if (!finalReview || !FINAL_REVIEW_STATES.has(finalReview)) {
      errors.push('finalReview is invalid');
    }
  } else {
    if (architectureGate && !GATE_DECISIONS.has(architectureGate)) {
      errors.push('architectureGate is invalid when provided');
    }
    if (finalReview && !FINAL_REVIEW_STATES.has(finalReview)) {
      errors.push('finalReview is invalid when provided');
    }
  }
  if (!verification || !EVIDENCE_STATES.has(verification)) errors.push('verification is invalid');
  if (!commit || !COMMIT_STATES.has(commit)) errors.push('commit is invalid');
  if (!handoff || !HANDOFF_STATES.has(handoff)) errors.push('handoff is invalid');
  if (
    value.executionModeRecommended !== undefined &&
    (!executionModeRecommended || !EXECUTION_MODES.has(executionModeRecommended))
  ) {
    errors.push('executionModeRecommended must be agent|multitask when provided');
  }
  if (
    value.executionModeDetected !== undefined &&
    (!executionModeDetected || !DETECTED_EXECUTION_MODES.has(executionModeDetected))
  ) {
    errors.push('executionModeDetected must be agent|multitask|unknown when provided');
  }
  if (
    value.executionModeAdvised !== undefined &&
    typeof value.executionModeAdvised !== 'boolean'
  ) {
    errors.push('executionModeAdvised must be boolean when provided');
  }
  if (
    value.executionModeAccepted !== undefined &&
    value.executionModeAccepted !== null &&
    typeof value.executionModeAccepted !== 'boolean'
  ) {
    errors.push('executionModeAccepted must be boolean|null when provided');
  }
  if (
    value.parallelWorkUnits !== undefined &&
    (!Number.isInteger(value.parallelWorkUnits) || (value.parallelWorkUnits as number) < 0)
  ) {
    errors.push('parallelWorkUnits must be a non-negative integer when provided');
  }
  if (value.parallelismReason !== undefined && !parallelismReason) {
    errors.push('parallelismReason must be a non-empty string when provided');
  }

  const requiredTests =
    schemaVersion === '4' && value.requiredTests === undefined
      ? { tests: [], errors: [] }
      : parseRequiredTests(value.requiredTests);
  const unresolvedRisks = parseUnresolvedRisks(value.unresolvedRisks);
  errors.push(...requiredTests.errors, ...unresolvedRisks.errors);
  if ((schemaVersion === '2' || schemaVersion === '3') && risk === 'high' && requiredTests.tests.length === 0) {
    errors.push('high-risk schemaVersion 2/3 markers require stable requiredTests IDs');
  }
  if (
    (schemaVersion === '2' || schemaVersion === '3') &&
    architectureReviewSource === 'parent_structured' &&
    executionParentTier !== 'premium'
  ) {
    errors.push('parent_structured architecture review requires a premium execution parent');
  }
  if (
    (schemaVersion === '2' || schemaVersion === '3') &&
    finalReviewSource === 'parent_structured' &&
    executionParentTier !== 'premium'
  ) {
    errors.push('parent_structured final review requires a premium execution parent');
  }
  if (
    (schemaVersion === '2' || schemaVersion === '3') &&
    independentReviewRequired &&
    risk === 'high' &&
    architectureReviewSource !== 'independent_subagent'
  ) {
    errors.push('independent architecture review must use independent_subagent');
  }
  if (
    (schemaVersion === '2' || schemaVersion === '3') &&
    independentReviewRequired &&
    finalReviewRequired &&
    finalReviewSource !== 'independent_subagent'
  ) {
    errors.push('independent final review must use independent_subagent');
  }

  const workstreamId = asString(value.workstreamId);
  const sourceWorkstreamIds = parseOptionalStringArray(
    value.sourceWorkstreamIds,
    'sourceWorkstreamIds'
  );
  const registryVersion = asString(value.registryVersion);
  const planRecommendationAdherence = asString(
    value.planRecommendationAdherence
  ) as WorkflowPlanRecommendationAdherence | null;
  const recommendedBuildModel =
    value.recommendedBuildModel === undefined
      ? { model: null, errors: [] }
      : parseRecommendedBuildModel(value.recommendedBuildModel);
  const reviewPasses =
    value.reviewPasses === undefined
      ? { passes: [], errors: [] }
      : parseReviewPasses(value.reviewPasses);
  const reviewClosure = parseReviewClosure(value.reviewClosure);
  errors.push(...reviewClosure.errors);
  if (schemaVersion === '3') {
    if (!workstreamId) errors.push('workstreamId is required for schemaVersion 3');
    errors.push(...sourceWorkstreamIds.errors);
    if (!registryVersion) errors.push('registryVersion is required for schemaVersion 3');
    if (
      !planRecommendationAdherence ||
      !PLAN_ADHERENCE_STATES.has(planRecommendationAdherence)
    ) {
      errors.push('planRecommendationAdherence is invalid for schemaVersion 3');
    }
    if (
      value.recommendedBuildModel === undefined &&
      planRecommendationAdherence !== 'not_applicable'
    ) {
      errors.push(
        'recommendedBuildModel is required unless planRecommendationAdherence is not_applicable'
      );
    }
    if (!Array.isArray(value.reviewPasses)) {
      errors.push('reviewPasses is required for schemaVersion 3');
    }
    errors.push(...recommendedBuildModel.errors, ...reviewPasses.errors);
  }

  if (schemaVersion === '4' && lane === 'critical') {
    if (!workstreamId) errors.push('critical V4 markers require workstreamId');
    errors.push(...sourceWorkstreamIds.errors);
    if (!registryVersion) {
      errors.push('critical V4 markers require registryVersion');
    } else if (registryVersion !== WORKFLOW_MODEL_TIER_REGISTRY_VERSION) {
      errors.push(
        `critical V4 markers require registryVersion ${WORKFLOW_MODEL_TIER_REGISTRY_VERSION}`
      );
    }
    if (
      !planRecommendationAdherence ||
      !PLAN_ADHERENCE_STATES.has(planRecommendationAdherence)
    ) {
      errors.push('critical V4 markers require valid planRecommendationAdherence');
    }
    if (
      value.recommendedBuildModel === undefined &&
      planRecommendationAdherence !== 'not_applicable'
    ) {
      errors.push(
        'critical V4 markers require recommendedBuildModel unless planRecommendationAdherence is not_applicable'
      );
    }
    errors.push(...recommendedBuildModel.errors);
    if (!initialParentTier || !PARENT_TIERS.has(initialParentTier)) {
      errors.push('critical V4 markers require initialParentTier');
    }
    if (!executionParentTier || !PARENT_TIERS.has(executionParentTier)) {
      errors.push('critical V4 markers require executionParentTier');
    }
    if (!routingDecision || !ROUTING_DECISIONS.has(routingDecision)) {
      errors.push('critical V4 markers require routingDecision');
    }
    if (
      initialParentTier &&
      executionParentTier &&
      routingDecision &&
      !isWorkflowRoutingDecisionCoherent({
        initialParentTier,
        executionParentTier,
        routingDecision,
      })
    ) {
      errors.push(
        'critical V4 routingDecision conflicts with initialParentTier or executionParentTier'
      );
    }
    if (
      architectureGate !== 'approved' &&
      architectureGate !== 'approved_with_conditions'
    ) {
      errors.push('critical V4 markers require an approved architecture gate');
    }
    if (architectureReviewSource !== 'independent_subagent') {
      errors.push('critical V4 markers require independent architecture review');
    }
    if (value.independentReviewRequired !== true || independentReviewReasons.length === 0) {
      errors.push('critical V4 markers require independent review reasons');
    }
    if (requiredTests.tests.length === 0) {
      errors.push('critical V4 markers require stable requiredTests IDs');
    }
    if (value.finalReviewRequired !== true || finalReview !== 'passed') {
      errors.push('critical V4 markers require a passed final review');
    }
    if (finalReviewSource !== 'independent_subagent') {
      errors.push('critical V4 markers require independent final review');
    }
    if (!Array.isArray(value.reviewPasses) || reviewPasses.passes.length === 0) {
      errors.push('critical V4 markers require reviewPasses');
    }
    errors.push(...reviewPasses.errors);
    if (
      !reviewClosure.closure ||
      (reviewClosure.closure.phase !== 'review_closed' &&
        reviewClosure.closure.phase !== 'finalise_ready' &&
        reviewClosure.closure.phase !== 'finalised')
    ) {
      errors.push('critical V4 markers require closed two-pass review evidence');
    }
  }

  if (errors.length > 0) {
    return { status: 'malformed', marker: null, errors };
  }

  return {
    status: 'present',
    marker: {
      schemaVersion: schemaVersion as '1' | '2' | '3' | '4',
      lane: lane ?? undefined,
      taskId: taskId!,
      taskType: taskType!,
      risk: risk!,
      initialParentTier: initialParentTier ?? undefined,
      executionParentTier: executionParentTier ?? undefined,
      routingDecision: routingDecision ?? undefined,
      exploreCanonical: typeof exploreCanonical === 'boolean' ? exploreCanonical : true,
      architectureGate: architectureGate ?? 'not_applicable',
      architectureReviewSource: architectureReviewSource ?? undefined,
      requiredTests: requiredTests.tests,
      unresolvedRisks: unresolvedRisks.risks,
      verification: verification!,
      finalReviewRequired,
      reviewEscalationReasons,
      independentReviewRequired,
      independentReviewReasons,
      finalReview: finalReview ?? 'not_applicable',
      finalReviewSource: finalReviewSource ?? undefined,
      commit: commit!,
      handoff: handoff!,
      workstreamId: workstreamId ?? undefined,
      sourceWorkstreamIds: sourceWorkstreamIds.values,
      registryVersion: registryVersion ?? undefined,
      recommendedBuildModel: recommendedBuildModel.model ?? undefined,
      planRecommendationAdherence: planRecommendationAdherence ?? undefined,
      reviewPasses:
        schemaVersion === '3' || (schemaVersion === '4' && value.reviewPasses !== undefined)
          ? reviewPasses.passes
          : undefined,
      reviewClosure: reviewClosure.closure,
      executionModeRecommended: executionModeRecommended ?? undefined,
      executionModeDetected: executionModeDetected ?? undefined,
      executionModeAdvised:
        typeof value.executionModeAdvised === 'boolean'
          ? value.executionModeAdvised
          : undefined,
      executionModeAccepted:
        typeof value.executionModeAccepted === 'boolean' || value.executionModeAccepted === null
          ? value.executionModeAccepted
          : undefined,
      parallelWorkUnits:
        Number.isInteger(value.parallelWorkUnits) && (value.parallelWorkUnits as number) >= 0
          ? (value.parallelWorkUnits as number)
          : undefined,
      parallelismReason: parallelismReason ?? undefined,
    },
    errors: [],
  };
}

export function extractWorkflowCompletionMarker(text: string): ParsedWorkflowMarker {
  const candidates = [
    { version: 1, prefix: WORKFLOW_MARKER_PREFIX_V1, start: text.lastIndexOf(WORKFLOW_MARKER_PREFIX_V1) },
    { version: 2, prefix: WORKFLOW_MARKER_PREFIX_V2, start: text.lastIndexOf(WORKFLOW_MARKER_PREFIX_V2) },
    { version: 3, prefix: WORKFLOW_MARKER_PREFIX_V3, start: text.lastIndexOf(WORKFLOW_MARKER_PREFIX_V3) },
    { version: 4, prefix: WORKFLOW_MARKER_PREFIX_V4, start: text.lastIndexOf(WORKFLOW_MARKER_PREFIX_V4) },
  ].sort((left, right) => right.start - left.start || right.version - left.version);
  const selected = candidates[0]!;
  const start = selected.start;
  if (start < 0) {
    return { status: 'missing', marker: null, errors: ['workflow completion marker not found'] };
  }

  const prefix = selected.prefix;
  const afterPrefix = text.slice(start + prefix.length);
  const end = afterPrefix.indexOf(WORKFLOW_MARKER_SUFFIX);
  if (end < 0) {
    return { status: 'malformed', marker: null, errors: ['workflow completion marker is not closed'] };
  }

  const raw = afterPrefix.slice(0, end).trim();
  try {
    const parsed = validateWorkflowCompletionMarker(JSON.parse(raw));
    return { ...parsed, raw };
  } catch (error) {
    return {
      status: 'malformed',
      marker: null,
      errors: [error instanceof Error ? error.message : 'marker JSON parse failed'],
      raw,
    };
  }
}

export function renderWorkflowCompletionMarker(marker: WorkflowCompletionMarker): string {
  const prefix =
    marker.schemaVersion === '4'
      ? WORKFLOW_MARKER_PREFIX_V4
      : marker.schemaVersion === '3'
        ? WORKFLOW_MARKER_PREFIX_V3
      : marker.schemaVersion === '2'
        ? WORKFLOW_MARKER_PREFIX_V2
        : WORKFLOW_MARKER_PREFIX_V1;
  return `${prefix}\n${JSON.stringify(marker, null, 2)}\n${WORKFLOW_MARKER_SUFFIX}`;
}
