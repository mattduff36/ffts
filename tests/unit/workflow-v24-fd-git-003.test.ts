import { rmSync, writeFileSync } from 'fs';
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
import {
  computeGitProductTreeFingerprint,
  computeRouteEvidenceHash,
  computeWorkingTreeProductFingerprint,
  hashCanonicalEvidence,
  listOrderedImplementationCommits,
  REHOME_EVIDENCE_CANON_VERSION,
  resolveLatestLegalReviewCandidateHead,
  revalidateBoundRehomeProvenance,
  revalidateRouteDisposition,
} from '@/scripts/automation/workflow-v24-disposition';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  declaredRehome,
  exhaustSourceWorkstream,
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

describe('TEE V2.4 FD-GIT-003 closure-head and FD-REHOME-001', { timeout: 90_000 }, () => {
  it('TEE-V24-CANDIDATE-001 / T-FD-GIT-003-CLOSURE-HEAD / T-FD-GIT-003-CANDIDATE-RANGE / T-FD-GIT-003-SUCCESS-HEAD-UNCHANGED / T-FD-GIT-003-FAILED-FIRST-NO-CLOSURE / T-FD-GIT-003-ILLEGAL-POST-BUDGET / T-FD-GIT-003-HEAD-DRIFT / T-FD-GIT-003-TAMPER-CANDIDATE / T-FD-GIT-003-SUBSTITUTE-B', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('fd-git-003-closure');
    const baseline = initGitRepo(repoRoot);
    const firstImpl = commitFile(repoRoot, 'one.ts', 'one');
    initWorkstream(repoRoot, 'ws_fd_closure', baseline);
    expect(readProtocolRecord(repoRoot, 'ws_fd_closure')?.headCommit).toBe(firstImpl);

    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId: 'ws_fd_closure',
        manifestPath: writePassingManifest(repoRoot, 'ws_fd_closure', 'preflight'),
      }).ok
    ).toBe(true);
    const firstStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_fd_closure',
      pass: 'first',
    });
    expect(firstStart.ok).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-record',
        workstreamId: 'ws_fd_closure',
        token: firstStart.reviewToken!,
        result: 'failed',
        blockerFamilies: ['auth'],
        blockerIds: ['A'],
        siblingSurfaces: ['B'],
      }).ok
    ).toBe(true);

    const closureHead = commitFile(repoRoot, 'two.ts', 'two');
    const beforeClosure = readProtocolRecord(repoRoot, 'ws_fd_closure')!;
    const beforeClosureCandidate = resolveLatestLegalReviewCandidateHead(repoRoot, beforeClosure);
    expect(beforeClosureCandidate.ok).toBe(true);
    if (beforeClosureCandidate.ok) {
      expect(beforeClosureCandidate.headCommit).toBe(firstImpl);
      expect(beforeClosureCandidate.headCommit).not.toBe(closureHead);
    }
    expect(beforeClosure.headCommit).toBe(firstImpl);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'route',
        workstreamId: 'ws_fd_closure',
        disposition: 'rehomed',
        reason: 'too early',
        implementationCommits: [firstImpl, closureHead],
        predecessorHeadCommit: firstImpl,
        successorRepo: repoRoot,
        successorBranch: 'main',
        successorBaseline: baseline,
      }).ok
    ).toBe(false);

    const fixPath = writePassingManifest(repoRoot, 'ws_fd_closure', 'fix-delta', ['A']);
    const fixRecorded = applyProtocolTransition({
      repoRoot,
      command: 'fix-record',
      workstreamId: 'ws_fd_closure',
      manifestPath: fixPath,
      closedBlockerIds: ['A'],
    });
    expect(fixRecorded.ok, fixRecorded.message).toBe(true);
    const closureStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_fd_closure',
      pass: 'closure',
    });
    expect(closureStart.ok).toBe(true);
    const secondFail = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId: 'ws_fd_closure',
      token: closureStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth'],
      blockerIds: ['C'],
      siblingSurfaces: ['D'],
    });
    expect(secondFail.ok).toBe(false);
    expect(secondFail.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);

    const exhausted = readProtocolRecord(repoRoot, 'ws_fd_closure')!;
    expect(exhausted.headCommit).toBe(firstImpl);
    expect(exhausted.headCommit).not.toBe(closureHead);
    const candidate = resolveLatestLegalReviewCandidateHead(repoRoot, exhausted);
    expect(candidate.ok).toBe(true);
    if (candidate.ok) {
      expect(candidate.headCommit).toBe(closureHead);
      expect(candidate.pass).toBe('closure');
    }
    const derived = listOrderedImplementationCommits(repoRoot, baseline, closureHead);
    expect(derived).toEqual([firstImpl, closureHead]);

    const illegal = readProtocolRecord(repoRoot, 'ws_fd_closure')!;
    illegal.reviewAttempts = [
      ...illegal.reviewAttempts,
      {
        pass: 'first',
        token: 'rev_first_illegal_post_budget',
        startedAt: '2026-09-02T12:00:00.000Z',
        recordedAt: '2026-09-02T12:00:01.000Z',
        headCommit: firstImpl,
        result: 'failed',
        blockerFamilies: ['protocol-integrity'],
        blockerIds: ['ILLEGAL-POST-BUDGET'],
        siblingSurfaces: ['candidate-head'],
      },
    ];
    writeProtocolRecord(repoRoot, illegal);
    const illegalCandidate = resolveLatestLegalReviewCandidateHead(repoRoot, illegal);
    expect(illegalCandidate.ok).toBe(true);
    if (illegalCandidate.ok) {
      expect(illegalCandidate.headCommit).toBe(closureHead);
    }

    const drifted = commitFile(repoRoot, 'three.ts', 'unreviewed-after-closure');
    const driftRoute = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_closure',
      disposition: 'rehomed',
      reason: 'head drifted after last legal review',
      implementationCommits: [firstImpl, closureHead],
      predecessorHeadCommit: closureHead,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(driftRoute.ok).toBe(false);
    expect(driftRoute.message).toMatch(/unreviewed implementation|enlarge/i);
    const removeWhileDrifted = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_closure',
      disposition: 'removed_from_release',
      reason: 'drift must not be swallowed as a git-list error',
      implementationCommits: [firstImpl, closureHead],
    });
    expect(removeWhileDrifted.ok).toBe(false);
    expect(removeWhileDrifted.message).not.toMatch(/enlarge/i);
    expect(removeWhileDrifted.message).toMatch(/still present|implementation/i);
    expect(drifted).toMatch(/^[0-9a-f]+$/i);
    spawnSync('git', ['reset', '--hard', closureHead], { cwd: repoRoot, shell: false });

    spawnSync('git', ['checkout', '-b', 'successor', baseline], { cwd: repoRoot, shell: false });

    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'route',
        workstreamId: 'ws_fd_closure',
        disposition: 'rehomed',
        reason: 'substitute first-review HEAD',
        implementationCommits: [firstImpl],
        predecessorHeadCommit: closureHead,
        successorRepo: repoRoot,
        successorBranch: 'successor',
        successorBaseline: baseline,
      }).ok
    ).toBe(false);

    const routed = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fd_closure',
      disposition: 'rehomed',
      reason: 'isolate remaining work including closure fix',
      implementationCommits: [firstImpl, closureHead],
      predecessorHeadCommit: closureHead,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(routed.ok).toBe(true);
    const original = readProtocolRecord(repoRoot, 'ws_fd_closure')!;
    expect(original.headCommit).toBe(firstImpl);
    expect(original.routeDisposition?.gitEvidence.latestLegalReviewCandidateHead).toBe(closureHead);
    expect(original.routeDisposition?.gitEvidence.implementationCommits).toEqual([
      firstImpl,
      closureHead,
    ]);
    expect(revalidateRouteDisposition({ repoRoot, record: original }).ok).toBe(true);

    const tamperedCandidate = {
      ...original,
      routeDisposition: {
        ...original.routeDisposition!,
        gitEvidence: {
          ...original.routeDisposition!.gitEvidence,
          latestLegalReviewCandidateHead: firstImpl,
          evidenceHash: computeRouteEvidenceHash({
            target: 'rehomed',
            baseline: original.routeDisposition!.gitEvidence.baselineCommit,
            releaseHead: original.routeDisposition!.gitEvidence.releaseHeadCommit,
            implementationCommits: original.routeDisposition!.gitEvidence.implementationCommits,
            latestLegalReviewCandidateHead: firstImpl,
            successorRepo: original.routeDisposition!.gitEvidence.successorRepoCanonicalPath,
            successorBranch: original.routeDisposition!.gitEvidence.successorBranch,
            successorBaseline: original.routeDisposition!.gitEvidence.successorBaseline,
            predecessorHead: original.routeDisposition!.gitEvidence.predecessorHead,
          }),
        },
      },
    };
    writeProtocolRecord(repoRoot, tamperedCandidate);
    expect(revalidateRouteDisposition({ repoRoot, record: tamperedCandidate }).ok).toBe(false);
  });

  it('T-FD-GIT-003-PASSING-CLOSURE', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('fd-git-003-pass');
    const baseline = initGitRepo(repoRoot);
    const firstImpl = commitFile(repoRoot, 'one.ts', 'one');
    initWorkstream(repoRoot, 'ws_fd_pass', baseline);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId: 'ws_fd_pass',
        manifestPath: writePassingManifest(repoRoot, 'ws_fd_pass', 'preflight'),
      }).ok
    ).toBe(true);
    const firstStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_fd_pass',
      pass: 'first',
    });
    expect(firstStart.ok).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-record',
        workstreamId: 'ws_fd_pass',
        token: firstStart.reviewToken!,
        result: 'failed',
        blockerFamilies: ['auth'],
        blockerIds: ['A'],
        siblingSurfaces: ['B'],
      }).ok
    ).toBe(true);
    const closureHead = commitFile(repoRoot, 'two.ts', 'two');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'fix-record',
        workstreamId: 'ws_fd_pass',
        manifestPath: writePassingManifest(repoRoot, 'ws_fd_pass', 'fix-delta', ['A']),
        closedBlockerIds: ['A'],
      }).ok
    ).toBe(true);
    const closureStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_fd_pass',
      pass: 'closure',
    });
    expect(closureStart.ok).toBe(true);
    const passed = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId: 'ws_fd_pass',
      token: closureStart.reviewToken!,
      result: 'passed',
    });
    expect(passed.ok).toBe(true);
    const closed = readProtocolRecord(repoRoot, 'ws_fd_pass')!;
    expect(closed.phase).toBe('review_closed');
    expect(closed.headCommit).toBe(closureHead);
    expect(closed.headCommit).not.toBe(firstImpl);
    expect(closed.reviewedTreeFingerprint).toBeTruthy();
  });

  it('T-FD-REHOME-001-LARGE-BLOB-FINGERPRINT', () => {
    const repoRoot = makeTempRoot('fd-large-blob');
    initGitRepo(repoRoot);
    const blobPath = path.join(repoRoot, 'large.bin');
    writeFileSync(blobPath, Buffer.alloc(1_500_000, 0x5a));
    spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'], {
      cwd: repoRoot,
      shell: false,
    });
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'large-blob'],
      { cwd: repoRoot, shell: false }
    );
    const head = git(repoRoot, ['rev-parse', 'HEAD']);
    const gitFingerprint = computeGitProductTreeFingerprint(repoRoot, head);
    const workingFingerprint = computeWorkingTreeProductFingerprint(repoRoot);
    expect(gitFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(workingFingerprint).toBe(gitFingerprint);
  });

  it('T-FD-REHOME-001-MISSING-BRANCH / T-FD-REHOME-001-WRONG-HEAD / T-FD-REHOME-001-FAKE-SOURCE-HASH / T-FD-REHOME-001-TAMPER-FINGERPRINT / T-FD-REHOME-001-WRONG-COMMITS / T-FD-REHOME-001-PRED-ANCESTOR / T-FD-REHOME-001-ISOLATED-PASSES / T-FD-REHOME-001-MISSING-SOURCE-BASELINE / T-FD-REHOME-001-SUCCESSOR-CONTENT-MISMATCH / T-FD-REHOME-001-SOURCE-PATH-DISAPPEARS / T-FD-GIT-003-SOURCE-LINEAGE', { timeout: 60_000 }, () => {
    const predRoot = makeTempRoot('fd-rehome-pred');
    const predBaseline = initGitRepo(predRoot);
    const predHead = commitFile(predRoot, 'blocked.ts', 'blocked');
    const predStub = createEmptyProtocolRecord({
      workstreamId: 'ws_ffts_pred_leaf',
      baseCommit: predBaseline,
      branchName: 'main',
      headCommit: predHead,
    });
    predStub.failedPremiumReviewCount = 2;
    predStub.inheritedFailedReviewCount = 2;
    predStub.phase = 'routing_required';
    writeProtocolRecord(predRoot, predStub);

    const sourceRoot = makeTempRoot('fd-rehome-source');
    const sourceBaseline = initGitRepo(sourceRoot);
    spawnSync('git', ['checkout', '-b', 'source'], { cwd: sourceRoot, shell: false });
    const sourceFirstHead = commitFile(sourceRoot, 'source.ts', 'source impl');
    exhaustSourceWorkstream(sourceRoot, 'ws_fd_rehome_source', sourceBaseline);
    const sourceHead = git(sourceRoot, ['rev-parse', 'HEAD']);
    expect(sourceHead).not.toBe(sourceFirstHead);
    const sourceEvidence = gitSourceEvidence(sourceRoot, sourceBaseline, sourceHead);

    const successorRoot = makeTempRoot('fd-rehome-successor');
    const successorBaseline = initGitRepo(successorRoot);
    spawnSync('git', ['checkout', '-b', 'successor'], { cwd: successorRoot, shell: false });
    writeFileSync(path.join(successorRoot, 'source.ts'), 'source impl\n', 'utf8');
    writeFileSync(
      path.join(successorRoot, 'ws_fd_rehome_source_closure_fix.ts'),
      'closure-fix\n',
      'utf8'
    );
    spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'], {
      cwd: successorRoot,
      shell: false,
    });

    const bind = (overrides: Record<string, string> = {}) => {
      const predecessorHeadCommit = overrides.predecessorHeadCommit ?? predHead;
      const predecessorReleaseContext = overrides.predecessorReleaseContext ?? `${predRoot}#main`;
      const sourcePatchSha256 = overrides.sourcePatchSha256 ?? sourceEvidence.patch;
      const sourceProductTreeFingerprint =
        overrides.sourceProductTreeFingerprint ?? sourceEvidence.fingerprint;
      const sourceReleaseContext = overrides.sourceReleaseContext ?? `${sourceRoot}#source`;
      const sourceHeadCommit = overrides.sourceHeadCommit ?? sourceHead;
      const sourceBaselineCommit = overrides.sourceBaselineCommit ?? sourceBaseline;
      const sourceReviewWorkstreamId =
        overrides.sourceReviewWorkstreamId === undefined
          ? 'ws_fd_rehome_source'
          : overrides.sourceReviewWorkstreamId;
      const record = createEmptyProtocolRecord({
        workstreamId: 'ws_fd_rehome',
        baseCommit: successorBaseline,
        branchName: 'successor',
        headCommit: successorBaseline,
        rehomeProvenance: declaredRehome(
          successorBaseline,
          'successor',
          predecessorHeadCommit,
          predecessorReleaseContext,
          {
            sourcePatchSha256,
            sourceProductTreeFingerprint,
            sourceReleaseContext,
            sourceHeadCommit,
            sourceBaselineCommit,
            ...(sourceReviewWorkstreamId
              ? { sourceReviewWorkstreamId }
              : {}),
          }
        ),
      });
      writeProtocolRecord(successorRoot, record);
      return applyProtocolTransition({
        repoRoot: successorRoot,
        command: 'rehome-bind',
        workstreamId: 'ws_fd_rehome',
        predecessorRootWorkstreamId: 'ws_ffts_pred_root',
        predecessorDescendantWorkstreamId: 'ws_ffts_pred_leaf',
        predecessorHeadCommit,
        predecessorReleaseContext,
        successorBaselineCommit: successorBaseline,
        successorBranchName: 'successor',
        sourcePatchSha256,
        sourceProductTreeFingerprint,
        sourceReleaseContext,
        sourceHeadCommit,
        sourceBaselineCommit,
        sourceReviewWorkstreamId: sourceReviewWorkstreamId || undefined,
      });
    };

    const missingBranch = bind({ predecessorReleaseContext: `${predRoot}#does-not-exist` });
    expect(missingBranch.ok).toBe(false);
    expect(missingBranch.message).toMatch(/does not exist/i);

    const wrongHead = bind({ predecessorHeadCommit: sourceBaseline });
    expect(wrongHead.ok).toBe(false);

    const fakeHash = bind({ sourcePatchSha256: 'ab'.repeat(32) });
    expect(fakeHash.ok).toBe(false);
    expect(fakeHash.message).toMatch(/patch hash/i);

    const tamperedFingerprint = bind({ sourceProductTreeFingerprint: 'cd'.repeat(32) });
    expect(tamperedFingerprint.ok).toBe(false);
    expect(tamperedFingerprint.message).toMatch(/fingerprint/i);

    const missingBaseline = bind({
      sourceBaselineCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(missingBaseline.ok).toBe(false);
    expect(missingBaseline.message).toMatch(/source baseline/i);

    const contentMismatchRoot = makeTempRoot('fd-rehome-mismatch');
    const mismatchBaseline = initGitRepo(contentMismatchRoot);
    spawnSync('git', ['checkout', '-b', 'successor'], { cwd: contentMismatchRoot, shell: false });
    writeFileSync(path.join(contentMismatchRoot, 'other.ts'), 'not the source\n', 'utf8');
    const mismatchRecord = createEmptyProtocolRecord({
      workstreamId: 'ws_fd_mismatch',
      baseCommit: mismatchBaseline,
      branchName: 'successor',
      headCommit: mismatchBaseline,
      rehomeProvenance: declaredRehome(
        mismatchBaseline,
        'successor',
        predHead,
        `${predRoot}#main`,
        {
          sourcePatchSha256: sourceEvidence.patch,
          sourceProductTreeFingerprint: sourceEvidence.fingerprint,
          sourceReleaseContext: `${sourceRoot}#source`,
          sourceHeadCommit: sourceHead,
          sourceBaselineCommit: sourceBaseline,
          sourceReviewWorkstreamId: 'ws_fd_rehome_source',
        }
      ),
    });
    writeProtocolRecord(contentMismatchRoot, mismatchRecord);
    const contentMismatch = applyProtocolTransition({
      repoRoot: contentMismatchRoot,
      command: 'rehome-bind',
      workstreamId: 'ws_fd_mismatch',
      predecessorRootWorkstreamId: 'ws_ffts_pred_root',
      predecessorDescendantWorkstreamId: 'ws_ffts_pred_leaf',
      predecessorHeadCommit: predHead,
      predecessorReleaseContext: `${predRoot}#main`,
      successorBaselineCommit: mismatchBaseline,
      successorBranchName: 'successor',
      sourcePatchSha256: sourceEvidence.patch,
      sourceProductTreeFingerprint: sourceEvidence.fingerprint,
      sourceReleaseContext: `${sourceRoot}#source`,
      sourceHeadCommit: sourceHead,
      sourceBaselineCommit: sourceBaseline,
      sourceReviewWorkstreamId: 'ws_fd_rehome_source',
    });
    expect(contentMismatch.ok).toBe(false);
    expect(contentMismatch.message).toMatch(/does not match source fingerprint/i);

    const ancestralRoot = makeTempRoot('fd-rehome-ancestor');
    const ancestralBaseline = initGitRepo(ancestralRoot);
    const ancestralHead = commitFile(ancestralRoot, 'blocked.ts', 'blocked');
    const ancestralStub = createEmptyProtocolRecord({
      workstreamId: 'ws_ffts_pred_leaf',
      baseCommit: ancestralBaseline,
      branchName: 'main',
      headCommit: ancestralHead,
    });
    ancestralStub.failedPremiumReviewCount = 2;
    ancestralStub.inheritedFailedReviewCount = 2;
    ancestralStub.phase = 'routing_required';
    writeProtocolRecord(ancestralRoot, ancestralStub);
    spawnSync('git', ['checkout', '-b', 'source', ancestralBaseline], {
      cwd: ancestralRoot,
      shell: false,
    });
    const ancestralSourceHead = commitFile(ancestralRoot, 'source.ts', 'source impl');
    const ancestralEvidence = gitSourceEvidence(ancestralRoot, ancestralBaseline, ancestralSourceHead);
    spawnSync('git', ['checkout', 'main'], { cwd: ancestralRoot, shell: false });
    const ancestralRecord = createEmptyProtocolRecord({
      workstreamId: 'ws_fd_ancestor',
      baseCommit: ancestralBaseline,
      branchName: 'main',
      headCommit: ancestralHead,
      rehomeProvenance: declaredRehome(
        ancestralBaseline,
        'main',
        ancestralHead,
        `${ancestralRoot}#main`,
        {
          sourcePatchSha256: ancestralEvidence.patch,
          sourceProductTreeFingerprint: ancestralEvidence.fingerprint,
          sourceReleaseContext: `${ancestralRoot}#source`,
          sourceHeadCommit: ancestralSourceHead,
          sourceBaselineCommit: ancestralBaseline,
          sourceReviewWorkstreamId: 'ws_fd_rehome_source',
        }
      ),
    });
    writeProtocolRecord(ancestralRoot, ancestralRecord);
    const ancestral = applyProtocolTransition({
      repoRoot: ancestralRoot,
      command: 'rehome-bind',
      workstreamId: 'ws_fd_ancestor',
      predecessorRootWorkstreamId: 'ws_ffts_pred_root',
      predecessorDescendantWorkstreamId: 'ws_ffts_pred_leaf',
      predecessorHeadCommit: ancestralHead,
      predecessorReleaseContext: `${ancestralRoot}#main`,
      successorBaselineCommit: ancestralBaseline,
      successorBranchName: 'main',
      sourcePatchSha256: ancestralEvidence.patch,
      sourceProductTreeFingerprint: ancestralEvidence.fingerprint,
      sourceReleaseContext: `${ancestralRoot}#source`,
      sourceHeadCommit: ancestralSourceHead,
      sourceBaselineCommit: ancestralBaseline,
      sourceReviewWorkstreamId: 'ws_fd_rehome_source',
    });
    expect(ancestral.ok).toBe(false);
    expect(ancestral.message).toMatch(/ancestor/i);

    const missingSourceId = bind({ sourceReviewWorkstreamId: '' });
    expect(missingSourceId.ok).toBe(false);
    expect(missingSourceId.message).toMatch(/sourceReviewWorkstreamId/i);

    writeProtocolRecord(
      successorRoot,
      createEmptyProtocolRecord({
        workstreamId: 'ws_fd_rehome',
        baseCommit: successorBaseline,
        branchName: 'successor',
        headCommit: successorBaseline,
        rehomeProvenance: declaredRehome(
          successorBaseline,
          'successor',
          predHead,
          `${predRoot}#main`,
          {
            sourcePatchSha256: sourceEvidence.patch,
            sourceProductTreeFingerprint: sourceEvidence.fingerprint,
            sourceReleaseContext: `${sourceRoot}#source`,
            sourceHeadCommit: sourceHead,
            sourceBaselineCommit: sourceBaseline,
            sourceReviewWorkstreamId: 'ws_fd_rehome_source',
          }
        ),
      })
    );
    const operatorNominatedId = applyProtocolTransition({
      repoRoot: successorRoot,
      command: 'rehome-bind',
      workstreamId: 'ws_fd_rehome',
      predecessorRootWorkstreamId: 'ws_ffts_pred_root',
      predecessorDescendantWorkstreamId: 'ws_ffts_pred_leaf',
      predecessorHeadCommit: predHead,
      predecessorReleaseContext: `${predRoot}#main`,
      successorBaselineCommit: successorBaseline,
      successorBranchName: 'successor',
      sourcePatchSha256: sourceEvidence.patch,
      sourceProductTreeFingerprint: sourceEvidence.fingerprint,
      sourceReleaseContext: `${sourceRoot}#source`,
      sourceHeadCommit: sourceHead,
      sourceBaselineCommit: sourceBaseline,
      sourceReviewWorkstreamId: 'ws_operator_nominated',
    });
    expect(operatorNominatedId.ok).toBe(false);
    expect(operatorNominatedId.message).toMatch(/does not match declared provenance/i);

    const declaredWithoutId = createEmptyProtocolRecord({
      workstreamId: 'ws_fd_rehome_undeclared',
      baseCommit: successorBaseline,
      branchName: 'successor',
      headCommit: successorBaseline,
      rehomeProvenance: declaredRehome(
        successorBaseline,
        'successor',
        predHead,
        `${predRoot}#main`,
        {
          sourcePatchSha256: sourceEvidence.patch,
          sourceProductTreeFingerprint: sourceEvidence.fingerprint,
          sourceReleaseContext: `${sourceRoot}#source`,
          sourceHeadCommit: sourceHead,
          sourceBaselineCommit: sourceBaseline,
        }
      ),
    });
    writeProtocolRecord(successorRoot, declaredWithoutId);
    const cliOnlySourceId = applyProtocolTransition({
      repoRoot: successorRoot,
      command: 'rehome-bind',
      workstreamId: 'ws_fd_rehome_undeclared',
      predecessorRootWorkstreamId: 'ws_ffts_pred_root',
      predecessorDescendantWorkstreamId: 'ws_ffts_pred_leaf',
      predecessorHeadCommit: predHead,
      predecessorReleaseContext: `${predRoot}#main`,
      successorBaselineCommit: successorBaseline,
      successorBranchName: 'successor',
      sourcePatchSha256: sourceEvidence.patch,
      sourceProductTreeFingerprint: sourceEvidence.fingerprint,
      sourceReleaseContext: `${sourceRoot}#source`,
      sourceHeadCommit: sourceHead,
      sourceBaselineCommit: sourceBaseline,
      sourceReviewWorkstreamId: 'ws_fd_rehome_source',
    });
    expect(cliOnlySourceId.ok).toBe(false);
    expect(cliOnlySourceId.message).toMatch(/plan-bound sourceReviewWorkstreamId/i);

    const missingSourceProtocol = bind({ sourceReviewWorkstreamId: 'ws_missing_source' });
    expect(missingSourceProtocol.ok).toBe(false);
    expect(missingSourceProtocol.message).toMatch(/missing or unreadable|source review protocol/i);

    const substituteSourceHead = bind({ sourceHeadCommit: sourceFirstHead });
    expect(substituteSourceHead.ok).toBe(false);
    expect(substituteSourceHead.message).toMatch(/latest legal review-attempt candidate|source HEAD/i);

    const isolated = bind();
    expect(isolated.ok).toBe(true);
    const bound = readProtocolRecord(successorRoot, 'ws_fd_rehome');
    expect(bound?.rehomeProvenance?.status).toBe('bound');
    expect(bound?.rehomeProvenance?.evidence?.canonVersion).toBe(REHOME_EVIDENCE_CANON_VERSION);
    expect(bound?.rehomeProvenance?.sourceImplementationCommits).toEqual(sourceEvidence.commits);
    expect(bound?.rehomeProvenance?.predecessorPassedReview).toBe(false);
    expect(revalidateBoundRehomeProvenance({ repoRoot: successorRoot, provenance: bound!.rehomeProvenance! }).ok).toBe(
      true
    );

    const wrongCommitRecord = {
      ...bound!,
      rehomeProvenance: {
        ...bound!.rehomeProvenance!,
        sourceImplementationCommits: [sourceBaseline],
        evidence: {
          ...bound!.rehomeProvenance!.evidence!,
          implementationCommits: [sourceBaseline],
        },
      },
    };
    expect(
      revalidateBoundRehomeProvenance({
        repoRoot: successorRoot,
        provenance: wrongCommitRecord.rehomeProvenance,
      }).ok
    ).toBe(false);

    const hashTamper = {
      ...bound!.rehomeProvenance!,
      evidence: {
        ...bound!.rehomeProvenance!.evidence!,
        evidenceHash: hashCanonicalEvidence({ tampered: true }),
      },
    };
    expect(
      revalidateBoundRehomeProvenance({ repoRoot: successorRoot, provenance: hashTamper }).ok
    ).toBe(false);

    rmSync(predRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
    const afterPathsGone = revalidateBoundRehomeProvenance({
      repoRoot: successorRoot,
      provenance: bound!.rehomeProvenance!,
    });
    expect(afterPathsGone.ok).toBe(true);
  });
});
