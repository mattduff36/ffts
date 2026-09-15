import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
  recoverIncompleteSuccessorCommit,
  getSuccessorCommitPendingPath,
  readProtocolRecord,
  SUCCESSOR_COMMIT_PENDING_KIND,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import {
  createDefaultPlanContract,
  renderPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';
import {
  outboundSuccessorProvenance,
  validateWorkflowProtocolRecordStructure,
} from '@/scripts/automation/workflow-v24-protocol-validator';
import { getWorkflowPaths, loadWorkflowReviewStateStrict } from '@/scripts/automation/workflow-events';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
  writePassingManifest,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function writeSuccessorPlan(
  repoRoot: string,
  workstreamId: string,
  requiredIds: string[],
  predecessorId: string
): string {
  const contract = createDefaultPlanContract({
    workstreamId,
    sourceWorkstreamIds: [predecessorId],
    taskId: workstreamId,
    taskType: 'change',
    lane: 'critical',
    rationale: 'Owner-authorised successor fixture',
    fallbackEscalation: 'Do not mint another generation without owner authorisation.',
    requiredTests: requiredIds.map((id) => ({ id, status: 'unresolved' as const })),
  });
  const plansDir = path.join(repoRoot, 'docs_private', 'automation', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const planPath = path.join(plansDir, `${workstreamId}.md`);
  writeFileSync(planPath, `# Successor\n\n${renderPlanContractMarker(contract)}\n`, 'utf8');
  return planPath;
}

function exhaustWorkstream(repoRoot: string, workstreamId: string, blockerIds: string[]) {
  const current = readProtocolRecord(repoRoot, workstreamId)!;
  const now = new Date().toISOString();
  writeProtocolRecord(repoRoot, {
    ...current,
    phase: 'routing_required',
    nextAction: 'route_or_isolate',
    failedPremiumReviewCount: 2,
    activeReviewToken: null,
    activeReviewPass: null,
    reviewAttempts: [
      {
        pass: 'first',
        token: 'rev_first_seedgen3001',
        startedAt: now,
        headCommit: current.headCommit,
        treeFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        result: 'failed',
        blockerFamilies: ['request-id'],
        blockerIds,
        recordedAt: now,
      },
      {
        pass: 'closure',
        token: 'rev_closure_seedgen3002',
        startedAt: now,
        headCommit: current.headCommit,
        treeFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        result: 'failed',
        blockerFamilies: ['idempotency'],
        blockerIds,
        recordedAt: now,
      },
    ],
    openBlockerIds: blockerIds,
    blockerFamilies: ['request-id', 'idempotency'],
  });
}

function seedExhaustedParent(repoRoot: string, parentId: string): string {
  const baseCommit = initGitRepo(repoRoot);
  initWorkstream(repoRoot, parentId, baseCommit);
  exhaustWorkstream(repoRoot, parentId, ['SCHED-ASSIGN-API-001']);
  return baseCommit;
}

function createSuccessor(
  repoRoot: string,
  parentId: string,
  childId: string,
  requiredIds: string[]
) {
  const planPath = writeSuccessorPlan(repoRoot, childId, requiredIds, parentId);
  const result = applyProtocolTransition({
    repoRoot,
    command: 'successor',
    workstreamId: parentId,
    newWorkstreamId: childId,
    planPath,
    ownerAuthorisedGeneration: true,
  });
  expect(result.ok, result.message).toBe(true);
  return result;
}

describe('TEE V2.5 Generation 3 successor', () => {
  it('TEE-GEN3-CHAIN-001 preserves inbound Gen 2 provenance and records outbound Gen 3', () => {
    const repoRoot = makeTempRoot('gen3-chain');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    createSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2', ['TEE-PLAN-001']);
    const gen2Inbound = readProtocolRecord(repoRoot, 'ws_ffts_gen2')!.successorProvenance;
    exhaustWorkstream(repoRoot, 'ws_ffts_gen2', ['SCHED-ASSIGN-API-001']);
    createSuccessor(repoRoot, 'ws_ffts_gen2', 'ws_ffts_gen3', [
      'TEE-PLAN-001',
      'SCHED-ASSIGN-API-001',
    ]);

    const gen1 = readProtocolRecord(repoRoot, 'ws_ffts_pred')!;
    const gen2 = readProtocolRecord(repoRoot, 'ws_ffts_gen2')!;
    const gen3 = readProtocolRecord(repoRoot, 'ws_ffts_gen3')!;
    expect(gen1.phase).toBe('successor_parked');
    expect(gen2.phase).toBe('successor_parked');
    expect(gen3.phase).toBe('initialized');
    expect(gen2.successorProvenance).toEqual(gen2Inbound);
    expect(gen2.successorProvenance?.generation).toBe(2);
    expect(outboundSuccessorProvenance(gen2)?.generation).toBe(3);
    expect(outboundSuccessorProvenance(gen2)).toEqual(gen3.successorProvenance);
    expect(gen3.successorProvenance?.predecessorWorkstreamId).toBe('ws_ffts_gen2');
    expect(gen3.failedPremiumReviewCount).toBe(0);
    expect(gen3.openBlockerIds).toEqual(['SCHED-ASSIGN-API-001']);
  });

  it('TEE-GEN3-REPLAY-002 allows inbound provenance but refuses an existing outbound child', () => {
    const repoRoot = makeTempRoot('gen3-replay');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    createSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2', ['TEE-PLAN-001']);
    exhaustWorkstream(repoRoot, 'ws_ffts_gen2', ['SCHED-ASSIGN-API-001']);
    const inboundOnly = applyProtocolTransition({
      repoRoot,
      command: 'successor',
      workstreamId: 'ws_ffts_gen2',
      newWorkstreamId: 'ws_ffts_gen3',
      planPath: writeSuccessorPlan(repoRoot, 'ws_ffts_gen3', ['TEE-PLAN-001'], 'ws_ffts_gen2'),
      ownerAuthorisedGeneration: true,
    });
    expect(inboundOnly.ok).toBe(true);

    const replay = applyProtocolTransition({
      repoRoot,
      command: 'successor',
      workstreamId: 'ws_ffts_gen2',
      newWorkstreamId: 'ws_ffts_gen3b',
      planPath: writeSuccessorPlan(repoRoot, 'ws_ffts_gen3b', ['TEE-PLAN-001'], 'ws_ffts_gen2'),
      ownerAuthorisedGeneration: true,
    });
    expect(replay.ok).toBe(false);
    expect(replay.message).toMatch(/already exists|refuse replay|routing_required|exhausted/);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_gen3')?.phase).toBe('initialized');
  });

  it('TEE-GEN3-VALIDATOR-003 rejects illegal ownership, generation gaps, and field combinations', () => {
    const repoRoot = makeTempRoot('gen3-validator');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    createSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2', ['TEE-PLAN-001']);
    const gen2 = readProtocolRecord(repoRoot, 'ws_ffts_gen2')!;
    expect(
      validateWorkflowProtocolRecordStructure({
        ...gen2,
        successorChildProvenance: gen2.successorProvenance,
      }).ok
    ).toBe(false);

    exhaustWorkstream(repoRoot, 'ws_ffts_gen2', ['SCHED-ASSIGN-API-001']);
    createSuccessor(repoRoot, 'ws_ffts_gen2', 'ws_ffts_gen3', ['TEE-PLAN-001']);
    const parked = readProtocolRecord(repoRoot, 'ws_ffts_gen2')!;
    expect(
      validateWorkflowProtocolRecordStructure({
        ...parked,
        successorChildProvenance: {
          ...parked.successorChildProvenance!,
          generation: parked.successorProvenance!.generation,
        },
      }).ok
    ).toBe(false);
    expect(
      validateWorkflowProtocolRecordStructure({
        ...parked,
        successorChildProvenance: {
          ...parked.successorChildProvenance!,
          predecessorWorkstreamId: 'ws_ffts_other',
        },
      }).ok
    ).toBe(false);
  });

  it('TEE-GEN3-FINALISE-004 parks both ancestors and blocks tampered hops', () => {
    const repoRoot = makeTempRoot('gen3-finalise');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    createSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2', ['TEE-PLAN-001']);
    exhaustWorkstream(repoRoot, 'ws_ffts_gen2', ['SCHED-ASSIGN-API-001']);
    createSuccessor(repoRoot, 'ws_ffts_gen2', 'ws_ffts_gen3', ['TEE-PLAN-001']);
    const ready = getFinaliseProtocolReadiness(repoRoot);
    expect(ready.lineages.find((row) => row.workstreamId === 'ws_ffts_pred')?.role).toBe(
      'parked_successor_ancestor'
    );
    expect(ready.lineages.find((row) => row.workstreamId === 'ws_ffts_gen2')?.role).toBe(
      'parked_successor_ancestor'
    );
    expect(ready.blockingWorkstreams.some((row) => row.workstreamId === 'ws_ffts_pred')).toBe(false);
    expect(ready.blockingWorkstreams.some((row) => row.workstreamId === 'ws_ffts_gen2')).toBe(false);

    const tampered = readProtocolRecord(repoRoot, 'ws_ffts_gen3')!;
    writeProtocolRecord(repoRoot, {
      ...tampered,
      successorProvenance: {
        ...tampered.successorProvenance!,
        createdAtHeadCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    });
    const blocked = getFinaliseProtocolReadiness(repoRoot);
    expect(
      blocked.blockingWorkstreams.some(
        (row) =>
          row.workstreamId === 'ws_ffts_gen2' &&
          /reciprocal successorProvenance|no valid child continuation/.test(row.message)
      )
    ).toBe(true);
  });

  it('TEE-GEN3-BLOCKERS-005 requires inherited blockers proven before first review', () => {
    const repoRoot = makeTempRoot('gen3-blockers');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    createSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2', ['TEE-PLAN-001']);
    exhaustWorkstream(repoRoot, 'ws_ffts_gen2', ['SCHED-ASSIGN-API-001']);
    createSuccessor(repoRoot, 'ws_ffts_gen2', 'ws_ffts_gen3', ['TEE-PLAN-001']);
    const manifestPath = writePassingManifest(repoRoot, 'ws_ffts_gen3', 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId: 'ws_ffts_gen3',
        manifestPath,
      }).ok
    ).toBe(true);
    const blocked = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_ffts_gen3',
      pass: 'first',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/inherited blockers/);
  });

  it('TEE-GEN3-ATOMIC-006 recovers a crashed Generation 3 persist', () => {
    const repoRoot = makeTempRoot('gen3-atomic');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    createSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2', ['TEE-PLAN-001']);
    exhaustWorkstream(repoRoot, 'ws_ffts_gen2', ['SCHED-ASSIGN-API-001']);
    const previousParent = readProtocolRecord(repoRoot, 'ws_ffts_gen2')!;
    writeFileSync(
      getSuccessorCommitPendingPath(repoRoot),
      JSON.stringify({
        schemaVersion: '1',
        kind: SUCCESSOR_COMMIT_PENDING_KIND,
        createdAt: new Date().toISOString(),
        parentId: 'ws_ffts_gen2',
        childId: 'ws_ffts_gen3',
        previousParent,
        previousChild: null,
        previousState: loadWorkflowReviewStateStrict(getWorkflowPaths(repoRoot).statePath),
      }),
      'utf8'
    );
    expect(recoverIncompleteSuccessorCommit(repoRoot)).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_gen2')?.phase).toBe('routing_required');
    expect(readProtocolRecord(repoRoot, 'ws_ffts_gen3')).toBeNull();
    expect(existsSync(getSuccessorCommitPendingPath(repoRoot))).toBe(false);
  });

  it('TEE-GEN3-AUTH-007 refuses Generation 4 without a new exhausted authorised invocation', () => {
    const repoRoot = makeTempRoot('gen3-auth');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    createSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2', ['TEE-PLAN-001']);
    exhaustWorkstream(repoRoot, 'ws_ffts_gen2', ['SCHED-ASSIGN-API-001']);
    createSuccessor(repoRoot, 'ws_ffts_gen2', 'ws_ffts_gen3', ['TEE-PLAN-001']);
    const unauthorised = applyProtocolTransition({
      repoRoot,
      command: 'successor',
      workstreamId: 'ws_ffts_gen3',
      newWorkstreamId: 'ws_ffts_gen4',
      planPath: writeSuccessorPlan(repoRoot, 'ws_ffts_gen4', ['TEE-PLAN-001'], 'ws_ffts_gen3'),
    });
    expect(unauthorised.ok).toBe(false);
    expect(unauthorised.message).toMatch(/owner-authorised-generation/);
    const notExhausted = applyProtocolTransition({
      repoRoot,
      command: 'successor',
      workstreamId: 'ws_ffts_gen3',
      newWorkstreamId: 'ws_ffts_gen4',
      planPath: writeSuccessorPlan(repoRoot, 'ws_ffts_gen4', ['TEE-PLAN-001'], 'ws_ffts_gen3'),
      ownerAuthorisedGeneration: true,
    });
    expect(notExhausted.ok).toBe(false);
    expect(notExhausted.message).toMatch(/routing_required|exhausted/);
  });
});
