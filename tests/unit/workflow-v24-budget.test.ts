import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKFLOW_ROUTING_REQUIRED_EXIT_CODE,
  applyProtocolTransition,
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import {
  createDefaultPlanContract,
  renderPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';
import {
  computeRouteEvidenceHash,
  isApprovalValidReviewEvidence,
  REHOME_EVIDENCE_CANON_VERSION,
  revalidateRouteDisposition,
} from '@/scripts/automation/workflow-v24-disposition';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  declaredRehome,
  exhaustSourceWorkstream,
  failFirstThenClosure,
  git,
  gitSourceEvidence,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
  writePassingManifest,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(async () => {
  cleanupWorkflowV24Fixtures();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

describe('TEE V2.4 lineage budget and disposition', { timeout: 50_000 }, () => {
  it('TEE-V24-BUDGET-001 / T-V24-CLOSURE-AFTER-FIRST-FAIL / T-V24-SECOND-FAIL-ROUTING / T-V24-FIRST-REJECT-AT-2 / T-V24-CLOSURE-REJECT-AT-2', () => {
    const repoRoot = makeTempRoot('budget');
    const baseCommit = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_ffts_budget', baseCommit);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_budget')?.failedPremiumReviewCount).toBe(0);
    failFirstThenClosure(repoRoot, 'ws_ffts_budget');
    const firstAgain = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_ffts_budget',
      pass: 'first',
    });
    expect(firstAgain.ok).toBe(false);
    expect(firstAgain.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
    const closureAgain = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_ffts_budget',
      pass: 'closure',
    });
    expect(closureAgain.ok).toBe(false);
    expect(closureAgain.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
  });

  it('T-V24-COSMETIC-SPLIT-INHERITS / T-V24-NARROWER-SPLIT-INHERITS / T-V24-FIXDELTA-SPLIT-INHERITS / T-V24-PREFLIGHT-NO-REOPEN / T-V24-REPEATED-SPLIT-NO-MINT / TEE-V24-BUDGET-002', () => {
    const repoRoot = makeTempRoot('split');
    const baseCommit = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_ffts_root', baseCommit);
    failFirstThenClosure(repoRoot, 'ws_ffts_root');

    const cosmetic = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId: 'ws_ffts_root',
      newWorkstreamId: 'ws_ffts_cosmetic',
    });
    expect(cosmetic.ok).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_cosmetic')?.phase).toBe('routing_required');

    const narrower = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId: 'ws_ffts_cosmetic',
      newWorkstreamId: 'ws_ffts_narrower',
      narrowerPartition: true,
      hasFixDelta: true,
    });
    expect(narrower.ok).toBe(true);
    const child = readProtocolRecord(repoRoot, 'ws_ffts_narrower');
    expect(child?.phase).toBe('routing_required');
    expect(child?.failedPremiumReviewCount).toBeGreaterThanOrEqual(2);
    expect(child?.inheritedFailedReviewCount).toBeGreaterThanOrEqual(2);

    const preflight = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId: 'ws_ffts_narrower',
      manifestPath: 'missing.json',
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);

    const firstAgain = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_ffts_narrower',
      pass: 'first',
    });
    expect(firstAgain.ok).toBe(false);
    expect(firstAgain.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);

    const secondSplit = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId: 'ws_ffts_narrower',
      newWorkstreamId: 'ws_ffts_again',
      narrowerPartition: true,
      hasFixDelta: true,
    });
    expect(secondSplit.ok).toBe(true);
    const grandchild = readProtocolRecord(repoRoot, 'ws_ffts_again');
    expect(grandchild?.phase).toBe('routing_required');
    expect(grandchild?.failedPremiumReviewCount).toBeGreaterThanOrEqual(2);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-start',
        workstreamId: 'ws_ffts_again',
        pass: 'first',
      }).ok
    ).toBe(false);
  });

  it('TEE-V24-ROUTE-001 / T-V24-ROUTE-NO-APPROVE / T-V24-ROUTE-NO-BIND-HEAD / T-V24-ROUTE-NO-FINALISE-READY / T-V24-EXHAUSTED-BLOCKS-FINALISE / T-V24-REMOVAL-RESOLVES-WITHOUT-FINALISE / T-V24-SUPERSEDE-REQUIRES-GIT', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('route');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    initWorkstream(repoRoot, 'ws_ffts_route', baseline);
    failFirstThenClosure(repoRoot, 'ws_ffts_route');
    const exhausted = readProtocolRecord(repoRoot, 'ws_ffts_route')!;
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    expect(
      getFinaliseProtocolReadiness(repoRoot).blockingWorkstreams.some((row) =>
        row.message.includes('exhausted')
      )
    ).toBe(true);

    const reasonOnly = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_ffts_route',
      disposition: 'superseded',
      reason: 'because we said so',
    });
    expect(reasonOnly.ok).toBe(false);

    const stillPresent = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_ffts_route',
      disposition: 'removed_from_release',
      reason: 'try while still present',
      implementationCommits: [impl],
    });
    expect(stillPresent.ok).toBe(false);

    spawnSync('git', ['reset', '--hard', baseline], { cwd: repoRoot, shell: false });
    const removed = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_ffts_route',
      disposition: 'removed_from_release',
      reason: 'implementation no longer in HEAD ancestry',
      implementationCommits: [impl],
    });
    expect(removed.ok).toBe(true);
    const routed = readProtocolRecord(repoRoot, 'ws_ffts_route')!;
    expect(routed.phase).toBe('removed_from_release');
    expect(routed.phase).not.toBe('finalised');
    expect(routed.phase).not.toBe('finalise_ready');
    expect(routed.phase).not.toBe('review_closed');
    expect(routed.activeReviewToken).toBeNull();
    expect(routed.reviewedTreeFingerprint ?? null).toBe(exhausted.reviewedTreeFingerprint ?? null);
    expect(routed.headCommit).toBe(exhausted.headCommit);
    expect(routed.failedPremiumReviewCount).toBe(exhausted.failedPremiumReviewCount);
    expect(routed.routeDisposition?.target).toBe('removed_from_release');
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(true);
    expect(readiness.lineages.find((row) => row.workstreamId === 'ws_ffts_route')?.role).toBe(
      'non_release_disposition'
    );
    expect(readiness.lineages.find((row) => row.workstreamId === 'ws_ffts_route')?.phase).not.toBe(
      'finalised'
    );
  });

  it('TEE-V24-REHOME-001 / T-V24-REHOME-REQUIRES-INDEPENDENT-GIT / T-V24-SPLIT-CHILD-NOT-REHOME / T-V24-NEW-ID-NO-FRESH-BUDGET / T-V24-SUCCESSOR-RETAINS-PREDECESSOR / T-V24-ILLEGAL-ATTEMPTS-AUDIT-ONLY', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('rehome');
    const baseline = initGitRepo(repoRoot);
    const blocked = commitFile(repoRoot, 'blocked.ts', 'blocked');
    initWorkstream(repoRoot, 'ws_ffts_pred', baseline);
    failFirstThenClosure(repoRoot, 'ws_ffts_pred');
    const split = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId: 'ws_ffts_pred',
      newWorkstreamId: 'ws_ffts_child',
      narrowerPartition: true,
    });
    expect(split.ok).toBe(true);
    const childRecord = readProtocolRecord(repoRoot, 'ws_ffts_child')!;
    childRecord.rehomeProvenance = declaredRehome(baseline, 'main', blocked, `${repoRoot}#main`);
    writeProtocolRecord(repoRoot, childRecord);
    const childBind = applyProtocolTransition({
      repoRoot,
      command: 'rehome-bind',
      workstreamId: 'ws_ffts_child',
      predecessorRootWorkstreamId: 'ws_ffts_pred_root',
      predecessorDescendantWorkstreamId: 'ws_ffts_pred_leaf',
      predecessorHeadCommit: blocked,
      predecessorReleaseContext: `${repoRoot}#main`,
      successorBaselineCommit: baseline,
      successorBranchName: 'main',
      sourcePatchSha256: 'b6f702708202edfdb10d73f69945f6b77c69b3402287011a747b2c6749a5f1a0',
      sourceProductTreeFingerprint:
        '6de6ce5e65258b15b98bfb8977590fae154083eff942cf09b4dc6091bd019019',
    });
    expect(childBind.ok).toBe(false);

    const sameContext = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_ffts_newid',
      baseCommit: baseline,
      sourceWorkstreamIds: ['ws_ffts_pred'],
    });
    expect(sameContext.ok).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_ffts_newid')?.failedPremiumReviewCount).toBeGreaterThanOrEqual(
      2
    );
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-start',
        workstreamId: 'ws_ffts_newid',
        pass: 'first',
      }).ok
    ).toBe(false);

    const predStub = createEmptyProtocolRecord({
      workstreamId: 'ws_ffts_pred_leaf',
      baseCommit: baseline,
      branchName: 'main',
      headCommit: blocked,
    });
    predStub.failedPremiumReviewCount = 7;
    predStub.inheritedFailedReviewCount = 7;
    predStub.phase = 'routing_required';
    writeProtocolRecord(repoRoot, predStub);

    spawnSync('git', ['branch', 'source', baseline], { cwd: repoRoot, shell: false });
    spawnSync('git', ['checkout', 'source'], { cwd: repoRoot, shell: false });
    commitFile(repoRoot, 'source.ts', 'source impl');
    exhaustSourceWorkstream(repoRoot, 'ws_ffts_source', baseline);
    const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
    const sourceEvidence = gitSourceEvidence(repoRoot, baseline, sourceHead);
    spawnSync(
      'git',
      ['checkout', '-f', '-b', 'successor', baseline],
      { cwd: repoRoot, shell: false }
    );
    spawnSync('git', ['checkout', 'source', '--', '.'], { cwd: repoRoot, shell: false });
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'import source'],
      { cwd: repoRoot, shell: false }
    );
    spawnSync('git', ['checkout', '-f', 'successor'], { cwd: repoRoot, shell: false });
    const successorRecord = createEmptyProtocolRecord({
      workstreamId: 'ws_ffts_successor',
      baseCommit: baseline,
      branchName: 'successor',
      headCommit: baseline,
      rehomeProvenance: declaredRehome(baseline, 'successor', blocked, `${repoRoot}#main`, {
        sourcePatchSha256: sourceEvidence.patch,
        sourceProductTreeFingerprint: sourceEvidence.fingerprint,
        sourceReleaseContext: `${repoRoot}#source`,
        sourceHeadCommit: sourceHead,
        sourceBaselineCommit: baseline,
        sourceReviewWorkstreamId: 'ws_ffts_source',
      }),
    });
    writeProtocolRecord(repoRoot, successorRecord);
    const sameHeadBind = applyProtocolTransition({
      repoRoot,
      command: 'rehome-bind',
      workstreamId: 'ws_ffts_successor',
      predecessorRootWorkstreamId: 'ws_ffts_pred_root',
      predecessorDescendantWorkstreamId: 'ws_ffts_pred_leaf',
      predecessorHeadCommit: blocked,
      predecessorReleaseContext: `${repoRoot}#main`,
      successorBaselineCommit: baseline,
      successorBranchName: 'successor',
      sourcePatchSha256: sourceEvidence.patch,
      sourceProductTreeFingerprint: sourceEvidence.fingerprint,
      sourceReleaseContext: `${repoRoot}#source`,
      sourceHeadCommit: sourceHead,
      sourceBaselineCommit: baseline,
      sourceReviewWorkstreamId: 'ws_ffts_source',
    });
    expect(sameHeadBind.ok, sameHeadBind.message).toBe(true);
    expect(sameHeadBind.message).not.toMatch(/error/i);
    const bound = readProtocolRecord(repoRoot, 'ws_ffts_successor');
    expect(bound?.rehomeProvenance?.status).toBe('bound');
    expect(bound?.rehomeProvenance?.predecessorRootWorkstreamId).toBe('ws_ffts_pred_root');
    expect(bound?.rehomeProvenance?.predecessorDescendantWorkstreamId).toBe(
      'ws_ffts_pred_leaf'
    );
    expect(bound?.rehomeProvenance?.predecessorPassedReview).toBe(false);
    expect(bound?.sourceWorkstreamIds).toBeUndefined();
    expect(bound?.failedPremiumReviewCount).toBe(0);

    const audit: WorkflowProtocolRecord = {
      ...readProtocolRecord(repoRoot, 'ws_ffts_pred')!,
    };
    audit.reviewAttempts = [
      ...audit.reviewAttempts,
      {
        pass: 'first',
        token: 'rev_first_illegal_3',
        startedAt: '2026-09-01T22:58:52.837Z',
        result: 'failed',
      },
      {
        pass: 'first',
        token: 'rev_first_illegal_4',
        startedAt: '2026-09-01T23:26:20.747Z',
        result: 'failed',
      },
    ];
    expect(audit.reviewAttempts.length).toBeGreaterThanOrEqual(4);
    expect(
      audit.reviewAttempts.every((attempt) => !isApprovalValidReviewEvidence(attempt, audit))
    ).toBe(true);
    expect(audit.reviewAttempts.some((attempt) => attempt.token.includes('illegal'))).toBe(true);
  });

  it('keeps generated V2.4 wording and rejects the V2.3 third-review phrase', () => {
    const contract = createDefaultPlanContract({
      taskId: 'task-v24-wording',
      taskType: 'change',
      risk: 'high',
      rationale: 'test',
      fallbackEscalation: 'escalate',
      requiredTests: [{ id: 'T-V24-WORDING', status: 'unresolved' }],
      independentReviewReasons: ['workflow-protocol-persistence'],
    });
    const boundary = contract.implementationContract?.boundaries?.join('\n') ?? '';
    expect(boundary).toContain(
      'Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.'
    );
    expect(boundary).not.toContain('Do not launch a third premium review without routing or split.');
  });

  it('FD-GIT / FD-REHOME / FD-LINEAGE / FD-VERIFY first-review blocker family', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('first-fix');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    initWorkstream(repoRoot, 'ws_ffts_fix', baseline);
    failFirstThenClosure(repoRoot, 'ws_ffts_fix');

    const emptyRehome = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_ffts_fix',
      disposition: 'rehomed',
      reason: 'empty implementation list',
      predecessorHead: impl,
      successorRepo: repoRoot,
      successorBranch: 'main',
      successorBaseline: baseline,
    });
    expect(emptyRehome.ok).toBe(false);

    const ancestryOnlyRevert = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_ffts_fix',
      disposition: 'reverted',
      reason: 'unrelated later commit is not a revert',
      implementationCommits: [impl],
      revertCommit: impl,
    });
    expect(ancestryOnlyRevert.ok).toBe(false);

    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'revert', '--no-edit', impl],
      { cwd: repoRoot, shell: false }
    );
    const revertSha = git(repoRoot, ['rev-parse', 'HEAD']);
    const reverted = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_ffts_fix',
      disposition: 'reverted',
      reason: 'git revert inverts the failed implementation',
      implementationCommits: [impl],
      revertCommit: revertSha,
    });
    expect(reverted.ok, reverted.message).toBe(true);
    const routed = readProtocolRecord(repoRoot, 'ws_ffts_fix')!;
    expect(routed.routeDisposition?.gitEvidence.evidenceHash).toBeTruthy();
    routed.routeDisposition = {
      ...routed.routeDisposition!,
      gitEvidence: {
        ...routed.routeDisposition!.gitEvidence,
        evidenceHash: '0'.repeat(64),
      },
    };
    writeProtocolRecord(repoRoot, routed);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);

    const inheritRoot = makeTempRoot('inherit-max');
    const inheritBase = initGitRepo(inheritRoot);
    initWorkstream(inheritRoot, 'ws_ffts_inherited_parent', inheritBase);
    const parent = readProtocolRecord(inheritRoot, 'ws_ffts_inherited_parent')!;
    parent.phase = 'routing_required';
    parent.failedPremiumReviewCount = 0;
    parent.inheritedFailedReviewCount = 2;
    writeProtocolRecord(inheritRoot, parent);
    const inheritedSplit = applyProtocolTransition({
      repoRoot: inheritRoot,
      command: 'split',
      workstreamId: 'ws_ffts_inherited_parent',
      newWorkstreamId: 'ws_ffts_inherited_child',
    });
    expect(inheritedSplit.ok).toBe(true);
    const inheritedChild = readProtocolRecord(inheritRoot, 'ws_ffts_inherited_child');
    expect(inheritedChild?.failedPremiumReviewCount).toBe(2);
    expect(inheritedChild?.inheritedFailedReviewCount).toBe(2);
    expect(inheritedChild?.phase).toBe('routing_required');

    const missingSource = applyProtocolTransition({
      repoRoot: inheritRoot,
      command: 'init',
      workstreamId: 'ws_ffts_mint',
      baseCommit: inheritBase,
      sourceWorkstreamIds: ['ws_does_not_exist'],
    });
    expect(missingSource.ok).toBe(false);

    const verifyRoot = makeTempRoot('verify-plan');
    const verifyBase = initGitRepo(verifyRoot);
    initWorkstream(verifyRoot, 'ws_ffts_verify', verifyBase);
    const planDir = path.join(
      verifyRoot,
      'docs_private',
      'automation',
      'workstreams',
      'ws_ffts_verify'
    );
    mkdirSync(planDir, { recursive: true });
    const contract = createDefaultPlanContract({
      workstreamId: 'ws_ffts_verify',
      taskId: 'task-v24-verify',
      taskType: 'change',
      risk: 'high',
      rationale: 'plan-bound preflight',
      fallbackEscalation: 'escalate',
      requiredTests: [{ id: 'TEE-V24-BUDGET-001', status: 'completed' }],
      independentReviewReasons: ['workflow-protocol-persistence'],
    });
    writeFileSync(
      path.join(planDir, 'plan.md'),
      `# Plan\n\n${renderPlanContractMarker(contract)}\n`,
      'utf8'
    );
    const verifyRecord = readProtocolRecord(verifyRoot, 'ws_ffts_verify')!;
    verifyRecord.planPath = path.join(planDir, 'plan.md');
    writeProtocolRecord(verifyRoot, verifyRecord);
    const verifyManifest = writePassingManifest(verifyRoot, 'ws_ffts_verify', 'preflight', undefined, []);
    const verifyPreflight = applyProtocolTransition({
      repoRoot: verifyRoot,
      command: 'preflight-record',
      workstreamId: 'ws_ffts_verify',
      manifestPath: verifyManifest,
    });
    expect(verifyPreflight.ok).toBe(false);
  });

  it('T-FD-GIT-003-BINDS-COMMITS / T-FD-GIT-003-CHANGE-COMMIT / T-FD-GIT-003-ADD-COMMIT / T-FD-GIT-003-REMOVE-COMMIT / T-FD-GIT-003-REORDER-COMMITS / T-FD-GIT-003-OMIT-LIST / T-FD-GIT-003-NONOBJECT-COMMIT / T-FD-GIT-003-OMIT-RANGE / T-FD-GIT-003-DUPLICATE-COMMITS / T-FD-GIT-003-FRESH-HASH-TAMPER', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('fd-git-003');
    const baseline = initGitRepo(repoRoot);
    const first = commitFile(repoRoot, 'one.ts', 'one');
    const second = commitFile(repoRoot, 'two.ts', 'two');
    initWorkstream(repoRoot, 'ws_fd_git', baseline);
    failFirstThenClosure(repoRoot, 'ws_fd_git');
    spawnSync('git', ['checkout', '-b', 'successor', baseline], { cwd: repoRoot, shell: false });

    const nonObject = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_git',
      disposition: 'rehomed',
      reason: 'non-object commit',
      implementationCommits: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      predecessorHeadCommit: second,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(nonObject.ok).toBe(false);
    expect(nonObject.message).toMatch(/not a git commit object/i);

    const omitted = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_git',
      disposition: 'rehomed',
      reason: 'omit list',
      predecessorHeadCommit: second,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(omitted.ok).toBe(false);

    const omittedRange = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_git',
      disposition: 'rehomed',
      reason: 'omit range',
      implementationCommits: [first],
      predecessorHeadCommit: second,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(omittedRange.ok).toBe(false);
    expect(omittedRange.message).toMatch(/git-derived/i);

    const reorderedCreate = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_git',
      disposition: 'rehomed',
      reason: 'reorder range',
      implementationCommits: [second, first],
      predecessorHeadCommit: second,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(reorderedCreate.ok).toBe(false);
    expect(reorderedCreate.message).toMatch(/git-derived/i);

    const duplicated = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_git',
      disposition: 'rehomed',
      reason: 'duplicate commits',
      implementationCommits: [first, second, first],
      predecessorHeadCommit: second,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(duplicated.ok).toBe(false);
    expect(duplicated.message).toMatch(/duplicate|git-derived/i);

    const routed = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_git',
      disposition: 'rehomed',
      reason: 'isolate remaining work',
      implementationCommits: [first, second],
      predecessorHeadCommit: second,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(routed.ok).toBe(true);
    const original = readProtocolRecord(repoRoot, 'ws_fd_git')!;
    expect(original.routeDisposition?.gitEvidence.canonVersion).toBe(REHOME_EVIDENCE_CANON_VERSION);
    expect(original.routeDisposition?.gitEvidence.implementationCommits).toEqual([first, second]);
    expect(original.routeDisposition?.gitEvidence.latestLegalReviewCandidateHead).toBe(second);
    expect(revalidateRouteDisposition({ repoRoot, record: original }).ok).toBe(true);

    const tamper = (mutator: (commits: string[]) => string[] | undefined) => {
      const record = readProtocolRecord(repoRoot, 'ws_fd_git')!;
      const next = {
        ...record,
        routeDisposition: {
          ...record.routeDisposition!,
          gitEvidence: {
            ...record.routeDisposition!.gitEvidence,
            implementationCommits: mutator([
              ...(record.routeDisposition!.gitEvidence.implementationCommits ?? []),
            ]) as string[],
          },
        },
      };
      writeProtocolRecord(repoRoot, next);
      return revalidateRouteDisposition({ repoRoot, record: next });
    };

    expect(tamper((commits) => [second, commits[1]!]).ok).toBe(false);
    writeProtocolRecord(repoRoot, original);
    expect(tamper((commits) => [...commits, baseline]).ok).toBe(false);
    writeProtocolRecord(repoRoot, original);
    expect(tamper((commits) => commits.slice(0, 1)).ok).toBe(false);
    writeProtocolRecord(repoRoot, original);
    expect(tamper((commits) => [...commits].reverse()).ok).toBe(false);
    writeProtocolRecord(repoRoot, original);
    const omittedStored = readProtocolRecord(repoRoot, 'ws_fd_git')!;
    omittedStored.routeDisposition = {
      ...omittedStored.routeDisposition!,
      gitEvidence: {
        ...omittedStored.routeDisposition!.gitEvidence,
        implementationCommits: [],
      },
    };
    writeProtocolRecord(repoRoot, omittedStored);
    expect(revalidateRouteDisposition({ repoRoot, record: omittedStored }).ok).toBe(false);
    expect(revalidateRouteDisposition({ repoRoot, record: omittedStored }).message).toMatch(
      /omits implementation commit|incomplete|not match/i
    );

    writeProtocolRecord(repoRoot, original);
    const freshHashTamper = readProtocolRecord(repoRoot, 'ws_fd_git')!;
    const gitEvidence = freshHashTamper.routeDisposition!.gitEvidence;
    const omittedFresh = [first];
    freshHashTamper.routeDisposition = {
      ...freshHashTamper.routeDisposition!,
      gitEvidence: {
        ...gitEvidence,
        implementationCommits: omittedFresh,
        evidenceHash: computeRouteEvidenceHash({
          target: 'rehomed',
          baseline: gitEvidence.baselineCommit,
          releaseHead: gitEvidence.releaseHeadCommit,
          implementationCommits: omittedFresh,
          latestLegalReviewCandidateHead: gitEvidence.latestLegalReviewCandidateHead,
          successorRepo: gitEvidence.successorRepoCanonicalPath,
          successorBranch: gitEvidence.successorBranch,
          successorBaseline: gitEvidence.successorBaseline,
          predecessorHead: gitEvidence.predecessorHead,
        }),
      },
    };
    writeProtocolRecord(repoRoot, freshHashTamper);
    const freshResult = revalidateRouteDisposition({ repoRoot, record: freshHashTamper });
    expect(freshResult.ok).toBe(false);
    expect(freshResult.message).toMatch(/git-derived|no longer holds|not match/i);
  });
});

