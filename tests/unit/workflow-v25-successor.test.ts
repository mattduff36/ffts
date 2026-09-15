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
    rationale: 'Generation 2 successor fixture',
    fallbackEscalation:
      'Do not mint Generation 3 without new owner authorisation. Do not hand-edit protocol JSON.',
    requiredTests: requiredIds.map((id) => ({ id, status: 'unresolved' as const })),
  });
  const plansDir = path.join(repoRoot, 'docs_private', 'automation', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const planPath = path.join(plansDir, `${workstreamId}.md`);
  writeFileSync(
    planPath,
    `# Generation 2 successor\n\n${renderPlanContractMarker(contract)}\n`,
    'utf8'
  );
  return planPath;
}

function seedExhaustedParent(repoRoot: string, parentId: string): string {
  const baseCommit = initGitRepo(repoRoot);
  initWorkstream(repoRoot, parentId, baseCommit);
  const current = readProtocolRecord(repoRoot, parentId)!;
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
        token: 'rev_first_seedparent001',
        startedAt: now,
        headCommit: current.headCommit,
        treeFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        result: 'failed',
        blockerFamilies: ['verification'],
        blockerIds: ['SCHED-ASSIGN-SQL-001'],
        recordedAt: now,
      },
      {
        pass: 'closure',
        token: 'rev_closure_seedparent002',
        startedAt: now,
        headCommit: current.headCommit,
        treeFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        result: 'failed',
        blockerFamilies: ['migration-runner'],
        blockerIds: ['MIG-LOCAL-HOST-001'],
        recordedAt: now,
      },
    ],
    openBlockerIds: ['SCHED-ASSIGN-SQL-001', 'MIG-LOCAL-HOST-001'],
    blockerFamilies: ['verification', 'migration-runner'],
  });
  return baseCommit;
}

function exhaustAndSucceedSuccessor(
  repoRoot: string,
  parentId: string,
  childId: string,
  requiredIds = ['TEE-PLAN-001']
) {
  seedExhaustedParent(repoRoot, parentId);
  const planPath = writeSuccessorPlan(repoRoot, childId, requiredIds, parentId);
  const result = applyProtocolTransition({
    repoRoot,
    command: 'successor',
    workstreamId: parentId,
    newWorkstreamId: childId,
    planPath,
    ownerAuthorisedGeneration: true,
  });
  expect(result.ok).toBe(true);
  return { planPath, result };
}

