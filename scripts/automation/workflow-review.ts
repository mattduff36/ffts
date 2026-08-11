import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { updateAutomationMemory, loadAutomationMemory, saveAutomationMemory } from './memory';
import { writeMonthlyAutomationPendingFollowUp } from './monthly-follow-up';
import {
  WORKFLOW_REVIEW_THRESHOLD,
  WORKFLOW_SCRIPT_NAME,
  attachEventToReviewWindow,
  getWorkflowPaths,
  listWorkflowEvents,
  loadWorkflowReviewState,
  saveWorkflowReviewState,
  upsertWorkstreamRecord,
  withWorkflowLock,
  writeWorkflowEvent,
  type WorkflowPaths,
} from './workflow-events';
import { buildWorkflowFindings, estimatePremiumTokenReduction, ESTIMATE_FORMULA_VERSION } from './workflow-findings';
import { extractWorkflowCompletionMarker } from './workflow-marker';
import {
  classifyWorkflowModelTier,
  resolveWorkflowModelRoleKey,
} from './workflow-model-tier';
import { assertNoForbiddenPayload, hashIdentifier } from './workflow-privacy';
import { parseWorkflowTranscript } from './workflow-transcript';
import { readProtocolRecord } from './workflow-review-protocol';
import type {
  AutomationMemorySuggestion,
  WorkflowIdentityStatus,
  WorkflowReviewMetrics,
  WorkflowReviewState,
  WorkflowStopEvent,
  WorkflowPlanRecommendationAdherence,
  WorkflowTranscriptStatus,
} from './types';

export interface WorkflowStopHookInput {
  conversation_id?: string;
  generation_id?: string;
  model?: string;
  model_id?: string;
  transcript_path?: string | null;
  status?: string;
  loop_count?: number;
  hook_event_name?: string;
}

export interface WorkflowStopHookResult {
  followup_message?: string;
  createdEvent: boolean;
  reviewTriggered: boolean;
  pendingPath?: string;
  reviewWindowId?: string;
  reason?: string;
}

function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

function selectModel(input: WorkflowStopHookInput): {
  selectedModel: string;
  selectedModelSource: WorkflowStopEvent['selectedModelSource'];
} {
  if (typeof input.model_id === 'string' && input.model_id.trim()) {
    return { selectedModel: input.model_id.trim(), selectedModelSource: 'model_id' };
  }
  if (typeof input.model === 'string' && input.model.trim()) {
    return { selectedModel: input.model.trim(), selectedModelSource: 'model' };
  }
  return { selectedModel: 'unavailable', selectedModelSource: 'unavailable' };
}

function isQualifyingStatus(status: string | undefined, loopCount: number): boolean {
  return status === 'completed' && loopCount === 0;
}

export function detectWorkflowAnomalies(
  event: Pick<
    WorkflowStopEvent,
    'lane' | 'marker' | 'markerStatus' | 'transcriptSignals' | 'findings' | 'protocolPhase'
  >
): string[] {
  const flags = new Set<string>();
  if (
    (event.lane === 'fast' || event.lane === 'standard') &&
    (event.transcriptSignals?.architectureGateTask ||
      event.transcriptSignals?.finalDiffReviewerTask ||
      event.marker?.reviewPasses?.some((pass) => pass.tier === 'premium'))
  ) {
    flags.add('unexpected-premium-review');
  }
  if ((event.marker?.reviewClosure?.failedPremiumReviewCount ?? 0) >= 2) {
    flags.add('two-premium-review-failures');
  }
  if (event.transcriptSignals?.duplicateBroadSearchAfterExplore) {
    flags.add('duplicate-broad-exploration');
  }
  if (event.markerStatus === 'malformed') {
    flags.add('malformed-completion-evidence');
  }
  const criticalEvidenceExpected =
    event.lane === 'critical' ||
    event.transcriptSignals?.architectureGateTask === true ||
    event.transcriptSignals?.finalDiffReviewerTask === true ||
    event.findings.some((finding) =>
      [
        'missing-architecture-gate',
        'invalid-architecture-review-source',
        'missing-final-review',
        'invalid-final-review-source',
        'unresolved-gate-tests',
      ].includes(finding.id)
    );
  if (
    criticalEvidenceExpected &&
    (event.markerStatus !== 'present' ||
      event.findings.some((finding) =>
        [
          'missing-architecture-gate',
          'invalid-architecture-review-source',
          'missing-final-review',
          'invalid-final-review-source',
          'unresolved-gate-tests',
        ].includes(finding.id)
      ))
  ) {
    flags.add('malformed-critical-evidence');
  }
  if (
    event.protocolPhase === 'routing_required' ||
    event.findings.some((finding) =>
      ['review-loop-unbounded', 'review-closure-bypass'].includes(finding.id)
    )
  ) {
    flags.add('protocol-invariant');
  }
  return [...flags];
}

