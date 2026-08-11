import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canLaunchNestedAgent,
  recommendWorkflowExecutionMode,
  type WorkflowExecutionModeAssessment,
} from '@/scripts/automation/workflow-execution-mode';
import {
  renderWorkflowCompletionMarker,
  validateWorkflowCompletionMarker,
} from '@/scripts/automation/workflow-marker';
import {
  buildWorkflowReviewMetrics,
  processWorkflowStopEvent,
} from '@/scripts/automation/workflow-review';
import {
  getWorkflowPaths,
  listWorkflowEvents,
} from '@/scripts/automation/workflow-events';
import type {
  WorkflowCompletionMarker,
  WorkflowStopEvent,
} from '@/scripts/automation/types';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});

function assessment(
  overrides: Partial<WorkflowExecutionModeAssessment> = {}
): WorkflowExecutionModeAssessment {
  return {
    lane: 'standard',
    meaningfulWorkUnits: 2,
    unitsIndependent: true,
    canProgressConcurrently: true,
    ownershipBoundariesClear: true,
    sharedContractsFixed: true,
    collisionRisk: 'low',
    unitsSubstantial: true,
    integrationManageable: true,
    expectedElapsedTimeReductionPercent: 30,
    detectedMode: 'agent',
    ...overrides,
  };
}

function compactMarker(
  overrides: Partial<WorkflowCompletionMarker> = {}
): WorkflowCompletionMarker {
  return {
    schemaVersion: '4',
    lane: 'fast',
    taskId: 'tee21',
    taskType: 'change',
    risk: 'routine',
    exploreCanonical: true,
    architectureGate: 'not_applicable',
    requiredTests: [],
    unresolvedRisks: [],
    verification: 'passed',
    finalReview: 'not_applicable',
    commit: 'completed',
    handoff: 'completed',
    ...overrides,
  };
}

function event(overrides: Partial<WorkflowStopEvent> = {}): WorkflowStopEvent {
  return {
    schemaVersion: '1',
    eventId: 'event',
    recordedAt: '2026-08-11T00:00:00.000Z',
    conversationHash: 'conversation',
    generationHash: 'generation',
    selectedModel: 'unknown',
    selectedModelSource: 'unavailable',
    selectedModelTier: 'unknown',
    status: 'completed',
    loopCount: 0,
    qualifies: true,
    qualificationReasons: ['marker'],
    marker: compactMarker(),
    markerStatus: 'present',
    transcriptSignals: null,
    findings: [],
    monthKey: '2026-08',
    ...overrides,
  };
}

describe('TEE V2.1 execution-mode policy', () => {
  it('TEE21-POLICY-001 defaults one FAST task to Agent but permits unrelated FAST work', () => {
    expect(
      recommendWorkflowExecutionMode(assessment({ lane: 'fast', meaningfulWorkUnits: 1 }))
        .recommendedMode
    ).toBe('agent');
    expect(recommendWorkflowExecutionMode(assessment({ lane: 'fast' })).recommendedMode).toBe(
      'multitask'
    );
  });

  it('keeps tightly coupled STANDARD work sequential and permits independent STANDARD/GUARDED work', () => {
    expect(
      recommendWorkflowExecutionMode(assessment({ unitsIndependent: false })).recommendedMode
    ).toBe('agent');
    expect(recommendWorkflowExecutionMode(assessment()).recommendedMode).toBe('multitask');
    expect(
      recommendWorkflowExecutionMode(assessment({ lane: 'guarded' })).recommendedMode
    ).toBe('multitask');
  });

  it('freezes CRITICAL parallelism until architecture approval', () => {
    expect(
      recommendWorkflowExecutionMode(
        assessment({ lane: 'critical', architectureApproved: false })
      ).recommendedMode
    ).toBe('agent');
    expect(
      recommendWorkflowExecutionMode(
        assessment({
          lane: 'critical',
          architectureApproved: true,
          invariantsApproved: true,
          securityDataBoundariesApproved: true,
        })
      ).recommendedMode
    ).toBe('multitask');
  });

  it('advises Agent when CRITICAL approval evidence is incomplete and Multitask may be active', () => {
    expect(
      recommendWorkflowExecutionMode(
        assessment({
          lane: 'critical',
          architectureApproved: true,
          invariantsApproved: 'unknown',
          securityDataBoundariesApproved: true,
          detectedMode: 'multitask',
        })
      )
    ).toMatchObject({ recommendedMode: 'agent', shouldAdvise: true });
    expect(
      recommendWorkflowExecutionMode(
        assessment({
          lane: 'critical',
          architectureApproved: true,
          invariantsApproved: true,
          securityDataBoundariesApproved: 'unknown',
          detectedMode: 'unknown',
        })
      )
    ).toMatchObject({ recommendedMode: 'agent', shouldAdvise: true });
  });

  it('requires two work units and material expected elapsed-time benefit', () => {
    expect(
      recommendWorkflowExecutionMode(assessment({ meaningfulWorkUnits: 1 })).recommendedMode
    ).toBe('agent');
    expect(
      recommendWorkflowExecutionMode(
        assessment({ expectedElapsedTimeReductionPercent: 29 })
      ).recommendedMode
    ).toBe('agent');
  });

  it('uses conditional advice for unknown mode and never repeats a declined advisory', () => {
    expect(
      recommendWorkflowExecutionMode(assessment({ detectedMode: 'unknown' })).shouldAdvise
    ).toBe(true);
    expect(
      recommendWorkflowExecutionMode(
        assessment({ detectedMode: 'unknown', advisoryPreviouslyEmitted: true })
      ).shouldAdvise
    ).toBe(false);
    expect(
      recommendWorkflowExecutionMode(
        assessment({ detectedMode: 'unknown', unitsIndependent: 'unknown' })
      ).shouldAdvise
    ).toBe(false);
  });

  it('prohibits nested implementation fan-out unless the parent authorizes it', () => {
    expect(canLaunchNestedAgent({ actor: 'worker', purpose: 'implementation' })).toBe(false);
    expect(
      canLaunchNestedAgent({
        actor: 'worker',
        purpose: 'implementation',
        explicitlyAuthorizedByParent: true,
      })
    ).toBe(true);
    expect(canLaunchNestedAgent({ actor: 'worker', purpose: 'mandatory_review' })).toBe(true);
  });

  it('TEE21-CONTEXT-001 remains a pure assessment with no repository inspection', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'scripts', 'automation', 'workflow-execution-mode.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/from ['"](?:fs|child_process)['"]/u);
    expect(source).not.toMatch(/process\.(?:cwd|env)/u);
  });
});