describe('TEE V2.5 owner-authorised successor', () => {
  it('TEE-V25-SUCCESSOR-001 records one Generation 2 child against an exhausted parent', () => {
    const repoRoot = makeTempRoot('successor-legal');
    exhaustAndSucceedSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2');
    const parent = readProtocolRecord(repoRoot, 'ws_ffts_pred');
    const child = readProtocolRecord(repoRoot, 'ws_ffts_gen2');
    expect(parent?.phase).toBe('successor_parked');
    expect(child?.phase).toBe('initialized');
    expect(child?.failedPremiumReviewCount).toBe(0);
    expect(child?.inheritedFailedReviewCount).toBe(0);
    expect(child?.successorProvenance?.generation).toBe(2);
    expect(parent?.successorProvenance?.successorWorkstreamId).toBe('ws_ffts_gen2');
  });

  it('TEE-V25-SUCCESSOR-AUTH-001 refuses successor without owner authorisation', () => {
    const repoRoot = makeTempRoot('successor-auth');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    const planPath = writeSuccessorPlan(repoRoot, 'ws_ffts_gen2', ['TEE-PLAN-001'], 'ws_ffts_pred');
    const result = applyProtocolTransition({
      repoRoot,
      command: 'successor',
      workstreamId: 'ws_ffts_pred',
      newWorkstreamId: 'ws_ffts_gen2',
      planPath,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/owner-authorised-generation/);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_pred')?.phase).toBe('routing_required');
    expect(readProtocolRecord(repoRoot, 'ws_ffts_gen2')).toBeNull();
  });

  it('TEE-V25-SUCCESSOR-NO-MINT-002 refuses init/split mint from the exhausted parent', () => {
    const repoRoot = makeTempRoot('successor-nomint');
    exhaustAndSucceedSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2');
    const minted = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_ffts_mint',
      baseCommit: readProtocolRecord(repoRoot, 'ws_ffts_pred')?.baseCommit,
      planPath: writeSuccessorPlan(repoRoot, 'ws_ffts_mint', ['TEE-PLAN-001'], 'ws_ffts_pred'),
      sourceWorkstreamIds: ['ws_ffts_pred'],
    });
    expect(minted.ok).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_mint')?.failedPremiumReviewCount).toBeGreaterThanOrEqual(2);
    const split = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId: 'ws_ffts_pred',
      newWorkstreamId: 'ws_ffts_split',
    });
    expect(split.ok).toBe(false);
  });

  it('TEE-V25-SUCCESSOR-NO-MINT-007 refuses a second successor and replay', () => {
    const repoRoot = makeTempRoot('successor-replay');
    const { planPath } = exhaustAndSucceedSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2');
    const again = applyProtocolTransition({
      repoRoot,
      command: 'successor',
      workstreamId: 'ws_ffts_pred',
      newWorkstreamId: 'ws_ffts_gen3',
      planPath,
      ownerAuthorisedGeneration: true,
    });
    expect(again.ok).toBe(false);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_gen3')).toBeNull();
  });

  it('TEE-V25-SUCCESSOR-BUDGET-002 gives Generation 2 a fresh first/closure budget', () => {
    const repoRoot = makeTempRoot('successor-budget');
    exhaustAndSucceedSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2');
    const child = readProtocolRecord(repoRoot, 'ws_ffts_gen2')!;
    expect(child.failedPremiumReviewCount).toBe(0);
    expect(child.reviewAttempts).toEqual([]);
    writeProtocolRecord(repoRoot, { ...child, openBlockerIds: [] });
    const manifestPath = writePassingManifest(repoRoot, 'ws_ffts_gen2', 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId: 'ws_ffts_gen2',
        manifestPath,
      }).ok
    ).toBe(true);
    const first = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_ffts_gen2',
      pass: 'first',
    });
    expect(first.ok).toBe(true);
    expect(first.reviewToken).toMatch(/^rev_first_/);
  });

  it('TEE-V25-SUCCESSOR-PARK-003 parks the exhausted parent without rewriting its history', () => {
    const repoRoot = makeTempRoot('successor-park');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    const before = readProtocolRecord(repoRoot, 'ws_ffts_pred')!;
    const planPath = writeSuccessorPlan(repoRoot, 'ws_ffts_gen2', ['TEE-PLAN-001'], 'ws_ffts_pred');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'successor',
        workstreamId: 'ws_ffts_pred',
        newWorkstreamId: 'ws_ffts_gen2',
        planPath,
        ownerAuthorisedGeneration: true,
      }).ok
    ).toBe(true);
    const after = readProtocolRecord(repoRoot, 'ws_ffts_pred')!;
    expect(after.phase).toBe('successor_parked');
    expect(after.nextAction).toBe('awaiting_successor_completion');
    expect(after.reviewAttempts).toEqual(before.reviewAttempts);
    expect(after.failedPremiumReviewCount).toBe(before.failedPremiumReviewCount);
    expect(after.baseCommit).toBe(before.baseCommit);
  });

  it('TEE-V25-SUCCESSOR-HISTORY-004 keeps parent attempts and closed IDs immutable', () => {
    const repoRoot = makeTempRoot('successor-history');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    const before = readProtocolRecord(repoRoot, 'ws_ffts_pred')!;
    const planPath = writeSuccessorPlan(repoRoot, 'ws_ffts_gen2', ['TEE-PLAN-001'], 'ws_ffts_pred');
    applyProtocolTransition({
      repoRoot,
      command: 'successor',
      workstreamId: 'ws_ffts_pred',
      newWorkstreamId: 'ws_ffts_gen2',
      planPath,
      ownerAuthorisedGeneration: true,
    });
    const parent = readProtocolRecord(repoRoot, 'ws_ffts_pred')!;
    const child = readProtocolRecord(repoRoot, 'ws_ffts_gen2')!;
    expect(parent.reviewAttempts).toEqual(before.reviewAttempts);
    expect(child.reviewAttempts).toEqual([]);
    expect(child.openBlockerIds).toEqual(before.openBlockerIds);
    expect(parent.headCommit).toBe(before.headCommit);
  });

  it('TEE-V25-SUCCESSOR-ATOMIC-003 / TEE-V25-SUCCESSOR-ATOMIC-005 recovers a crashed successor persist', () => {
    const repoRoot = makeTempRoot('successor-atomic');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    const previousParent = readProtocolRecord(repoRoot, 'ws_ffts_pred')!;
    const previousState = loadWorkflowReviewStateStrict(getWorkflowPaths(repoRoot).statePath);
    writeProtocolRecord(repoRoot, {
      ...previousParent,
      phase: 'successor_parked',
      nextAction: 'awaiting_successor_completion',
    });
    mkdirSync(getWorkflowPaths(repoRoot).knowledgeDirectory, { recursive: true });
    writeFileSync(
      getSuccessorCommitPendingPath(repoRoot),
      JSON.stringify({
        schemaVersion: '1',
        kind: SUCCESSOR_COMMIT_PENDING_KIND,
        createdAt: new Date().toISOString(),
        parentId: 'ws_ffts_pred',
        childId: 'ws_ffts_gen2',
        previousParent,
        previousChild: null,
        previousState,
      }),
      'utf8'
    );
    expect(recoverIncompleteSuccessorCommit(repoRoot)).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_pred')?.phase).toBe('routing_required');
    expect(readProtocolRecord(repoRoot, 'ws_ffts_gen2')).toBeNull();
    expect(existsSync(getSuccessorCommitPendingPath(repoRoot))).toBe(false);
  });

  it('TEE-V25-SUCCESSOR-FINALISE-004 / TEE-V25-SUCCESSOR-FINALISE-006 treats the parked parent as historical', () => {
    const repoRoot = makeTempRoot('successor-finalise');
    exhaustAndSucceedSuccessor(repoRoot, 'ws_ffts_pred', 'ws_ffts_gen2');
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    const parent = readiness.lineages.find((row) => row.workstreamId === 'ws_ffts_pred');
    const child = readiness.blockingWorkstreams.find((row) => row.workstreamId === 'ws_ffts_gen2');
    expect(parent?.role).toBe('parked_successor_ancestor');
    expect(readiness.blockingWorkstreams.some((row) => row.workstreamId === 'ws_ffts_pred')).toBe(
      false
    );
    expect(child).toBeTruthy();
    expect(child?.message).not.toMatch(/exhausted its lineage premium review budget/);
  });

  it('TEE-V25-SUCCESSOR-BLOCKERS-005 requires inherited blockers proven before first review', () => {
    const repoRoot = makeTempRoot('successor-blockers');
    seedExhaustedParent(repoRoot, 'ws_ffts_pred');
    const closedPlan = writeSuccessorPlan(
      repoRoot,
      'ws_ffts_gen2',
      ['TEE-PLAN-001'],
      'ws_ffts_pred'
    );
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'successor',
        workstreamId: 'ws_ffts_pred',
        newWorkstreamId: 'ws_ffts_gen2',
        planPath: closedPlan,
        ownerAuthorisedGeneration: true,
      }).ok
    ).toBe(true);
    const manifestPath = writePassingManifest(repoRoot, 'ws_ffts_gen2', 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId: 'ws_ffts_gen2',
        manifestPath,
      }).ok
    ).toBe(true);
    const blocked = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_ffts_gen2',
      pass: 'first',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/inherited blockers/);

    const provenRoot = makeTempRoot('successor-blockers-close');
    seedExhaustedParent(provenRoot, 'ws_ffts_pred');
    const provenPlan = writeSuccessorPlan(
      provenRoot,
      'ws_ffts_gen2',
      ['TEE-PLAN-001', 'SCHED-ASSIGN-SQL-001', 'MIG-LOCAL-HOST-001'],
      'ws_ffts_pred'
    );
    expect(
      applyProtocolTransition({
        repoRoot: provenRoot,
        command: 'successor',
        workstreamId: 'ws_ffts_pred',
        newWorkstreamId: 'ws_ffts_gen2',
        planPath: provenPlan,
        ownerAuthorisedGeneration: true,
      }).ok
    ).toBe(true);
    const provenManifest = writePassingManifest(provenRoot, 'ws_ffts_gen2', 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot: provenRoot,
        command: 'preflight-record',
        workstreamId: 'ws_ffts_gen2',
        manifestPath: provenManifest,
      }).ok
    ).toBe(true);
    expect(readProtocolRecord(provenRoot, 'ws_ffts_gen2')?.openBlockerIds).toEqual([]);
    expect(
      applyProtocolTransition({
        repoRoot: provenRoot,
        command: 'review-start',
        workstreamId: 'ws_ffts_gen2',
        pass: 'first',
      }).ok
    ).toBe(true);
  });
});