function readGitValue(repoRoot: string, args: string[]): string | undefined {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 1024 * 1024,
  });
  const value = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return result.status === 0 && value ? value : undefined;
}

export function computePlanRecommendationAdherence(
  marker: WorkflowStopEvent['marker'],
  observedTier: WorkflowStopEvent['selectedModelTier']
): WorkflowPlanRecommendationAdherence {
  const recommendedTier = marker?.recommendedBuildModel?.implementation.tier;
  if (!recommendedTier) {
    return marker?.planRecommendationAdherence === 'not_applicable'
      ? 'not_applicable'
      : 'unknown';
  }
  if (recommendedTier === 'unknown' || observedTier === 'unknown') return 'unknown';
  return recommendedTier === observedTier ? 'matched' : 'deviated';
}

function buildSuggestionsFromFindings(
  events: WorkflowStopEvent[],
  monthKey: string,
  reviewWindowId: string
): AutomationMemorySuggestion[] {
  const failed = events.flatMap((event) =>
    event.findings.filter((finding) => finding.status === 'failed' && finding.severity !== 'info')
  );
  const byId = new Map<string, AutomationMemorySuggestion>();

  for (const finding of failed) {
    const existing = byId.get(finding.id);
    if (existing) {
      existing.evidence.push(...finding.evidenceLabels);
      continue;
    }
    byId.set(finding.id, {
      id: `${WORKFLOW_SCRIPT_NAME}-${reviewWindowId}-${finding.id}`,
      scriptName: WORKFLOW_SCRIPT_NAME,
      title: finding.title,
      reason: finding.detail,
      evidence: [...finding.evidenceLabels],
      createdMonth: monthKey,
      lastSeenMonth: monthKey,
      status: 'pending',
      source: 'advisor',
    });
  }

  return [...byId.values()];
}

