import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationRun } from '@/scripts/automation/logger';
import {
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
} from '@/scripts/automation/workflow-events';
import { getCurrentTreeFingerprint } from '@/scripts/automation/workflow-evidence-manifest';
import {
  createDefaultPlanContract,
  renderPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';
import {
  getFinaliseProtocolReadiness,
  isCriticalProtocolWorkstream,
  resolveProtectedFinaliseC9Authority,
} from '@/scripts/automation/workflow-finalise-correlation';
import {
  validateWorkflowProtocolRecordSemantics,
  validateWorkflowProtocolRecordStructure,
} from '@/scripts/automation/workflow-v24-protocol-validator';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  makeTempRoot,
  writeCriticalPlan,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function writeEmptyState(repoRoot: string) {
  const paths = getWorkflowPaths(repoRoot);
  mkdirSync(path.dirname(paths.statePath), { recursive: true });
  saveWorkflowReviewState(paths.statePath, createEmptyWorkflowReviewState());
}

function writeStandardPlan(repoRoot: string, workstreamId: string): string {
  const contract = createDefaultPlanContract({
    workstreamId,
    taskId: workstreamId,
    taskType: 'change',
    lane: 'standard',
    rationale: 'page-local reversible fixture',
    fallbackEscalation: 'Escalate only on evidence.',
    requiredTests: [{ id: 'TEE-PLAN-001', status: 'unresolved' }],
  });
  const plansDir = path.join(repoRoot, 'docs_private', 'automation', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const planPath = path.join(plansDir, `${workstreamId}.md`);
  writeFileSync(planPath, `# fixture\n\n${renderPlanContractMarker(contract)}\n`, 'utf8');
  return `docs_private/automation/plans/${workstreamId}.md`;
}

function saveReadyContext(
  repoRoot: string,
  head: string,
  extras: {
    workstreamId?: string;
    checkpointId?: string;
    planPath?: string | null;
    omitActivatedHead?: boolean;
    phase?: 'finalise_ready' | 'finalised';
  } = {}
) {
  const workstreamId = extras.workstreamId ?? 'ws_c9';
  const checkpointId = extras.checkpointId ?? 'ckpt_c9';
  const record = createEmptyProtocolRecord({
    workstreamId,
    baseCommit: head,
    branchName: 'main',
    headCommit: head,
    planPath: extras.planPath ?? null,
  });
  const treeFingerprint = getCurrentTreeFingerprint(repoRoot).inputFingerprint;
  record.reviewedTreeFingerprint = treeFingerprint;
  record.reviewAttempts = [
    {
      pass: 'first',
      token: `rev_first_${workstreamId}_lane`,
      startedAt: record.updatedAt,
      recordedAt: record.updatedAt,
      result: 'passed',
      headCommit: head,
      treeFingerprint,
    },
  ];
  if (extras.phase === 'finalised') {
    record.phase = 'finalised';
    record.nextAction = 'done';
    record.activeCheckpointId = null;
  } else {
    record.phase = 'finalise_ready';
    record.nextAction = 'run_finalise';
    record.activeCheckpointId = checkpointId;
  }
  writeProtocolRecord(repoRoot, record);
  const paths = getWorkflowPaths(repoRoot);
  mkdirSync(path.dirname(paths.statePath), { recursive: true });
  saveWorkflowReviewState(paths.statePath, {
    ...createEmptyWorkflowReviewState(),
    protocolRecords: { [workstreamId]: record },
    activeFinaliseContext:
      extras.phase === 'finalised'
        ? null
        : {
            workstreamId,
            checkpointId,
            activatedAt: new Date().toISOString(),
            activatedHeadCommit: extras.omitActivatedHead ? undefined : head,
            activatedBranchName: 'main',
            ownedCommits: [head],
          },
  });
}

function createFinaliseRun(repoRoot: string) {
  return new AutomationRun({
    scriptName: 'finalise',
    mode: 'run',
    args: [],
    persist: true,
    repoRoot,
  });
}

function listRunLogs(repoRoot: string): Array<{ status?: string; correlation?: unknown; path: string }> {
  const dir = path.join(repoRoot, 'docs_private', 'automation', 'runs', 'finalise');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.c9-identity.json'))
    .map((name) => {
      const filePath = path.join(dir, name);
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
        status?: string;
        workflowCorrelation?: unknown;
      };
      return { status: parsed.status, correlation: parsed.workflowCorrelation, path: filePath };
    });
}

function listC9IdentityFiles(repoRoot: string): string[] {
  const dir = path.join(repoRoot, 'docs_private', 'automation', 'runs', 'finalise');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.c9-identity.json'));
}

function workstreamDirs(repoRoot: string): string[] {
  const root = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
  if (!existsSync(root)) return [];
  return readdirSync(root);
}

function expectUnboundOrdinaryAuthority(repoRoot: string) {
  expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(true);
  expect(resolveProtectedFinaliseC9Authority({ repoRoot })).toEqual({ kind: 'not_required' });
  const run = createFinaliseRun(repoRoot);
  expect(run.getCapturedC9Authority()).toEqual({ kind: 'not_required' });
  expect(run.usesProtectedC9Binding()).toBe(false);
  return run;
}

async function expectOrdinaryFinishWithoutC9(repoRoot: string) {
  const run = createFinaliseRun(repoRoot);
  await expect(run.finish('passed')).resolves.toBeUndefined();
  expect(listC9IdentityFiles(repoRoot)).toEqual([]);
  expect(workstreamDirs(repoRoot)).toEqual([]);
  const logs = listRunLogs(repoRoot);
  expect(logs.some((log) => log.status === 'passed')).toBe(true);
  expect(
    logs.some(
      (log) =>
        log.correlation &&
        typeof log.correlation === 'object' &&
        Array.isArray((log.correlation as { workstreamIds?: unknown }).workstreamIds) &&
        (log.correlation as { workstreamIds: unknown[] }).workstreamIds.length === 0 &&
        (log.correlation as { matchedBy?: string }).matchedBy === 'none'
    )
  ).toBe(true);
  expect(readProtocolRecord(repoRoot, 'ws_c9')).toBeNull();
}

async function expectOrdinaryRunRejectsLaterBinding(repoRoot: string, head: string) {
  writeEmptyState(repoRoot);
  const run = createFinaliseRun(repoRoot);
  expect(run.getCapturedC9Authority()).toEqual({ kind: 'not_required' });
  saveReadyContext(repoRoot, head);
  await expect(run.finish('passed')).rejects.toThrow(/contamination|refuse finish\(passed\)/i);
  expect(listRunLogs(repoRoot).some((log) => log.status === 'passed')).toBe(false);
  expect(readProtocolRecord(repoRoot, 'ws_c9')?.phase).toBe('finalise_ready');
  expect(listC9IdentityFiles(repoRoot)).toEqual([]);
}

async function expectOrdinaryRetryLeavesVersionUntouched(repoRoot: string) {
  writeEmptyState(repoRoot);
  writeFileSync(path.join(repoRoot, 'VERSION'), '1.0.0\n', 'utf8');
  await expect(createFinaliseRun(repoRoot).finish('failed', new Error('prior bookkeeping'))).resolves.toBeUndefined();
  await expect(createFinaliseRun(repoRoot).finish('passed')).resolves.toBeUndefined();
  expect(readFileSync(path.join(repoRoot, 'VERSION'), 'utf8')).toBe('1.0.0\n');
  expect(listC9IdentityFiles(repoRoot)).toEqual([]);
  expect(workstreamDirs(repoRoot)).toEqual([]);
  expect(listRunLogs(repoRoot).filter((log) => log.status === 'passed')).toHaveLength(1);
}

describe('TEE V2.4 lane-aware finalise C9 authority', () => {
  it('TEE-V24-LANE-C9-STD-001: STANDARD unbound allowed finalise is not_required', () => {
    const repoRoot = makeTempRoot('lane-std');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    expectUnboundOrdinaryAuthority(repoRoot);
  });

  it('TEE-V24-LANE-C9-FAST-002: FAST unbound allowed finalise is not_required', () => {
    const repoRoot = makeTempRoot('lane-fast');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    expectUnboundOrdinaryAuthority(repoRoot);
  });

  it('TEE-V24-LANE-C9-NO-FAKE-WS-003: ordinary finish does not fabricate a workstream', async () => {
    const repoRoot = makeTempRoot('lane-no-fake-ws');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    await expectOrdinaryFinishWithoutC9(repoRoot);
  });

  it('TEE-V24-LANE-C9-NO-FAKE-C9-004: ordinary finish does not fabricate a C9 checkpoint', async () => {
    const repoRoot = makeTempRoot('lane-no-fake-c9');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    await expectOrdinaryFinishWithoutC9(repoRoot);
  });

  it('TEE-V24-LANE-C9-FINISH-STD-005: STANDARD finish(passed) completes on the ordinary path', async () => {
    const repoRoot = makeTempRoot('lane-finish-std');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    await expectOrdinaryFinishWithoutC9(repoRoot);
  });

  it('TEE-V24-LANE-C9-UNKNOWN-010: unreadable or malformed authority fails closed', () => {
    const repoRoot = makeTempRoot('lane-unknown');
    initGitRepo(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    writeFileSync(paths.statePath, '{not-json', 'utf8');
    const authority = resolveProtectedFinaliseC9Authority({ repoRoot });
    expect(authority.kind).toBe('unknown');
    expect(() => createFinaliseRun(repoRoot).assertProtectedFinaliseAuthorityBeforeMutation()).toThrow(
      /malformed|unreadable|refuse/i
    );
  });

  it('TEE-V24-LANE-C9-NO-MUTATE-011: later finalise-start cannot rewrite a captured ordinary run', async () => {
    const repoRoot = makeTempRoot('lane-no-mutate');
    const head = initGitRepo(repoRoot);
    await expectOrdinaryRunRejectsLaterBinding(repoRoot, head);
  });

  it('TEE-V24-LANE-C9-NO-INHERIT-013: unrelated historical CRITICAL workstream is not inherited', async () => {
    const repoRoot = makeTempRoot('lane-no-inherit');
    const head = initGitRepo(repoRoot);
    saveReadyContext(repoRoot, head, { workstreamId: 'ws_historical', phase: 'finalised' });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(true);
    expect(resolveProtectedFinaliseC9Authority({ repoRoot })).toEqual({ kind: 'not_required' });
    const run = createFinaliseRun(repoRoot);
    await expect(run.finish('passed')).resolves.toBeUndefined();
    expect(listC9IdentityFiles(repoRoot)).toEqual([]);
    const logs = listRunLogs(repoRoot);
    expect(logs.some((log) => log.status === 'passed')).toBe(true);
    expect(
      logs.some(
        (log) =>
          log.correlation &&
          typeof log.correlation === 'object' &&
          (log.correlation as { workstreamIds?: string[] }).workstreamIds?.includes('ws_historical')
      )
    ).toBe(false);
    expect(readProtocolRecord(repoRoot, 'ws_historical')?.phase).toBe('finalised');
  });

  it('TEE-V24-LANE-C9-RETRY-014: ordinary retry stays idempotent after a bookkeeping failure', async () => {
    const repoRoot = makeTempRoot('lane-retry');
    initGitRepo(repoRoot);
    await expectOrdinaryRetryLeavesVersionUntouched(repoRoot);
  });

  it('TEE-V24-LANE-C9-EXIT0-015: successful ordinary finish writes a passed run log', async () => {
    const repoRoot = makeTempRoot('lane-exit0');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    await expectOrdinaryFinishWithoutC9(repoRoot);
  });

  it('TEE-V24-LANE-C9-VERSION-016: ordinary retry does not invent a version bump', async () => {
    const repoRoot = makeTempRoot('lane-version');
    initGitRepo(repoRoot);
    await expectOrdinaryRetryLeavesVersionUntouched(repoRoot);
  });

  it('TEE-V24-LANE-C9-PREMUTATE-017: unknown authority rejects before mutation', () => {
    const repoRoot = makeTempRoot('lane-premutate-unknown');
    initGitRepo(repoRoot);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    writeFileSync(paths.statePath, '{not-json', 'utf8');
    expect(() =>
      createFinaliseRun(repoRoot).assertProtectedFinaliseAuthorityBeforeMutation()
    ).toThrow(/malformed|unreadable|refuse mutation/i);
  });

  it('TEE-V24-LANE-C9-CONSUMER-SYMMETRY-018: constructor, finish, assertion, push and pre-mutation consumers agree', async () => {
    const repoRoot = makeTempRoot('lane-symmetry');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    const resolved = resolveProtectedFinaliseC9Authority({ repoRoot });
    const run = createFinaliseRun(repoRoot);
    expect(run.getCapturedC9Authority()).toEqual(resolved);
    expect(run.usesProtectedC9Binding()).toBe(resolved.kind === 'required');
    expect(() => run.assertProtectedFinaliseAuthorityBeforeMutation()).not.toThrow();
    await expect(run.finish('passed')).resolves.toBeUndefined();
    expect(() => run.assertC9BeforeRemoteMutation()).toThrow(/ordinary finalise cannot use protected C9 push/i);
  });

  it('TEE-V24-LANE-C9-NO-CONTAMINATION-019: a later active context cannot capture an ordinary run', async () => {
    const repoRoot = makeTempRoot('lane-contaminate');
    const head = initGitRepo(repoRoot);
    await expectOrdinaryRunRejectsLaterBinding(repoRoot, head);
  });

  it('TEE-V24-LANE-C9-PUSH-POLICY-020: ordinary --push is refused before mutation', () => {
    const repoRoot = makeTempRoot('lane-premutate-push');
    initGitRepo(repoRoot);
    writeEmptyState(repoRoot);
    const ordinary = createFinaliseRun(repoRoot);
    expect(() => ordinary.assertProtectedFinaliseAuthorityBeforeMutation()).not.toThrow();
    expect(() =>
      ordinary.assertProtectedFinaliseAuthorityBeforeMutation({ pushRequested: true })
    ).toThrow(/refuse --push before mutation/i);
    expect(() => ordinary.assertC9BeforeRemoteMutation()).toThrow(/refuse remote mutation/i);
    expect(listC9IdentityFiles(repoRoot)).toEqual([]);
  });

  it('TEE-V24-LANE-C9-BOUND-CONTEXT-021: any valid finalise-start binding remains C9-required', async () => {
    const repoRoot = makeTempRoot('lane-bound-standard-plan');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_bound_std';
    const planPath = writeStandardPlan(repoRoot, workstreamId);
    saveReadyContext(repoRoot, head, { workstreamId, planPath });
    expect(resolveProtectedFinaliseC9Authority({ repoRoot }).kind).toBe('required');
    const run = createFinaliseRun(repoRoot);
    expect(run.usesProtectedC9Binding()).toBe(true);
    await expect(run.finish('passed')).resolves.toBeUndefined();
    expect(readProtocolRecord(repoRoot, workstreamId)?.phase).toBe('finalised');
    expect(listC9IdentityFiles(repoRoot).length).toBeGreaterThan(0);
  });

  function writeBoundCriticalProtocol(
    repoRoot: string,
    workstreamId: string,
    head: string,
    extras: { phase?: 'initialized' | 'first_review' | 'review_closed'; planPath?: string } = {}
  ) {
    const planPath = extras.planPath ?? writeCriticalPlan(repoRoot, workstreamId);
    const relativePlan = `docs_private/automation/plans/${workstreamId}.md`;
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
      planPath: relativePlan,
      boundPlanCriticality: 'critical',
    });
    record.phase = extras.phase ?? 'initialized';
    if (extras.phase === 'first_review') {
      record.nextAction = 'review_record';
      record.activeReviewToken = 'rev_first_bound_lane';
      record.activeReviewPass = 'first';
    }
    if (extras.phase === 'review_closed') {
      const treeFingerprint = getCurrentTreeFingerprint(repoRoot).inputFingerprint;
      record.reviewedTreeFingerprint = treeFingerprint;
      record.nextAction = 'finalise_start';
      record.reviewAttempts = [
        {
          pass: 'first',
          token: 'rev_first_bound_lane',
          startedAt: record.updatedAt,
          recordedAt: record.updatedAt,
          result: 'passed',
          headCommit: head,
          treeFingerprint,
        },
      ];
    }
    writeProtocolRecord(repoRoot, record);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { [workstreamId]: record },
    });
    return { record, planPath };
  }

  function overwritePlanToStandard(repoRoot: string, workstreamId: string) {
    writeStandardPlan(repoRoot, workstreamId);
  }

  it('TEE-V24-LANE-C9-NO-PLAN-DOWNGRADE-022: initialized CRITICAL binding survives a STANDARD plan edit', () => {
    const repoRoot = makeTempRoot('lane-plan-downgrade-init');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_plan_init';
    writeBoundCriticalProtocol(repoRoot, workstreamId, head, { phase: 'initialized' });
    overwritePlanToStandard(repoRoot, workstreamId);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    expect(resolveProtectedFinaliseC9Authority({ repoRoot }).kind).not.toBe('not_required');
  });

  it('TEE-V24-LANE-C9-NO-PLAN-DOWNGRADE-REVIEW-023: review-active CRITICAL binding survives a STANDARD plan edit', () => {
    const repoRoot = makeTempRoot('lane-plan-downgrade-review');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_plan_review';
    writeBoundCriticalProtocol(repoRoot, workstreamId, head, { phase: 'first_review' });
    overwritePlanToStandard(repoRoot, workstreamId);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    expect(resolveProtectedFinaliseC9Authority({ repoRoot }).kind).not.toBe('not_required');
  });

  it('TEE-V24-LANE-C9-NO-PLAN-DOWNGRADE-CLOSED-024: review-closed CRITICAL binding survives a STANDARD plan edit', () => {
    const repoRoot = makeTempRoot('lane-plan-downgrade-closed');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_plan_closed';
    const { record } = writeBoundCriticalProtocol(repoRoot, workstreamId, head, {
      phase: 'review_closed',
    });

    const structure = validateWorkflowProtocolRecordStructure(record);
    const semantics = validateWorkflowProtocolRecordSemantics(record);
    expect(structure.ok).toBe(true);
    expect(semantics.ok).toBe(true);
    expect(record.reviewedTreeFingerprint).toBe(record.reviewAttempts[0]?.treeFingerprint);
    expect(record.reviewedTreeFingerprint).toMatch(/^[a-f0-9]+$/i);

    const before = getFinaliseProtocolReadiness(repoRoot);
    expect(before.allowed).toBe(false);
    expect(before.blockingWorkstreams.some((blocker) => blocker.role === 'malformed')).toBe(false);
    expect(isCriticalProtocolWorkstream(repoRoot, record)).toBe(true);
    expect(resolveProtectedFinaliseC9Authority({ repoRoot }).kind).not.toBe('not_required');

    overwritePlanToStandard(repoRoot, workstreamId);

    const afterRecord = readProtocolRecord(repoRoot, workstreamId);
    expect(afterRecord).not.toBeNull();
    expect(afterRecord && isCriticalProtocolWorkstream(repoRoot, afterRecord)).toBe(true);
    const after = getFinaliseProtocolReadiness(repoRoot);
    expect(after.allowed).toBe(false);
    expect(after.blockingWorkstreams.some((blocker) => blocker.role === 'malformed')).toBe(false);
    expect(resolveProtectedFinaliseC9Authority({ repoRoot }).kind).not.toBe('not_required');
  });

  it('TEE-V24-LANE-C9-PREMUTATE-IDENTITY-025: missing activated HEAD is rejected before mutation', () => {
    const repoRoot = makeTempRoot('lane-premutate-identity');
    const head = initGitRepo(repoRoot);
    saveReadyContext(repoRoot, head, { omitActivatedHead: true });
    expect(() =>
      createFinaliseRun(repoRoot).assertProtectedFinaliseAuthorityBeforeMutation()
    ).toThrow(/activated HEAD|identity is missing|refuse mutation/i);
  });

  it('TEE-V24-LANE-C9-PREMUTATE-SWAP-026: live owner B cannot mutate under captured owner A', () => {
    const repoRoot = makeTempRoot('lane-premutate-swap');
    const head = initGitRepo(repoRoot);
    saveReadyContext(repoRoot, head, { workstreamId: 'ws_a', checkpointId: 'ckpt_a' });
    const run = createFinaliseRun(repoRoot);
    saveReadyContext(repoRoot, head, { workstreamId: 'ws_b', checkpointId: 'ckpt_b' });
    expect(() => run.assertProtectedFinaliseAuthorityBeforeMutation()).toThrow(
      /live finalise owner|refuse mutation/i
    );
  });

  it('does not treat a CRITICAL plan without finalise-start as ordinary when readiness is blocked', () => {
    const repoRoot = makeTempRoot('lane-critical-unbound');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_unbound_crit';
    writeCriticalPlan(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
      planPath: `docs_private/automation/plans/${workstreamId}.md`,
    });
    writeProtocolRecord(repoRoot, record);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { [workstreamId]: record },
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    expect(resolveProtectedFinaliseC9Authority({ repoRoot }).kind).toBe('unknown');
  });
});
