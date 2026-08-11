export type AutomationRunStatus = 'passed' | 'failed';

export interface AutomationExpectedArtifact {
  path: string;
  required?: boolean;
}

export interface AutomationCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface AutomationStepLog {
  name: string;
  status: AutomationRunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  command?: string;
  exitCode?: number | null;
  output?: string;
  outputTruncated?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationRunMetadata {
  branch: string;
  commit: string;
  dirtyFileCount: number;
  nodeVersion: string;
  npmVersion: string;
  platform: string;
}

export interface AutomationRunLog {
  id: string;
  scriptName: string;
  mode: string;
  args: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: AutomationRunStatus;
  metadata: AutomationRunMetadata;
  expectedArtifacts: AutomationExpectedArtifact[];
  artifacts: Array<{ path: string; exists: boolean; required: boolean }>;
  steps: AutomationStepLog[];
  review?: AutomationReviewSummary;
  error?: string;
  /** Optional TEE workstream correlation for finalise runs. */
  workflowCorrelation?: WorkflowFinaliseCorrelation;
}

export interface AutomationReviewSuggestion {
  severity: 'info' | 'warning' | 'action';
  message: string;
}

export interface AutomationReviewSummary {
  scriptName: string;
  generatedAt: string;
  runCount: number;
  recentRunCount: number;
  recentFailureCount: number;
  averageDurationMs: number;
  slowestStepName: string | null;
  suggestions: AutomationReviewSuggestion[];
  monthlyReviewPath?: string;
  monthlyPromptPath?: string;
  monthlySuggestionsPath?: string;
  monthlyReview?: AutomationReviewArtifacts;
  advisorReviewPath?: string;
  monthlyReviewGenerated: boolean;
}

export type AutomationSuggestionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'implemented'
  | 'superseded';

export type AutomationSuggestionOutcomeResult =
  | 'unknown'
  | 'improved'
  | 'no_change'
  | 'worse'
  | 'not_measured';

export interface AutomationSuggestionOutcome {
  result: AutomationSuggestionOutcomeResult;
  measuredAt?: string;
  beforeAvgMs?: number;
  afterAvgMs?: number;
  notes?: string;
}

export interface AutomationMemorySuggestion {
  id: string;
  scriptName: string;
  title: string;
  reason: string;
  evidence: string[];
  createdMonth: string;
  lastSeenMonth: string;
  status: AutomationSuggestionStatus;
  statusReason?: string;
  decisionAt?: string;
  decisionReason?: string;
  planPath?: string;
  implementedAt?: string;
  outcome?: AutomationSuggestionOutcome;
  source: 'deterministic' | 'advisor';
}

export interface AutomationReviewPrompt {
  month: string;
  path?: string;
  focusAreas: string[];
  deprioritizedAreas: string[];
  prompt: string;
}

export interface AutomationMonthlyMetrics {
  scriptName: string;
  month: string;
  generatedAt: string;
  runCount: number;
  failureCount: number;
  averageDurationMs: number;
  modeCounts: Record<string, number>;
  finalise?: {
    fullTestRuns: number;
    buildAverageMs: number;
    migrationRuns: number;
    dbValidateRuns: number;
    commitCommandCount: number;
    pushCommandCount: number;
  };
  fixerrors?: {
    totalFetched: number;
    totalFiltered: number;
    totalGrouped: number;
    fetchLimitHitCount: number;
    highFilteredRuns: number;
    untriagedCount: number;
    staleCount: number;
    repeatedPatternCount: number;
    repeatedSourceFileCount: number;
  };
  workflowReview?: WorkflowReviewMetrics;
}

export type WorkflowEvidenceState = 'passed' | 'failed' | 'unknown';
export type WorkflowTaskType = 'change' | 'planning' | 'review';
export type WorkflowRisk = 'high' | 'routine';
export type WorkflowLane = 'fast' | 'standard' | 'guarded' | 'critical';
export type WorkflowExecutionMode = 'agent' | 'multitask';
export type WorkflowExecutionModeDetected = WorkflowExecutionMode | 'unknown';
export type WorkflowParentTier = 'premium' | 'economical' | 'unknown';
export type WorkflowRoutingDecision =
  | 'switched_to_economical'
  | 'continued_premium'
  | 'economical_default'
  | 'explicit_premium'
  | 'not_applicable'
  | 'unknown';
export type WorkflowReviewSource =
  | 'independent_subagent'
  | 'parent_structured'
  | 'local'
  | 'not_applicable'
  | 'unknown';
export type WorkflowGateDecision =
  | 'approved'
  | 'approved_with_conditions'
  | 'blocked'
  | 'skipped'
  | 'not_applicable'
  | 'unknown';
export type WorkflowCommitStatus = 'completed' | 'not_applicable' | 'pending' | 'unknown';
export type WorkflowHandoffStatus = 'completed' | 'pending' | 'unknown';
export type WorkflowFinalReviewStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'not_applicable'
  | 'unknown';
export type WorkflowPlanRecommendationAdherence =
  | 'matched'
  | 'deviated'
  | 'not_applicable'
  | 'unknown';
export type WorkflowReviewPassStage =
  | 'architecture-gate'
  | 'final-diff-reviewer'
  | 'local-review'
  | 'other';
export type WorkflowSwitchTiming =
  | 'before_substantive_implementation'
  | 'after_plan_approval'
  | 'after-plan-and-architecture-approval'
  | 'not_applicable';

export interface WorkflowRequiredTest {
  id: string;
  status: 'completed' | 'unresolved';
  note?: string;
}

export interface WorkflowUnresolvedRisk {
  id: string;
  note: string;
}

export interface WorkflowRecommendedBuildModel {
  implementation: {
    role: string;
    tier: WorkflowParentTier;
    family?: string;
  };
  premiumGates: Array<{
    phase: string;
    role: string;
    tier: WorkflowParentTier;
    mandatory: boolean;
  }>;
  switchTiming: WorkflowSwitchTiming;
  rationale: string;
  fallbackEscalation: string;
}

export interface WorkflowPlanModelAssignment {
  role: string;
  modelId: string;
  tier: WorkflowParentTier;
  switchTiming?: WorkflowSwitchTiming | string;
}

export interface WorkflowPlanModels {
  planning: WorkflowPlanModelAssignment;
  implementation: WorkflowPlanModelAssignment;
  architecture: WorkflowPlanModelAssignment;
  finalReview: WorkflowPlanModelAssignment;
  fixRouting: WorkflowPlanModelAssignment;
}

export interface WorkflowPlanArchitectureGateEvidence {
  decision: WorkflowGateDecision;
  source: WorkflowReviewSource;
  modelId?: string;
  reviewRef?: string;
}

export interface WorkflowPlanFinalReviewEvidence {
  required: boolean;
  source: WorkflowReviewSource;
  modelId?: string;
  status: WorkflowFinalReviewStatus | 'pending' | 'not_started';
}

export interface WorkflowPlanCommitEvidence {
  status: WorkflowCommitStatus;
  strategy?: string;
  required?: boolean;
  requiredAfterApproval?: boolean;
}

export interface WorkflowPlanHandoffEvidence {
  status: WorkflowHandoffStatus | 'not_started';
  required?: boolean;
  requiredAfterApproval?: boolean;
}

export interface WorkflowChildWorkstreamContract {
  workstreamId: string;
  scope: string;
  status: string;
  dependsOn?: string[];
  requiresSeparateApproval?: boolean;
  blocksMasterClosure?: boolean;
  requiredTestIds: string[];
  finalReview: WorkflowPlanFinalReviewEvidence | {
    required?: boolean;
    requiredAfterApproval?: boolean;
    status: string;
  };
  commit: WorkflowPlanCommitEvidence;
  handoff: WorkflowPlanHandoffEvidence;
}

export interface WorkflowMasterClosureContract {
  scope: string;
  requiredChildWorkstreams: string[];
  deferredChildWorkstreams?: string[];
  requiredChildState: {
    tests: string;
    finalReview: string;
    commit: string;
    handoff: string;
  };
  deferredChildrenBlockClosure: boolean;
  deferredChildrenRemainOpen: boolean;
}

export interface WorkflowPlanExecutionMode {
  recommended: WorkflowExecutionMode;
  detected?: WorkflowExecutionModeDetected;
  advised?: boolean;
  parallelWorkUnits?: number;
  reason?: string;
}

export interface WorkflowPlanStorage {
  planRoot: string;
  visibility: string;
  externalRootsAllowed: boolean;
}

export interface WorkflowReviewPassRecord {
  passId: string;
  stage: WorkflowReviewPassStage;
  source: WorkflowReviewSource;
  tier: WorkflowParentTier;
  iteration: number;
  result: 'passed' | 'failed' | 'blocked' | 'unknown';
}

export type WorkflowProtocolPhase =
  | 'initialized'
  | 'preflight_ready'
  | 'first_review'
  | 'fix_sweep_required'
  | 'fix_recorded'
  | 'closure_review'
  | 'review_closed'
  | 'routing_required'
  | 'split'
  | 'finalise_ready'
  | 'finalised';

export type WorkflowIdentityStatus = 'present' | 'missing' | 'unknown';
export type WorkflowTranscriptStatus = 'parsed' | 'null' | 'missing' | 'malformed';
export type WorkflowReviewClosureProtocol = 'two-pass-v1';

export interface WorkflowReviewClosureState {
  protocol: WorkflowReviewClosureProtocol;
  protocolVersion?: string;
  phase?: WorkflowProtocolPhase;
  evidenceManifestPath?: string;
  fixDeltaManifestPath?: string;
  firstPassId?: string;
  deltaPassId?: string;
  blockerFamilies?: string[];
  failedPremiumReviewCount?: number;
  activeReviewTokenPresent?: boolean;
}

export interface WorkflowCompletionMarker {
  schemaVersion: '1' | '2' | '3' | '4';
  /** Native V2 lane. Absent on legacy V1-V3 markers. */
  lane?: WorkflowLane;
  taskId: string;
  taskType: WorkflowTaskType;
  risk: WorkflowRisk;
  workstreamId?: string;
  /** v3: opaque lineage for follow-up workstreams derived from earlier work. */
  sourceWorkstreamIds?: string[];
  initialParentTier?: WorkflowParentTier;
  executionParentTier?: WorkflowParentTier;
  routingDecision?: WorkflowRoutingDecision;
  exploreCanonical: boolean;
  architectureGate: WorkflowGateDecision;
  architectureReviewSource?: WorkflowReviewSource;
  requiredTests: WorkflowRequiredTest[];
  unresolvedRisks: WorkflowUnresolvedRisk[];
  verification: WorkflowEvidenceState;
  /** Optional for backward compatibility; high-risk markers imply true. */
  finalReviewRequired?: boolean;
  reviewEscalationReasons?: string[];
  independentReviewRequired?: boolean;
  independentReviewReasons?: string[];
  finalReview: WorkflowFinalReviewStatus;
  finalReviewSource?: WorkflowReviewSource;
  commit: WorkflowCommitStatus;
  handoff: WorkflowHandoffStatus;
  /** v3: plan recommendation echo and adherence. */
  registryVersion?: string;
  recommendedBuildModel?: WorkflowRecommendedBuildModel;
  planRecommendationAdherence?: WorkflowPlanRecommendationAdherence;
  reviewPasses?: WorkflowReviewPassRecord[];
  /** Additive two-pass closure evidence; ignored by legacy readers. */
  reviewClosure?: WorkflowReviewClosureState;
  /** Optional V2.1 execution-mode advisory telemetry. */
  executionModeRecommended?: WorkflowExecutionMode;
  executionModeDetected?: WorkflowExecutionModeDetected;
  executionModeAdvised?: boolean;
  executionModeAccepted?: boolean | null;
  parallelWorkUnits?: number;
  parallelismReason?: string;
}

/**
 * Native writers emit schemaVersion "2" (lane-based).
 * Readers also accept legacy schemaVersion "1" (risk-based) for compatibility.
 */
export interface WorkflowPlanContract {
  schemaVersion: '1' | '2';
  registryVersion: string;
  workstreamId: string;
  sourceWorkstreamIds?: string[];
  childWorkstreams?: WorkflowChildWorkstreamContract[];
  masterClosure?: WorkflowMasterClosureContract;
  taskId: string;
  taskType: WorkflowTaskType;
  /** Native V2.2 lane. Required for schemaVersion 2 writers. */
  lane?: WorkflowLane;
  /** Legacy V1 risk. Required for schemaVersion 1; derived for some V2 readers. */
  risk?: WorkflowRisk;
  initialParentTier?: WorkflowParentTier;
  routingDecision?: WorkflowRoutingDecision;
  recommendedBuildModel?: WorkflowRecommendedBuildModel;
  /** Native V2 exact model assignments. */
  models?: WorkflowPlanModels;
  executionMode?: WorkflowPlanExecutionMode;
  /**
   * V1: gate decision string.
   * V2: structured gate evidence object.
   */
  architectureGate: WorkflowGateDecision | WorkflowPlanArchitectureGateEvidence;
  architectureReviewSource?: WorkflowReviewSource;
  independentReviewRequired?: boolean;
  independentReviewReasons?: string[];
  requiredTests: WorkflowRequiredTest[];
  unresolvedRisks: Array<WorkflowUnresolvedRisk | string>;
  finalReviewRequired?: boolean;
  finalReviewSource?: WorkflowReviewSource;
  finalReview?: WorkflowPlanFinalReviewEvidence;
  commit: WorkflowCommitStatus | WorkflowPlanCommitEvidence;
  handoff: WorkflowHandoffStatus | WorkflowPlanHandoffEvidence;
  implementationContract?: {
    invariants?: string[];
    boundaries?: string[];
    rollback?: string;
    invariantsDefined?: boolean;
    boundariesDefined?: boolean;
    rollbackDefined?: boolean;
  };
  reviewClosureProtocol?: WorkflowReviewClosureProtocol;
  storage?: WorkflowPlanStorage;
}

export interface WorkflowFinding {
  id: string;
  severity: 'info' | 'warning' | 'action';
  status: WorkflowEvidenceState;
  title: string;
  detail: string;
  evidenceLabels: string[];
}

export interface WorkflowTranscriptSignals {
  adapterVersion: string;
  skillRead: boolean;
  architectureGateTask: boolean;
  finalDiffReviewerTask: boolean;
  exploreTask: boolean;
  truncatedShellEvidence: boolean;
  bulkInsertionScriptEvidence: boolean;
  duplicateBroadSearchAfterExplore: boolean;
  gitCommitEvidence: boolean;
  markerPresent: boolean;
  planContractPresent: boolean;
  planPathSource: 'repo_relative' | 'external_hashed' | 'unavailable';
  planPathRef: string | null;
  parseErrors: string[];
}

export interface WorkflowHookDiagnostics {
  transcriptPathPresent: boolean;
  transcriptPathNull: boolean;
  transcriptPathEmpty: boolean;
  transcriptStatus: WorkflowTranscriptStatus;
}

export interface WorkflowStopEvent {
  /** Writers emit '2'; readers accept '1' | '2'. */
  schemaVersion: '1' | '2';
  eventId: string;
  recordedAt: string;
  conversationHash: string;
  generationHash: string;
  selectedModel: string;
  selectedModelSource: 'model_id' | 'model' | 'unavailable';
  selectedModelTier: WorkflowParentTier;
  selectedModelRole?: string;
  status: 'completed' | 'aborted' | 'error' | 'unknown';
  loopCount: number;
  qualifies: boolean;
  qualificationReasons: string[];
  marker: WorkflowCompletionMarker | null;
  /** Native V2 lane copied from V4 markers. */
  lane?: WorkflowLane;
  markerStatus: 'present' | 'missing' | 'malformed';
  transcriptSignals: WorkflowTranscriptSignals | null;
  findings: WorkflowFinding[];
  monthKey: string;
  /** Legacy v1 field; not written by v2 event writers. */
  reviewedInWindowId?: string;
  workstreamId?: string;
  sourceWorkstreamIds?: string[];
  planValidationStatus?: 'present' | 'missing' | 'malformed' | 'not_applicable' | 'unknown';
  planRecommendationAdherence?: WorkflowPlanRecommendationAdherence;
  registryVersion?: string;
  branchName?: string;
  headCommit?: string;
  reviewPasses?: WorkflowReviewPassRecord[];
  /** Additive telemetry; absent on legacy events. */
  transcriptStatus?: WorkflowTranscriptStatus;
  identityStatus?: WorkflowIdentityStatus;
  protocolPhase?: WorkflowProtocolPhase;
  hookDiagnostics?: WorkflowHookDiagnostics;
  anomalyFlags?: string[];
  executionModeRecommended?: WorkflowExecutionMode;
  executionModeDetected?: WorkflowExecutionModeDetected;
  executionModeAdvised?: boolean;
  executionModeAccepted?: boolean | null;
  parallelWorkUnits?: number;
  parallelismReason?: string;
}

export interface WorkflowAnomalySignal {
  eventId: string;
  recordedAt: string;
  flags: string[];
}

export interface WorkflowWorkstreamRecord {
  workstreamId: string;
  branchName: string | null;
  headCommit: string | null;
  taskIds: string[];
  eventIds: string[];
  status: 'open' | 'finalised' | 'abandoned' | 'unknown';
  finaliseRunId?: string;
  finaliseOutcome?: 'passed' | 'failed' | 'unknown';
  finaliseCommit?: string;
  sourceWorkstreamIds?: string[];
  updatedAt: string;
}

export interface WorkflowProtocolReviewAttempt {
  pass: 'first' | 'closure';
  token: string;
  startedAt: string;
  result?: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  recordedAt?: string;
}

export interface WorkflowProtocolRecord {
  schemaVersion: '1';
  workstreamId: string;
  identityStatus: 'present';
  sourceWorkstreamIds?: string[];
  inheritedFailedReviewCount: number;
  branchName: string | null;
  baseCommit: string;
  headCommit: string | null;
  phase: WorkflowProtocolPhase;
  nextAction: string;
  failedPremiumReviewCount: number;
  activeReviewToken: string | null;
  activeReviewPass: 'first' | 'closure' | null;
  reviewAttempts: WorkflowProtocolReviewAttempt[];
  blockerFamilies: string[];
  openBlockerIds: string[];
  evidenceManifestPath: string | null;
  fixDeltaManifestPath: string | null;
  activeCheckpointId: string | null;
  planPath: string | null;
  updatedAt: string;
}

export interface WorkflowActiveFinaliseContext {
  workstreamId: string;
  checkpointId: string;
  activatedAt: string;
}

export interface WorkflowReviewState {
  /** Writers emit '2'; readers accept '1' | '2'. */
  schemaVersion: '1' | '2';
  scriptName: 'workflow-review';
  updatedAt: string;
  lastReviewAt: string | null;
  lastReviewWindowId: string | null;
  lastReviewedEventId: string | null;
  unreviewedEventIds: string[];
  pendingFollowUpPath: string | null;
  processedGenerationHashes: string[];
  /** State-side review membership; never rewrite immutable events. */
  reviewWindowByEventId?: Record<string, string>;
  workstreams?: Record<string, WorkflowWorkstreamRecord>;
  /** Additive two-pass protocol records keyed by workstreamId. */
  protocolRecords?: Record<string, WorkflowProtocolRecord>;
  activeFinaliseContext?: WorkflowActiveFinaliseContext | null;
  pendingAnomalySignals?: WorkflowAnomalySignal[];
}

export interface WorkflowReviewMetrics {
  qualifyingTaskCount: number;
  highRiskCount: number;
  routineCount: number;
  laneCounts?: Record<WorkflowLane | 'unknown', number>;
  missingGateCount: number;
  missingFinalReviewCount: number;
  truncatedEvidenceCount: number;
  incompleteHandoffCount: number;
  selectedModelCounts: Record<string, number>;
  estimatedPremiumTokenReductionLowPercent: number;
  estimatedPremiumTokenReductionHighPercent: number;
  estimateFormulaVersion: string;
  estimateConfidence: 'low';
  planContractPresentCount?: number;
  planContractMissingCount?: number;
  recommendationAdherenceCounts?: Record<WorkflowPlanRecommendationAdherence, number>;
  registryVersionCounts?: Record<string, number>;
  premiumReReviewFlagCount?: number;
  executionModeRecommendationCounts?: Record<WorkflowExecutionMode | 'unknown', number>;
  executionModeDetectedCounts?: Record<WorkflowExecutionModeDetected, number>;
  executionModeAdvisedCount?: number;
  executionModeAcceptanceCounts?: Record<'accepted' | 'declined' | 'unknown', number>;
}

export interface WorkflowFinaliseCorrelation {
  workstreamIds: string[];
  matchedBy: 'branch_ancestry' | 'none' | 'multiple' | 'explicit_context';
  branchName: string | null;
  headCommit: string | null;
  resultingCommit: string | null;
  identityStatus?: WorkflowIdentityStatus;
  checkpointId?: string | null;
}

export interface AutomationMemory {
  version: string;
  scriptName: string;
  updatedAt: string;
  suggestions: AutomationMemorySuggestion[];
  prompts: AutomationReviewPrompt[];
  monthlyMetrics: AutomationMonthlyMetrics[];
}

export interface AutomationReviewArtifacts {
  monthKey: string;
  reviewPath: string;
  promptPath: string;
  metricsPath: string;
  suggestionsPath: string;
  suggestions: AutomationMemorySuggestion[];
  knowledgeDirectory: string;
  advisorReviewPath?: string;
}