export function buildWorkflowReviewMetrics(events: WorkflowStopEvent[]): WorkflowReviewMetrics {
  const estimate = estimatePremiumTokenReduction(events);
  const selectedModelCounts: Record<string, number> = {};
  const laneCounts: NonNullable<WorkflowReviewMetrics['laneCounts']> = {
    fast: 0,
    standard: 0,
    guarded: 0,
    critical: 0,
    unknown: 0,
  };
  const executionModeRecommendationCounts: NonNullable<
    WorkflowReviewMetrics['executionModeRecommendationCounts']
  > = { agent: 0, multitask: 0, unknown: 0 };
  const executionModeDetectedCounts: NonNullable<
    WorkflowReviewMetrics['executionModeDetectedCounts']
  > = { agent: 0, multitask: 0, unknown: 0 };
  const executionModeAcceptanceCounts: NonNullable<
    WorkflowReviewMetrics['executionModeAcceptanceCounts']
  > = { accepted: 0, declined: 0, unknown: 0 };
  let executionModeAdvisedCount = 0;
  for (const event of events) {
    selectedModelCounts[event.selectedModel] = (selectedModelCounts[event.selectedModel] ?? 0) + 1;
    laneCounts[event.lane ?? event.marker?.lane ?? 'unknown'] += 1;
    const recommended =
      event.executionModeRecommended ?? event.marker?.executionModeRecommended ?? 'unknown';
    const detected = event.executionModeDetected ?? event.marker?.executionModeDetected ?? 'unknown';
    executionModeRecommendationCounts[recommended] += 1;
    executionModeDetectedCounts[detected] += 1;
    const advised = event.executionModeAdvised ?? event.marker?.executionModeAdvised;
    if (advised === true) {
      executionModeAdvisedCount += 1;
      const accepted =
        event.executionModeAccepted !== undefined
          ? event.executionModeAccepted
          : event.marker?.executionModeAccepted;
      executionModeAcceptanceCounts[
        accepted === true ? 'accepted' : accepted === false ? 'declined' : 'unknown'
      ] += 1;
    }
  }
  const planningEvents = events.filter((event) => event.marker?.taskType === 'planning');
  const recommendationAdherenceCounts: Record<WorkflowPlanRecommendationAdherence, number> = {
    matched: 0,
    deviated: 0,
    not_applicable: 0,
    unknown: 0,
  };
  const registryVersionCounts: Record<string, number> = {};
  let premiumReReviewFlagCount = 0;
  for (const event of events) {
    const adherence = event.planRecommendationAdherence ?? 'unknown';
    recommendationAdherenceCounts[adherence] += 1;
    const registryVersion = event.registryVersion ?? 'unknown';
    registryVersionCounts[registryVersion] = (registryVersionCounts[registryVersion] ?? 0) + 1;
    const premiumReReviewCount = new Set(
      (event.reviewPasses ?? [])
        .filter((pass) => pass.tier === 'premium' && pass.iteration > 1)
        .map((pass) => pass.passId)
    ).size;
    if (premiumReReviewCount > 2) premiumReReviewFlagCount += 1;
  }

  return {
    qualifyingTaskCount: events.length,
    highRiskCount: events.filter((event) => event.marker?.risk === 'high').length,
    routineCount: events.filter((event) => event.marker?.risk === 'routine').length,
    laneCounts,
    missingGateCount: events.filter((event) =>
      event.findings.some((finding) => finding.id === 'missing-architecture-gate' && finding.status === 'failed')
    ).length,
    missingFinalReviewCount: events.filter((event) =>
      event.findings.some((finding) => finding.id === 'missing-final-review' && finding.status === 'failed')
    ).length,
    truncatedEvidenceCount: events.filter((event) =>
      event.findings.some((finding) => finding.id === 'truncated-verification-output' && finding.status === 'failed')
    ).length,
    incompleteHandoffCount: events.filter((event) =>
      event.findings.some((finding) => finding.id === 'incomplete-handoff' && finding.status !== 'passed')
    ).length,
    selectedModelCounts,
    planContractPresentCount: planningEvents.filter(
      (event) => event.transcriptSignals?.planContractPresent
    ).length,
    planContractMissingCount: planningEvents.filter(
      (event) => !event.transcriptSignals?.planContractPresent
    ).length,
    recommendationAdherenceCounts,
    registryVersionCounts,
    premiumReReviewFlagCount,
    executionModeRecommendationCounts,
    executionModeDetectedCounts,
    executionModeAdvisedCount,
    executionModeAcceptanceCounts,
    estimatedPremiumTokenReductionLowPercent: estimate.lowPercent,
    estimatedPremiumTokenReductionHighPercent: estimate.highPercent,
    estimateFormulaVersion: ESTIMATE_FORMULA_VERSION,
    estimateConfidence: 'low',
  };
}

function selectEventsForReview(params: {
  events: WorkflowStopEvent[];
  state: WorkflowReviewState;
}): { windowEvents: WorkflowStopEvent[]; reason: string } | null {
  const unreviewed = params.events.filter(
    (event) => event.qualifies && params.state.unreviewedEventIds.includes(event.eventId)
  );

  if (unreviewed.length === 0) return null;

  const anomalySignals = params.state.pendingAnomalySignals ?? [];
  if (anomalySignals.length > 0) {
    const flags = [
      ...new Set(anomalySignals.flatMap((signal) => signal.flags)),
    ].sort();
    return {
      windowEvents: unreviewed.slice(0, WORKFLOW_REVIEW_THRESHOLD),
      reason: `deterministic anomaly: ${flags.join(',')}`,
    };
  }

  if (unreviewed.length >= WORKFLOW_REVIEW_THRESHOLD) {
    return {
      windowEvents: unreviewed.slice(0, WORKFLOW_REVIEW_THRESHOLD),
      reason: `reached ${WORKFLOW_REVIEW_THRESHOLD} qualifying workflow tasks`,
    };
  }

  return null;
}