describe('TEE V2.1 telemetry compatibility', () => {
  it('TEE21-MARKER-COMPAT-001 / TEE22-COMPAT-009 keeps V2.1 and legacy telemetry compatible', () => {
    expect(validateWorkflowCompletionMarker(compactMarker()).status).toBe('present');
    const parsed = validateWorkflowCompletionMarker(
      compactMarker({
        executionModeRecommended: 'multitask',
        executionModeDetected: 'unknown',
        executionModeAdvised: true,
        executionModeAccepted: null,
        parallelWorkUnits: 3,
        parallelismReason: 'independent-material-workstreams',
      })
    );
    expect(parsed).toMatchObject({
      status: 'present',
      marker: {
        executionModeRecommended: 'multitask',
        executionModeDetected: 'unknown',
        executionModeAccepted: null,
        parallelWorkUnits: 3,
      },
    });
    expect(
      validateWorkflowCompletionMarker({
        ...compactMarker(),
        executionModeDetected: 'parallel',
      }).status
    ).toBe('malformed');
  });

  it('TEE21-TELEMETRY-001 copies marker telemetry into stop events', async () => {
    const root = path.join(
      tmpdir(),
      `tee21-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    const transcriptPath = path.join(root, 'transcript.jsonl');
    const marker = compactMarker({
      executionModeRecommended: 'multitask',
      executionModeDetected: 'unknown',
      executionModeAdvised: true,
      executionModeAccepted: null,
      parallelWorkUnits: 2,
      parallelismReason: 'independent-material-workstreams',
    });
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { path: 'token-efficient-engineering/SKILL.md' },
            },
            { type: 'text', text: renderWorkflowCompletionMarker(marker) },
          ],
        },
      })}\n`,
      'utf8'
    );

    await processWorkflowStopEvent(
      {
        conversation_id: 'tee21-conversation',
        generation_id: 'tee21-generation',
        transcript_path: transcriptPath,
        status: 'completed',
        loop_count: 0,
      },
      { repoRoot: root, now: () => new Date('2026-08-11T00:00:00.000Z') }
    );
    expect(listWorkflowEvents(getWorkflowPaths(root).eventsDirectory)[0]).toMatchObject({
      executionModeRecommended: 'multitask',
      executionModeDetected: 'unknown',
      executionModeAdvised: true,
      executionModeAccepted: null,
      parallelWorkUnits: 2,
    });
  });

  it('counts legacy absence as unknown and acceptance only for advised tasks', () => {
    const metrics = buildWorkflowReviewMetrics([
      event(),
      event({
        eventId: 'offered',
        executionModeRecommended: 'multitask',
        executionModeDetected: 'agent',
        executionModeAdvised: true,
        executionModeAccepted: true,
      }),
      event({
        eventId: 'not-offered',
        executionModeRecommended: 'agent',
        executionModeDetected: 'agent',
        executionModeAdvised: false,
        executionModeAccepted: false,
      }),
    ]);
    expect(metrics.executionModeRecommendationCounts).toEqual({
      agent: 1,
      multitask: 1,
      unknown: 1,
    });
    expect(metrics.executionModeAdvisedCount).toBe(1);
    expect(metrics.executionModeAcceptanceCounts).toEqual({
      accepted: 1,
      declined: 0,
      unknown: 0,
    });
  });
});
