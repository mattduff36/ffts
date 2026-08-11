import { sanitizeEvidenceLabel } from './workflow-privacy';
import { WORKFLOW_MODEL_TIER_REGISTRY_VERSION } from './workflow-model-tier';
import type {
  WorkflowCompletionMarker,
  WorkflowFinding,
  WorkflowParentTier,
  WorkflowPlanRecommendationAdherence,
  WorkflowTranscriptSignals,
} from './types';

function finding(
  id: string,
  severity: WorkflowFinding['severity'],
  status: WorkflowFinding['status'],
  title: string,
  detail: string,
  evidenceLabels: string[]
): WorkflowFinding {
  return {
    id,
    severity,
    status,
    title,
    detail,
    evidenceLabels: evidenceLabels.map(sanitizeEvidenceLabel),
  };
}

export function buildWorkflowFindings(params: {
  marker: WorkflowCompletionMarker | null;
  markerStatus: 'present' | 'missing' | 'malformed';
  transcriptSignals: WorkflowTranscriptSignals | null;
  observedParentTier?: WorkflowParentTier;
  planValidationStatus?: 'present' | 'missing' | 'malformed' | 'not_applicable' | 'unknown';
  planRecommendationAdherence?: WorkflowPlanRecommendationAdherence;
  transcriptStatus?: 'parsed' | 'null' | 'missing' | 'malformed';
  identityStatus?: 'present' | 'missing' | 'unknown';
  protocolPhase?: string;
  failedPremiumReviewCount?: number;
}): WorkflowFinding[] {
  const {
    marker,
    markerStatus,
    transcriptSignals,
    observedParentTier,
    planValidationStatus,
    planRecommendationAdherence,
    transcriptStatus,
    identityStatus,
    protocolPhase,
    failedPremiumReviewCount,
  } = params;
  const findings: WorkflowFinding[] = [];

  if (transcriptStatus === 'null' || transcriptStatus === 'missing') {
    findings.push(
      finding(
        'missing-transcript',
        'action',
        'unknown',
        'Stop-hook transcript unavailable',
        'A null or missing transcript_path was recorded. Evidence remains unknown and uncorrelated; identity is never inferred.',
        [`transcriptStatus:${transcriptStatus}`]
      )
    );
  } else if (transcriptStatus === 'malformed') {
    findings.push(
      finding(
        'malformed-transcript',
        'action',
        'unknown',
        'Stop-hook transcript malformed',
        'Transcript parsing failed. Evidence remains unknown and uncorrelated.',
        ['transcriptStatus:malformed']
      )
    );
  }

  if (identityStatus === 'missing') {
    findings.push(
      finding(
        'missing-workstream-id',
        'action',
        'unknown',
        'Missing explicit workstream identity',
        'Workstream identity must come from a validated plan/protocol context or marker. Missing identity stays uncorrelated.',
        ['identityStatus:missing']
      )
    );
  }

  if (
    protocolPhase === 'routing_required' ||
    (typeof failedPremiumReviewCount === 'number' && failedPremiumReviewCount >= 2)
  ) {
    findings.push(
      finding(
        'review-loop-unbounded',
        'action',
        'failed',
        'Premium review budget exhausted',
        'Second failed premium review requires premium-fix-routing or an explicit workstream split. Further review-start transitions are rejected.',
        [
          `protocolPhase:${protocolPhase ?? 'unknown'}`,
          `failedPremiumReviewCount:${failedPremiumReviewCount ?? 'unknown'}`,
        ]
      )
    );
  }

  if (markerStatus === 'missing') {
    findings.push(
      finding(
        'missing-completion-marker',
        'action',
        'unknown',
        'Missing workflow completion marker',
        'Substantive tasks must emit a supported versioned workflow completion marker. Missing markers are unknown, never passes.',
        ['marker:missing']
      )
    );
  } else if (markerStatus === 'malformed') {
    findings.push(
      finding(
        'malformed-completion-marker',
        'action',
        'unknown',
        'Malformed workflow completion marker',
        'Marker was present but failed schema validation. Malformed markers are unknown, never passes.',
        ['marker:malformed']
      )
    );
  }

  if (!marker) {
    if (transcriptSignals?.truncatedShellEvidence) {
      findings.push(
        finding(
          'truncated-verification-output',
          'action',
          'failed',
          'Verification output appears truncated',
          'Shell commands that pipe through head/tail/slice can hide failures.',
          ['transcript:truncated-shell']
        )
      );
    }
    return findings;
  }

  const criticalPolicy = marker.lane === 'critical' || (!marker.lane && marker.risk === 'high');

  if (marker.schemaVersion === '1') {
    findings.push(
      finding(
        'legacy-routing-evidence',
        'warning',
        'unknown',
        'Legacy marker lacks routing evidence',
        'Version 1 remains readable, but parent tier and review-source compliance are unknown.',
        ['marker:schemaVersion=1']
      )
    );
  }

  if (marker.taskType === 'planning') {
    if (planValidationStatus === 'malformed') {
      findings.push(
        finding(
          'malformed-plan-contract-marker',
          'action',
          'failed',
          'Malformed plan contract marker',
          'The plan contract marker was detected but failed validation.',
          ['plan-contract:malformed']
        )
      );
    } else if (
      planValidationStatus !== 'present' &&
      !transcriptSignals?.planContractPresent
    ) {
      findings.push(
        finding(
          'missing-plan-contract-marker',
          'action',
          'failed',
          'Planning task missing plan contract marker',
          'Substantive planning handoffs must include a valid plan-contract-marker:v1 block.',
          [`plan-contract:${planValidationStatus ?? 'unknown'}`]
        )
      );
    }
  }

  if (
    marker.schemaVersion === '3' &&
    marker.registryVersion !== WORKFLOW_MODEL_TIER_REGISTRY_VERSION
  ) {
    findings.push(
      finding(
        'stale-model-registry',
        'warning',
        'failed',
        'Completion marker uses a stale model registry',
        'Model recommendations should be produced from the current versioned role registry.',
        [
          `marker:registryVersion=${marker.registryVersion ?? 'unknown'}`,
          `registry:current=${WORKFLOW_MODEL_TIER_REGISTRY_VERSION}`,
        ]
      )
    );
  }

  const effectivePlanRecommendationAdherence =
    planRecommendationAdherence ?? marker.planRecommendationAdherence ?? 'unknown';
  if (effectivePlanRecommendationAdherence === 'deviated') {
    findings.push(
      finding(
        'plan-model-mismatch',
        'action',
        'failed',
        'Observed model tier differs from the plan recommendation',
        'The selected implementation model tier did not match the recommended build model tier.',
        [
          `plan:recommendedTier=${marker.recommendedBuildModel?.implementation.tier ?? 'unknown'}`,
          `event:selectedModelTier=${observedParentTier ?? 'unknown'}`,
        ]
      )
    );
  }

  const premiumReReviewCount = new Set(
    (marker.reviewPasses ?? [])
      .filter((pass) => pass.tier === 'premium' && pass.iteration > 1)
      .map((pass) => pass.passId)
  ).size;
  if (premiumReReviewCount > 2) {
    findings.push(
      finding(
        'excessive-premium-rereviews',
        'warning',
        'unknown',
        'Excessive premium re-review passes recorded',
        'More than two unique premium re-review passes were recorded in the marker. This marker finding remains advisory; executable enforcement is owned by workflow-protocol review-start transitions.',
        [`marker:premiumReReviewCount=${premiumReReviewCount}`]
      )
    );
  }

  if (
    marker.reviewClosure?.protocol === 'two-pass-v1' &&
    (marker.reviewClosure.failedPremiumReviewCount ?? 0) >= 2 &&
    marker.reviewClosure.phase !== 'routing_required'
  ) {
    findings.push(
      finding(
        'review-closure-bypass',
        'action',
        'failed',
        'Marker reports exhausted review budget without routing_required',
        'Completion markers that record two failed premium reviews must reflect routing_required and must not claim a third review launch.',
        [
          `reviewClosure:phase=${marker.reviewClosure.phase ?? 'unknown'}`,
          `reviewClosure:failedPremiumReviewCount=${marker.reviewClosure.failedPremiumReviewCount}`,
        ]
      )
    );
  }

  const effectiveParentTier =
    observedParentTier === undefined ? marker.executionParentTier ?? 'unknown' : observedParentTier;
  if (
    (marker.schemaVersion === '2' || marker.schemaVersion === '3') &&
    observedParentTier !== undefined &&
    observedParentTier !== 'unknown' &&
    marker.executionParentTier !== observedParentTier
  ) {
    findings.push(
      finding(
        'parent-tier-mismatch',
        'action',
        'failed',
        'Marker parent tier conflicts with hook telemetry',
        'Review-source eligibility must use the observed execution model tier, not an uncorroborated marker claim.',
        [
          `marker:executionParentTier=${marker.executionParentTier ?? 'unknown'}`,
          `event:selectedModelTier=${observedParentTier}`,
        ]
      )
    );
  } else if (
    (marker.schemaVersion === '2' || marker.schemaVersion === '3') &&
    observedParentTier === 'unknown'
  ) {
    findings.push(
      finding(
        'parent-tier-unavailable',
        'warning',
        'unknown',
        'Execution model tier could not be corroborated',
        'Unknown hook telemetry cannot establish eligibility for premium-parent structured review.',
        ['event:selectedModelTier=unknown']
      )
    );
  }

  if (criticalPolicy && marker.architectureGate === 'skipped') {
    findings.push(
      finding(
        'missing-architecture-gate',
        'action',
        'failed',
        'High-risk task skipped architecture gate',
        'High-risk work must complete an eligible architecture review before implementation.',
        ['marker:architectureGate=skipped', 'marker:risk=high']
      )
    );
  } else if (criticalPolicy && marker.architectureGate === 'blocked') {
    findings.push(
      finding(
        'architecture-gate-blocked',
        'action',
        'failed',
        'Architecture gate blocked implementation',
        'A blocked architecture-gate decision must not be treated as a successful handoff.',
        ['marker:architectureGate=blocked']
      )
    );
  } else if (criticalPolicy && marker.architectureGate === 'not_applicable') {
    findings.push(
      finding(
        'architecture-gate-not-applicable',
        'action',
        'failed',
        'High-risk task marked architecture gate not applicable',
        'High-risk work cannot mark architecture-gate as not_applicable.',
        ['marker:architectureGate=not_applicable', 'marker:risk=high']
      )
    );
  } else if (criticalPolicy && marker.architectureGate === 'unknown') {
    findings.push(
      finding(
        'architecture-gate-unknown',
        'warning',
        'unknown',
        'Architecture gate evidence unknown',
        'High-risk tasks need an explicit gate decision in the completion marker. Transcript Task calls alone cannot convert unknown into passed.',
        [
          'marker:architectureGate=unknown',
          `transcript:architectureGateTask=${Boolean(transcriptSignals?.architectureGateTask)}`,
        ]
      )
    );
  }

  if (
    (marker.schemaVersion === '2' ||
      marker.schemaVersion === '3' ||
      marker.schemaVersion === '4') &&
    criticalPolicy
  ) {
    const source = marker.architectureReviewSource ?? 'unknown';
    const parentCanSelfReview = effectiveParentTier === 'premium';
    const sourceIsValid = marker.independentReviewRequired
      ? source === 'independent_subagent'
      : source === 'independent_subagent' || (parentCanSelfReview && source === 'parent_structured');
    if (!sourceIsValid) {
      findings.push(
        finding(
          'invalid-architecture-review-source',
          'action',
          'failed',
          'Architecture review source does not satisfy routing policy',
          marker.independentReviewRequired
            ? 'This task requires an independent architecture-gate review.'
            : 'High-risk economical/unknown-parent work requires architecture-gate; eligible premium parents may use a structured parent contract.',
          [
            `marker:architectureReviewSource=${source}`,
            `effective:executionParentTier=${effectiveParentTier}`,
            `marker:independentReviewRequired=${Boolean(marker.independentReviewRequired)}`,
          ]
        )
      );
    }
  }

  const finalReviewRequired = marker.finalReviewRequired ?? criticalPolicy;
  const escalationEvidence = marker.reviewEscalationReasons ?? [];

  if (
    finalReviewRequired &&
    (marker.finalReview === 'skipped' || marker.finalReview === 'not_applicable')
  ) {
    findings.push(
      finding(
        'missing-final-review',
        'action',
        'failed',
        'Required premium final review missing',
        'High-risk or escalated routine work must complete an eligible final review after deterministic verification.',
        [
          `marker:finalReview=${marker.finalReview}`,
          `marker:finalReviewRequired=${finalReviewRequired}`,
          ...escalationEvidence.map((reason) => `marker:reviewEscalationReason=${reason}`),
        ]
      )
    );
  } else if (finalReviewRequired && marker.finalReview === 'failed') {
    findings.push(
      finding(
        'final-review-failed',
        'action',
        'failed',
        'Final review failed',
        'A failed final-diff-reviewer result blocks a clean handoff.',
        ['marker:finalReview=failed']
      )
    );
  } else if (finalReviewRequired && marker.finalReview === 'unknown') {
    findings.push(
      finding(
        'final-review-unknown',
        'warning',
        'unknown',
        'Final review evidence unknown',
        'High-risk or escalated routine tasks need an explicit finalReview value in the completion marker. Transcript Task calls alone cannot convert unknown into passed.',
        [
          'marker:finalReview=unknown',
          `transcript:finalDiffReviewerTask=${Boolean(transcriptSignals?.finalDiffReviewerTask)}`,
        ]
      )
    );
  }

  if (
    (marker.schemaVersion === '2' ||
      marker.schemaVersion === '3' ||
      marker.schemaVersion === '4') &&
    finalReviewRequired
  ) {
    const source = marker.finalReviewSource ?? 'unknown';
    const parentCanSelfReview = effectiveParentTier === 'premium';
    const sourceIsValid = marker.independentReviewRequired
      ? source === 'independent_subagent'
      : source === 'independent_subagent' || (parentCanSelfReview && source === 'parent_structured');
    if (!sourceIsValid) {
      findings.push(
        finding(
          'invalid-final-review-source',
          'action',
          'failed',
          'Final review source does not satisfy routing policy',
          marker.independentReviewRequired
            ? 'This task requires an independent final-diff-reviewer pass.'
            : 'Required review needs an independent reviewer, or an eligible structured premium-parent pass.',
          [
            `marker:finalReviewSource=${source}`,
            `effective:executionParentTier=${effectiveParentTier}`,
            `marker:independentReviewRequired=${Boolean(marker.independentReviewRequired)}`,
          ]
        )
      );
    }
  }

  const unresolvedRequired = marker.requiredTests.filter((test) => test.status === 'unresolved');
  const unresolvedWithoutRiskNote = unresolvedRequired.filter(
    (test) => !marker.unresolvedRisks.some((risk) => risk.id === test.id)
  );
  if (unresolvedWithoutRiskNote.length > 0) {
    findings.push(
      finding(
        'unresolved-gate-tests',
        'action',
        'failed',
        'Architecture-gate tests left unresolved without risk records',
        `Required test IDs lack unresolved-risk notes: ${unresolvedWithoutRiskNote.map((test) => test.id).join(', ')}`,
        unresolvedWithoutRiskNote.map((test) => `requiredTest:${test.id}=unresolved`)
      )
    );
  }

  if (marker.verification === 'failed') {
    findings.push(
      finding(
        'verification-failed',
        'action',
        'failed',
        'Verification failed',
        'Marker reports verification failed before handoff.',
        ['marker:verification=failed']
      )
    );
  } else if (marker.verification === 'unknown') {
    findings.push(
      finding(
        'verification-unknown',
        'warning',
        'unknown',
        'Verification evidence unknown',
        'Verification was not recorded as passed or failed.',
        ['marker:verification=unknown']
      )
    );
  }

  if (transcriptSignals?.truncatedShellEvidence) {
    findings.push(
      finding(
        'truncated-verification-output',
        'action',
        'failed',
        'Verification output appears truncated',
        'Compiler/test/migration/reviewer evidence must not be truncated in a way that can hide failures.',
        ['transcript:truncated-shell']
      )
    );
  }

  if (transcriptSignals?.duplicateBroadSearchAfterExplore) {
    findings.push(
      finding(
        'duplicate-broad-search',
        'warning',
        'failed',
        'Broad search repeated after explore agent',
        'Treat explore output as canonical unless evidence is incomplete, stale, or contradicted.',
        ['transcript:duplicate-broad-search-after-explore']
      )
    );
  }

  if (transcriptSignals?.bulkInsertionScriptEvidence) {
    findings.push(
      finding(
        'bulk-text-insertion',
        'warning',
        'failed',
        'Bulk text-insertion script detected',
        'Prefer cohesive patches; bulk transforms need deterministic codemods with immediate verification.',
        ['transcript:bulk-insertion-script']
      )
    );
  }

  if (marker.taskType === 'change') {
    if (marker.commit === 'pending' || marker.commit === 'unknown') {
      const commitStatus =
        marker.commit === 'unknown' && !transcriptSignals?.gitCommitEvidence ? 'unknown' : 'failed';
      findings.push(
        finding(
          'incomplete-commit',
          commitStatus === 'unknown' ? 'warning' : 'action',
          commitStatus,
          'Change task missing local commit',
          'Completed change tasks must finish the local commit/handoff step.',
          [`marker:commit=${marker.commit}`, `transcript:gitCommitEvidence=${Boolean(transcriptSignals?.gitCommitEvidence)}`]
        )
      );
    }
  }

  if (marker.handoff !== 'completed') {
    findings.push(
      finding(
        'incomplete-handoff',
        marker.handoff === 'unknown' ? 'warning' : 'action',
        marker.handoff === 'unknown' ? 'unknown' : 'failed',
        'Handoff incomplete',
        'Tasks must end with a clear handoff summary.',
        [`marker:handoff=${marker.handoff}`]
      )
    );
  }

  if (findings.length === 0) {
    findings.push(
      finding(
        'no-issues',
        'info',
        'passed',
        'No workflow compliance issues detected',
        'Marker and corroborating signals did not produce failed or unknown findings.',
        ['review:clean']
      )
    );
  }

  return findings;
}