function writeReviewArtifacts(params: {
  paths: WorkflowPaths;
  windowEvents: WorkflowStopEvent[];
  reason: string;
  now: Date;
}): {
  reviewWindowId: string;
  reviewDirectory: string;
  reviewPath: string;
  suggestionsPath: string;
  metricsPath: string;
  suggestions: AutomationMemorySuggestion[];
  monthKey: string;
} {
  const monthKey = params.windowEvents[params.windowEvents.length - 1]?.monthKey ?? monthKeyFromIso(params.now.toISOString());
  const reviewWindowId = `${monthKey.replace(/-/gu, '')}-${params.now
    .toISOString()
    .replace(/[-:TZ.]/gu, '')}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const reviewDirectory = path.join(
    params.paths.reviewsDirectory,
    WORKFLOW_SCRIPT_NAME,
    monthKey,
    reviewWindowId
  );
  mkdirSync(reviewDirectory, { recursive: true });

  const metrics = buildWorkflowReviewMetrics(params.windowEvents);
  const suggestions = buildSuggestionsFromFindings(params.windowEvents, monthKey, reviewWindowId);
  const estimate = estimatePremiumTokenReduction(params.windowEvents);

  const reviewMarkdown = [
    '# workflow-review Automation Self-Review',
    '',
    `Generated: ${params.now.toISOString()}`,
    `Review window: ${reviewWindowId}`,
    `Trigger: ${params.reason}`,
    `Qualifying tasks reviewed: ${params.windowEvents.length}`,
    '',
    '## Selected parent models',
    '',
    ...Object.entries(metrics.selectedModelCounts).map(
      ([model, count]) => `- ${model}: ${count}`
    ),
    '',
    '## Estimated premium-token reduction',
    '',
    `- Range: ${estimate.lowPercent}% to ${estimate.highPercent}%`,
    `- Confidence: ${estimate.confidence}`,
    `- Formula: ${estimate.formulaVersion}`,
    ...estimate.assumptions.map((assumption) => `- Assumption: ${assumption}`),
    '',
    '## Findings',
    '',
    ...params.windowEvents.flatMap((event) => [
      `### Event ${event.eventId}`,
      '',
      `- Month: ${event.monthKey}`,
      `- Model: ${event.selectedModel} (${event.selectedModelSource}; tier ${event.selectedModelTier ?? 'unknown'})`,
      `- Marker: ${event.markerStatus}`,
      ...event.findings.map(
        (finding) => `- [${finding.severity}/${finding.status}] ${finding.title}: ${finding.detail}`
      ),
      '',
    ]),
    '## Suggestions',
    '',
    ...(suggestions.length > 0
      ? suggestions.map((suggestion) => `- ${suggestion.title}: ${suggestion.reason}`)
      : ['- No advisor suggestions generated.']),
    '',
  ].join('\n');

  const reviewPath = path.join(reviewDirectory, 'review.md');
  const suggestionsPath = path.join(reviewDirectory, 'suggestions.json');
  const metricsPath = path.join(reviewDirectory, 'metrics.json');
  const promptPath = path.join(reviewDirectory, 'review-prompt.md');
  const eventsPath = path.join(reviewDirectory, 'events.json');

  writeFileSync(reviewPath, reviewMarkdown, 'utf8');
  writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2), 'utf8');
  writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        scriptName: WORKFLOW_SCRIPT_NAME,
        month: monthKey,
        generatedAt: params.now.toISOString(),
        runCount: params.windowEvents.length,
        failureCount: params.windowEvents.filter((event) =>
          event.findings.some((finding) => finding.status === 'failed')
        ).length,
        averageDurationMs: 0,
        modeCounts: { workflow: params.windowEvents.length },
        workflowReview: metrics,
      },
      null,
      2
    ),
    'utf8'
  );
  writeFileSync(
    promptPath,
    [
      '# workflow-review prompt',
      '',
      'Review the deterministic findings and approve only suggestions that improve the token-efficient workflow without weakening quality gates.',
      '',
    ].join('\n'),
    'utf8'
  );
  writeFileSync(eventsPath, JSON.stringify(params.windowEvents, null, 2), 'utf8');

  return {
    reviewWindowId,
    reviewDirectory,
    reviewPath,
    suggestionsPath,
    metricsPath,
    suggestions,
    monthKey,
  };
}

