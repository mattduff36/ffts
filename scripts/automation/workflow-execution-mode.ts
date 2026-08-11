import type {
  WorkflowExecutionMode,
  WorkflowExecutionModeDetected,
  WorkflowLane,
} from './types';

export type WorkflowDecisionEvidence = boolean | 'unknown';

export interface WorkflowExecutionModeAssessment {
  lane: WorkflowLane;
  meaningfulWorkUnits: number | null;
  unitsIndependent: WorkflowDecisionEvidence;
  canProgressConcurrently: WorkflowDecisionEvidence;
  ownershipBoundariesClear: WorkflowDecisionEvidence;
  sharedContractsFixed: WorkflowDecisionEvidence;
  collisionRisk: 'low' | 'high' | 'unknown';
  unitsSubstantial: WorkflowDecisionEvidence;
  integrationManageable: WorkflowDecisionEvidence;
  expectedElapsedTimeReductionPercent: number | null;
  architectureApproved?: WorkflowDecisionEvidence;
  invariantsApproved?: WorkflowDecisionEvidence;
  securityDataBoundariesApproved?: WorkflowDecisionEvidence;
  detectedMode: WorkflowExecutionModeDetected;
  advisoryPreviouslyEmitted?: boolean;
}

export interface WorkflowExecutionModeRecommendation {
  recommendedMode: WorkflowExecutionMode;
  shouldAdvise: boolean;
  parallelWorkUnits: number;
  reason: string;
}

const MINIMUM_MATERIAL_SPEEDUP_PERCENT = 30;

function isTrue(value: WorkflowDecisionEvidence): value is true {
  return value === true;
}

export function recommendWorkflowExecutionMode(
  assessment: WorkflowExecutionModeAssessment
): WorkflowExecutionModeRecommendation {
  const parallelWorkUnits = Math.max(0, assessment.meaningfulWorkUnits ?? 0);
  const criticalReady =
    assessment.lane !== 'critical' ||
    (assessment.architectureApproved === true &&
      assessment.invariantsApproved === true &&
      assessment.securityDataBoundariesApproved === true &&
      assessment.ownershipBoundariesClear === true &&
      assessment.sharedContractsFixed === true);
  const multitaskEligible =
    parallelWorkUnits >= 2 &&
    isTrue(assessment.unitsIndependent) &&
    isTrue(assessment.canProgressConcurrently) &&
    isTrue(assessment.ownershipBoundariesClear) &&
    isTrue(assessment.sharedContractsFixed) &&
    assessment.collisionRisk === 'low' &&
    isTrue(assessment.unitsSubstantial) &&
    isTrue(assessment.integrationManageable) &&
    assessment.expectedElapsedTimeReductionPercent !== null &&
    assessment.expectedElapsedTimeReductionPercent >= MINIMUM_MATERIAL_SPEEDUP_PERCENT &&
    criticalReady;

  const recommendedMode: WorkflowExecutionMode = multitaskEligible ? 'multitask' : 'agent';
  const strongAgentReason =
    parallelWorkUnits < 2 ||
    assessment.unitsIndependent === false ||
    assessment.canProgressConcurrently === false ||
    assessment.collisionRisk === 'high' ||
    assessment.sharedContractsFixed === false ||
    assessment.unitsSubstantial === false ||
    assessment.integrationManageable === false ||
    (assessment.expectedElapsedTimeReductionPercent !== null &&
      assessment.expectedElapsedTimeReductionPercent < MINIMUM_MATERIAL_SPEEDUP_PERCENT) ||
    (assessment.lane === 'critical' && !criticalReady);
  const mismatch =
    assessment.detectedMode !== 'unknown' && assessment.detectedMode !== recommendedMode;
  const unknownModeMultitaskAdvisory =
    assessment.detectedMode === 'unknown' && recommendedMode === 'multitask';
  const unknownModeCriticalSafetyAdvisory =
    assessment.detectedMode === 'unknown' &&
    assessment.lane === 'critical' &&
    !criticalReady;

  return {
    recommendedMode,
    shouldAdvise:
      assessment.advisoryPreviouslyEmitted !== true &&
      ((mismatch && (recommendedMode === 'multitask' || strongAgentReason)) ||
        unknownModeMultitaskAdvisory ||
        unknownModeCriticalSafetyAdvisory),
    parallelWorkUnits,
    reason: multitaskEligible
      ? 'independent-material-workstreams'
      : assessment.lane === 'critical' && assessment.architectureApproved !== true
        ? 'critical-architecture-not-approved'
        : parallelWorkUnits < 2
          ? 'insufficient-independent-work'
          : 'parallel-benefit-or-boundaries-insufficient',
  };
}

export function canLaunchNestedAgent(params: {
  actor: 'parent' | 'worker';
  purpose: 'implementation' | 'exploration' | 'mandatory_review';
  explicitlyAuthorizedByParent?: boolean;
}): boolean {
  if (params.actor === 'parent' || params.purpose === 'mandatory_review') return true;
  return params.explicitlyAuthorizedByParent === true;
}
