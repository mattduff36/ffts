import { mkdirSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
} from '@/scripts/automation/workflow-events';
import { resolveFinaliseWorkstreamMatches } from '@/scripts/automation/workflow-finalise-correlation';
import {
  importCommitObjectForIsolation,
  listOrderedImplementationCommits,
  resolveLatestLegalReviewCandidateHead,
  type GitCommandResult,
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
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(async () => {
  cleanupWorkflowV24Fixtures();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

describe('TEE V2.4 first-review blocker family', () => {
  it('FD-LINEAGE-INIT-001: re-init of initialized cannot mint a fresh first', () => {
    const repoRoot = makeTempRoot('reinit');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_reinit', base);
    const existing = readProtocolRecord(repoRoot, 'ws_reinit')!;
    existing.inheritedFailedReviewCount = 2;
    existing.failedPremiumReviewCount = 2;
    writeProtocolRecord(repoRoot, existing);

    const again = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_reinit',
      baseCommit: base,
    });
    expect(again.ok).toBe(true);
    const record = readProtocolRecord(repoRoot, 'ws_reinit')!;
    expect(record.inheritedFailedReviewCount).toBeGreaterThanOrEqual(2);
    expect(record.failedPremiumReviewCount).toBeGreaterThanOrEqual(2);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-start',
        workstreamId: 'ws_reinit',
        pass: 'first',
      }).ok
    ).toBe(false);
  });

  it('FD-LINEAGE-NESTED-002: nested split still has a supported route path', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('nested-route');
    const baseline = initGitRepo(repoRoot);
    commitFile(repoRoot, 'impl.ts', 'impl');
    initWorkstream(repoRoot, 'ws_nest_root', baseline);
    failFirstThenClosure(repoRoot, 'ws_nest_root');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'split',
        workstreamId: 'ws_nest_root',
        newWorkstreamId: 'ws_nest_mid',
      }).ok
    ).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'split',
        workstreamId: 'ws_nest_mid',
        newWorkstreamId: 'ws_nest_leaf',
      }).ok
    ).toBe(true);
    const leaf = readProtocolRecord(repoRoot, 'ws_nest_leaf')!;
    expect(leaf.sourceWorkstreamIds?.length).toBeGreaterThan(1);
    expect(leaf.phase).toBe('routing_required');
    const candidate = resolveLatestLegalReviewCandidateHead(repoRoot, leaf);
    expect(candidate.ok, candidate.ok ? '' : candidate.message).toBe(true);
  });

  it('FD-REHOME-CANDIDATE-001: predecessorHead must be latest legal candidate', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('rehome-candidate');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    initWorkstream(repoRoot, 'ws_cand', baseline);
    failFirstThenClosure(repoRoot, 'ws_cand');
    spawnSync('git', ['checkout', '-b', 'successor', baseline], { cwd: repoRoot, shell: false });
    const routed = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_cand',
      disposition: 'rehomed',
      reason: 'unrelated predecessor HEAD is not the legal candidate',
      implementationCommits: [impl],
      predecessorHead: baseline,
      successorRepo: repoRoot,
      successorBranch: 'successor',
      successorBaseline: baseline,
    });
    expect(routed.ok).toBe(false);
    expect(routed.message).toMatch(/latest legal review candidate/i);
  });

  it('FD-REHOME-CONTENT-002: committed successor still requires source fingerprint', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('rehome-content');
    const baseline = initGitRepo(repoRoot);
    const blocked = commitFile(repoRoot, 'blocked.ts', 'blocked');
    const predStub = createEmptyProtocolRecord({
      workstreamId: 'ws_ffts_pred_leaf',
      baseCommit: baseline,
      branchName: 'main',
      headCommit: blocked,
    });
    predStub.failedPremiumReviewCount = 2;
    predStub.inheritedFailedReviewCount = 2;
    predStub.phase = 'routing_required';
    writeProtocolRecord(repoRoot, predStub);

    spawnSync('git', ['branch', 'source', baseline], { cwd: repoRoot, shell: false });
    spawnSync('git', ['checkout', 'source'], { cwd: repoRoot, shell: false });
    commitFile(repoRoot, 'source.ts', 'source impl');
    exhaustSourceWorkstream(repoRoot, 'ws_ffts_source', baseline);
    const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
    const sourceEvidence = gitSourceEvidence(repoRoot, baseline, sourceHead);

    spawnSync('git', ['checkout', '-f', '-b', 'successor', baseline], { cwd: repoRoot, shell: false });
    commitFile(repoRoot, 'unrelated.ts', 'different content');
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
    const bind = applyProtocolTransition({
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
    expect(bind.ok).toBe(false);
    expect(bind.message).toMatch(/fingerprint/i);
  });

  it('FD-REHOME-REVERT-003: one revert can invert a multi-commit implementation', { timeout: 60_000 }, () => {
    const repoRoot = makeTempRoot('multi-revert');
    const baseline = initGitRepo(repoRoot);
    commitFile(repoRoot, 'one.ts', 'one');
    commitFile(repoRoot, 'two.ts', 'two');
    initWorkstream(repoRoot, 'ws_multi', baseline);
    failFirstThenClosure(repoRoot, 'ws_multi');
    const candidateHead = git(repoRoot, ['rev-parse', 'HEAD']);
    const implementationCommits = listOrderedImplementationCommits(
      repoRoot,
      baseline,
      candidateHead
    );
    expect(Array.isArray(implementationCommits)).toBe(true);
    expect((implementationCommits as string[]).length).toBeGreaterThan(1);
    const baselineTree = git(repoRoot, ['rev-parse', `${baseline}^{tree}`]);
    const parent = git(repoRoot, ['rev-parse', 'HEAD']);
    const revertSha = spawnSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit-tree',
        baselineTree,
        '-p',
        parent,
        '-m',
        'restore baseline tree',
      ],
      { cwd: repoRoot, encoding: 'utf8', shell: false }
    ).stdout.trim();
    spawnSync('git', ['merge', '--ff-only', revertSha], { cwd: repoRoot, shell: false });
    const reverted = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_multi',
      disposition: 'reverted',
      reason: 'single restore commit undoes the multi-commit implementation tree',
      implementationCommits: implementationCommits as string[],
      revertCommit: revertSha,
    });
    expect(reverted.ok, reverted.message).toBe(true);
  });

  it('TEE-V24-C9-MATCH-001: finish-time correlation validates branch and owned HEAD', () => {
    const repoRoot = makeTempRoot('c9-finish');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_c9';
    const ready = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    ready.phase = 'finalise_ready';
    ready.activeCheckpointId = 'ckpt_c9';
    writeProtocolRecord(repoRoot, ready);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    const baseState = {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { [workstreamId]: ready },
      activeFinaliseContext: {
        workstreamId,
        checkpointId: 'ckpt_c9',
        activatedAt: new Date().toISOString(),
      },
    };
    saveWorkflowReviewState(paths.statePath, baseState);
    const missingActivated = resolveFinaliseWorkstreamMatches({
      state: baseState,
      repoRoot,
      branchName: 'main',
      headCommit: head,
    });
    expect(missingActivated.correlation.matchedBy).toBe('none');

    const ownedState = {
      ...baseState,
      activeFinaliseContext: {
        ...baseState.activeFinaliseContext,
        activatedHeadCommit: head,
        activatedBranchName: 'main',
        ownedCommits: [head],
      },
    };
    const wrongBranch = resolveFinaliseWorkstreamMatches({
      state: ownedState,
      repoRoot,
      branchName: 'other',
      headCommit: head,
    });
    expect(wrongBranch.correlation.matchedBy).toBe('none');

    const matched = resolveFinaliseWorkstreamMatches({
      state: ownedState,
      repoRoot,
      branchName: 'main',
      headCommit: head,
    });
    expect(matched.correlation.matchedBy).toBe('explicit_context');
  });

  it('FD-GIT-D3-002: read-only revalidate does not fetch isolation refs', () => {
    const sha = 'a'.repeat(40);
    const calls: string[][] = [];
    const gitRunner = (repoRoot: string, args: string[]): GitCommandResult => {
      calls.push([repoRoot, ...args]);
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        if (repoRoot.includes('source')) {
          return { status: 0, stdout: `${sha}\n`, stderr: '' };
        }
        return { status: 128, stdout: '', stderr: 'missing' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const imported = importCommitObjectForIsolation({
      repoRoot: '/successor',
      sha,
      sourceRepoRoot: '/source',
      git: gitRunner,
      allowIsolationImport: false,
    });
    expect(imported.ok).toBe(false);
    expect(imported.ok ? '' : imported.message).toMatch(/read-only|refuses to fetch/i);
    expect(calls.some((args) => args.includes('fetch'))).toBe(false);
  });
});