export async function buildWorkflowStopEvent(
  input: WorkflowStopHookInput,
  options?: { now?: () => Date; repoRoot?: string }
): Promise<WorkflowStopEvent> {
  const now = options?.now?.() ?? new Date();
  const loopCount = typeof input.loop_count === 'number' ? input.loop_count : 0;
  const status =
    input.status === 'completed' || input.status === 'aborted' || input.status === 'error'
      ? input.status
      : 'unknown';
  const { selectedModel, selectedModelSource } = selectModel(input);
  const selectedModelTier = classifyWorkflowModelTier(selectedModel);
  const selectedModelRole = resolveWorkflowModelRoleKey(selectedModel);
  const conversationHash = hashIdentifier(input.conversation_id);
  const generationHash = hashIdentifier(input.generation_id || `${input.conversation_id}:${now.toISOString()}`);
  const qualifies = isQualifyingStatus(status, loopCount);
  const qualificationReasons: string[] = [];

  if (!qualifies) {
    if (status !== 'completed') qualificationReasons.push(`status=${status}`);
    if (loopCount !== 0) qualificationReasons.push(`loop_count=${loopCount}`);
  }

  const repoRoot = options?.repoRoot ?? process.cwd();
  const transcriptPathPresent = Object.prototype.hasOwnProperty.call(input, 'transcript_path');
  const transcriptPathNull = input.transcript_path === null;
  const transcriptPathEmpty =
    typeof input.transcript_path === 'string' && input.transcript_path.trim() === '';

  // Always attempt transcript parse so null/missing paths remain visible telemetry.
  const parsed = await parseWorkflowTranscript(
    transcriptPathPresent ? (input.transcript_path ?? null) : null,
    { repoRoot }
  );
  const transcriptSignals = parsed.signals;
  const assistantText = parsed.assistantText;
  const planValidationStatus: WorkflowStopEvent['planValidationStatus'] =
    parsed.planValidationStatus;
  const planSourceWorkstreamIds = parsed.planContract?.sourceWorkstreamIds;
  const planWorkstreamId = parsed.planContract?.workstreamId;
  const transcriptStatus: WorkflowTranscriptStatus = parsed.transcriptStatus;

  const markerParse = assistantText
    ? extractWorkflowCompletionMarker(assistantText)
    : { status: 'missing' as const, marker: null, errors: ['no assistant text'] };

  if (qualifies) {
    if (markerParse.status === 'present') qualificationReasons.push('marker:present');
    if (transcriptSignals?.skillRead) qualificationReasons.push('skill-read');
    if (transcriptSignals?.architectureGateTask) qualificationReasons.push('architecture-gate');
    if (transcriptSignals?.finalDiffReviewerTask) qualificationReasons.push('final-diff-reviewer');
    if (parsed.planContract) qualificationReasons.push('plan-contract');
  }

  const stronglyQualified =
    qualifies &&
    (markerParse.status === 'present' ||
      Boolean(transcriptSignals?.skillRead) ||
      Boolean(transcriptSignals?.architectureGateTask) ||
      Boolean(transcriptSignals?.finalDiffReviewerTask) ||
      Boolean(parsed.planContract));
  const planRecommendationAdherence = computePlanRecommendationAdherence(
    markerParse.marker,
    selectedModelTier
  );
  const branchName = readGitValue(repoRoot, ['branch', '--show-current']);
  const headCommit = readGitValue(repoRoot, ['rev-parse', 'HEAD']);
  const sourceWorkstreamIds = [
    ...new Set(
      [
        ...(markerParse.marker?.sourceWorkstreamIds ?? []),
        ...(planSourceWorkstreamIds ?? []),
      ].filter((id) => id.trim())
    ),
  ];

  // Explicit identity only: marker workstreamId, validated plan contract, or protocol record.
  // Never infer from branch/recency/transcript free text.
  let workstreamId = markerParse.marker?.workstreamId ?? planWorkstreamId;
  let protocolPhase: WorkflowStopEvent['protocolPhase'];
  let failedPremiumReviewCount: number | undefined;
  if (workstreamId) {
    const protocol = readProtocolRecord(repoRoot, workstreamId);
    if (protocol) {
      protocolPhase = protocol.phase;
      failedPremiumReviewCount = protocol.failedPremiumReviewCount;
      workstreamId = protocol.workstreamId;
    }
  }
  const identityStatus: WorkflowIdentityStatus = workstreamId ? 'present' : 'missing';

  const findings = buildWorkflowFindings({
    marker: markerParse.marker,
    markerStatus: markerParse.status,
    transcriptSignals,
    observedParentTier: selectedModelTier,
    planValidationStatus,
    planRecommendationAdherence,
    transcriptStatus,
    identityStatus,
    protocolPhase,
    failedPremiumReviewCount,
  });

  const event: WorkflowStopEvent = {
    schemaVersion: '2',
    eventId: generationHash,
    recordedAt: now.toISOString(),
    conversationHash,
    generationHash,
    selectedModel,
    selectedModelSource,
    selectedModelTier,
    selectedModelRole,
    status,
    loopCount,
    qualifies: stronglyQualified,
    qualificationReasons: stronglyQualified
      ? qualificationReasons
      : [...qualificationReasons, 'missing-strong-qualification-signal'],
    marker: markerParse.marker,
    lane: markerParse.marker?.lane,
    markerStatus: markerParse.status,
    transcriptSignals,
    findings,
    monthKey: monthKeyFromIso(now.toISOString()),
    workstreamId,
    sourceWorkstreamIds: sourceWorkstreamIds.length > 0 ? sourceWorkstreamIds : undefined,
    planValidationStatus,
    planRecommendationAdherence,
    registryVersion: markerParse.marker?.registryVersion,
    branchName,
    headCommit,
    reviewPasses: markerParse.marker?.reviewPasses,
    executionModeRecommended: markerParse.marker?.executionModeRecommended,
    executionModeDetected: markerParse.marker?.executionModeDetected,
    executionModeAdvised: markerParse.marker?.executionModeAdvised,
    executionModeAccepted: markerParse.marker?.executionModeAccepted,
    parallelWorkUnits: markerParse.marker?.parallelWorkUnits,
    parallelismReason: markerParse.marker?.parallelismReason,
    transcriptStatus,
    identityStatus,
    protocolPhase,
    hookDiagnostics: {
      transcriptPathPresent,
      transcriptPathNull,
      transcriptPathEmpty,
      transcriptStatus,
    },
  };
  event.anomalyFlags = detectWorkflowAnomalies(event);
  return event;
}