export const ESTIMATE_FORMULA_VERSION = 'workflow-savings-v1';

export function estimatePremiumTokenReduction(events: Array<{ marker: WorkflowCompletionMarker | null }>): {
  lowPercent: number;
  highPercent: number;
  formulaVersion: string;
  confidence: 'low';
  assumptions: string[];
} {
  const highRisk = events.filter((event) => event.marker?.risk === 'high').length;
  const routine = events.filter((event) => event.marker?.risk === 'routine').length;
  const unknown = events.length - highRisk - routine;
  const total = Math.max(events.length, 1);

  const premiumShareLow = Math.min(0.45, (highRisk * 0.35 + routine * 0.15 + unknown * 0.25) / total);
  const premiumShareHigh = Math.min(0.55, (highRisk * 0.45 + routine * 0.25 + unknown * 0.35) / total);
  const lowPercent = Math.round((1 - premiumShareHigh) * 100);
  const highPercent = Math.round((1 - premiumShareLow) * 100);

  return {
    lowPercent: Math.max(0, Math.min(lowPercent, highPercent)),
    highPercent: Math.max(lowPercent, highPercent),
    formulaVersion: ESTIMATE_FORMULA_VERSION,
    confidence: 'low',
    assumptions: [
      'Exact IDE token usage is unavailable in local transcripts.',
      'Estimate compares gated premium usage against an all-premium baseline.',
      'Unknown-risk tasks are treated conservatively.',
    ],
  };
}