export async function processWorkflowStopEvent(
  input: WorkflowStopHookInput,
  options?: { repoRoot?: string; now?: () => Date }
): Promise<WorkflowStopHookResult> {
  const paths = getWorkflowPaths(options?.repoRoot);
  const now = options?.now?.() ?? new Date();

  const event = await buildWorkflowStopEvent(input, {
    now: () => now,
    repoRoot: paths.repoRoot,
  });
  const privacyViolations = assertNoForbiddenPayload(event);
  if (privacyViolations.length > 0) {
    throw new Error(`Workflow event privacy violation: ${privacyViolations.join('; ')}`);
  }

  return withWorkflowLock(paths.lockPath, () => {
    const state = loadWorkflowReviewState(paths.statePath);
    if (state.processedGenerationHashes.includes(event.generationHash)) {
      return {
        createdEvent: false,
        reviewTriggered: false,
        reason: 'duplicate-generation',
      };
    }

    // Always persist the stop attempt, including loop_count>0, as non-qualifying telemetry.
    const written = writeWorkflowEvent(paths.eventsDirectory, event);
    if (typeof input.loop_count === 'number' && input.loop_count > 0) {
      const nextState: WorkflowReviewState = {
        ...state,
        processedGenerationHashes: [...state.processedGenerationHashes, event.generationHash].slice(
          -500
        ),
      };
      saveWorkflowReviewState(paths.statePath, nextState);
      return {
        createdEvent: written.created,
        reviewTriggered: false,
        reason: 'loop_count>0',
      };
    }
    let nextState: WorkflowReviewState = {
      ...state,
      processedGenerationHashes: [...state.processedGenerationHashes, event.generationHash].slice(-500),
      unreviewedEventIds: written.created && event.qualifies
        ? [...state.unreviewedEventIds, event.eventId]
        : state.unreviewedEventIds,
      pendingAnomalySignals:
        written.created && (event.anomalyFlags?.length ?? 0) > 0
          ? [
              ...(state.pendingAnomalySignals ?? []),
              {
                eventId: event.eventId,
                recordedAt: event.recordedAt,
                flags: event.anomalyFlags ?? [],
              },
            ].slice(-100)
          : state.pendingAnomalySignals,
    };
    if (written.created && event.workstreamId) {
      nextState = upsertWorkstreamRecord(nextState, {
        workstreamId: event.workstreamId,
        branchName: event.branchName ?? null,
        headCommit: event.headCommit ?? null,
        taskIds: event.marker?.taskId ? [event.marker.taskId] : [],
        eventIds: [event.eventId],
        status: 'open',
        sourceWorkstreamIds: event.sourceWorkstreamIds,
        updatedAt: event.recordedAt,
      });
    }

    const routingRequired = event.findings.some((finding) => finding.id === 'review-loop-unbounded');
    const routingFollowup = routingRequired
      ? [
          'Premium review budget exhausted for this workstream (two failed rounds).',
          'Do not launch another final-diff-reviewer.',
          'Run one premium-fix-routing pass or split the workstream via:',
          `npx tsx scripts/workflow-protocol.ts split --workstream ${event.workstreamId ?? '<id>'} --new-workstream <new-id> --narrower-partition`,
        ].join('\n')
      : undefined;

    if (!event.qualifies) {
      saveWorkflowReviewState(paths.statePath, nextState);
      return {
        createdEvent: written.created,
        reviewTriggered: false,
        reason: event.qualificationReasons.join(','),
        followup_message: routingFollowup,
      };
    }

    if (nextState.pendingFollowUpPath) {
      if (existsSync(nextState.pendingFollowUpPath)) {
        saveWorkflowReviewState(paths.statePath, nextState);
        return {
          createdEvent: written.created,
          reviewTriggered: false,
          pendingPath: nextState.pendingFollowUpPath,
          reason: 'pending-follow-up-unresolved',
        };
      }
      nextState.pendingFollowUpPath = null;
    }

    if (
      (nextState.pendingAnomalySignals?.length ?? 0) === 0 &&
      nextState.unreviewedEventIds.length < WORKFLOW_REVIEW_THRESHOLD
    ) {
      saveWorkflowReviewState(paths.statePath, nextState);
      return {
        createdEvent: written.created,
        reviewTriggered: false,
        reason: `waiting (${nextState.unreviewedEventIds.length}/${WORKFLOW_REVIEW_THRESHOLD})`,
      };
    }

    const allEvents = listWorkflowEvents(paths.eventsDirectory);
    const selection = selectEventsForReview({
      events: allEvents,
      state: nextState,
    });

    if (!selection) {
      saveWorkflowReviewState(paths.statePath, nextState);
      return {
        createdEvent: written.created,
        reviewTriggered: false,
        reason: `waiting (${nextState.unreviewedEventIds.length}/${WORKFLOW_REVIEW_THRESHOLD})`,
      };
    }

    const artifacts = writeReviewArtifacts({
      paths,
      windowEvents: selection.windowEvents,
      reason: selection.reason,
      now,
    });

    const memory = loadAutomationMemory(paths.knowledgeDirectory, WORKFLOW_SCRIPT_NAME);
    const nextMemory = updateAutomationMemory({
      memory,
      metrics: {
        scriptName: WORKFLOW_SCRIPT_NAME,
        month: artifacts.monthKey,
        generatedAt: now.toISOString(),
        runCount: selection.windowEvents.length,
        failureCount: selection.windowEvents.filter((item) =>
          item.findings.some((finding) => finding.status === 'failed')
        ).length,
        averageDurationMs: 0,
        modeCounts: { workflow: selection.windowEvents.length },
        workflowReview: buildWorkflowReviewMetrics(selection.windowEvents),
      },
      prompt: {
        month: artifacts.monthKey,
        focusAreas: ['workflow-compliance', 'premium-gate-usage'],
        deprioritizedAreas: [],
        prompt: 'Improve token-efficient workflow compliance using deterministic findings.',
      },
      suggestions: artifacts.suggestions,
    });
    saveAutomationMemory(paths.knowledgeDirectory, nextMemory);

    let pendingPath: string | undefined;
    if (artifacts.suggestions.length > 0) {
      const pending = writeMonthlyAutomationPendingFollowUp({
        scriptName: WORKFLOW_SCRIPT_NAME,
        monthKey: artifacts.monthKey,
        reviewPath: artifacts.reviewPath,
        suggestionsPath: artifacts.suggestionsPath,
        suggestions: artifacts.suggestions,
        knowledgeDirectory: paths.knowledgeDirectory,
        repoRoot: paths.repoRoot,
        reviewWindowId: artifacts.reviewWindowId,
        sourceWorkstreamIds: [
          ...new Set(
            selection.windowEvents
              .map((windowEvent) => windowEvent.workstreamId)
              .filter((id): id is string => Boolean(id?.trim()))
          ),
        ],
        promptMode: 'skip',
      });
      pendingPath = pending.pendingPath;
    }

    // Event files remain immutable. Reviewed membership is tracked only in state.
    const reviewedIds = new Set(selection.windowEvents.map((item) => item.eventId));
    let reviewedState: WorkflowReviewState = {
      ...nextState,
      lastReviewAt: now.toISOString(),
      lastReviewWindowId: artifacts.reviewWindowId,
      lastReviewedEventId: selection.windowEvents[selection.windowEvents.length - 1]?.eventId ?? null,
      unreviewedEventIds: nextState.unreviewedEventIds.filter((id) => !reviewedIds.has(id)),
      pendingFollowUpPath: pendingPath ?? null,
      pendingAnomalySignals: [],
    };
    for (const eventId of reviewedIds) {
      reviewedState = attachEventToReviewWindow(
        reviewedState,
        eventId,
        artifacts.reviewWindowId
      );
    }
    saveWorkflowReviewState(paths.statePath, reviewedState);

    return {
      createdEvent: written.created,
      reviewTriggered: true,
      pendingPath,
      reviewWindowId: artifacts.reviewWindowId,
      reason: selection.reason,
      followup_message: pendingPath
        ? [
            'A token-efficient workflow review is ready.',
            `Pending follow-up artifact: ${pendingPath}`,
            'Read the pending JSON, ask me to approve/reject/skip each suggestion with AskQuestion, then run:',
            `npm run automation:followup:resolve -- --pending "${pendingPath}" --decision "<suggestion-id>=approve|reject|skip"`,
            'Include one --decision argument for each answer.',
          ].join('\n')
        : undefined,
    };
  });
}

export function formatWorkflowReviewDiagnostics(repoRoot = process.cwd()): string {
  const paths = getWorkflowPaths(repoRoot);
  const state = loadWorkflowReviewState(paths.statePath);
  const events = listWorkflowEvents(paths.eventsDirectory);
  return [
    `Events: ${events.length}`,
    `Unreviewed: ${state.unreviewedEventIds.length}`,
    `Last review: ${state.lastReviewAt ?? 'never'}`,
    `Pending follow-up: ${state.pendingFollowUpPath ?? 'none'}`,
    `Pending anomalies: ${state.pendingAnomalySignals?.length ?? 0}`,
  ].join('\n');
}
