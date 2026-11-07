import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowProtocolRecord, WorkflowRehomeProvenance } from '@/scripts/automation/types';
import {
  auditWorkflowEvidence, getWorkflowRetirementPath, retireWorkflowEvidence,
  WORKFLOW_RETIREMENT_REF_PREFIX,
} from '@/scripts/automation/workflow-evidence-retirement';
import {
  evidenceGit, inspectWorkflowEvidencePins, pinWorkflowEvidence, WORKFLOW_EVIDENCE_REF_PREFIX,
} from '@/scripts/automation/workflow-git-evidence';
import {
  createEmptyWorkflowReviewState, getWorkflowPaths, saveWorkflowReviewState, writeJsonAtomic,
} from '@/scripts/automation/workflow-events';
import {
  createEmptyProtocolRecord, getProtocolRecordPath, writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import {
  computeGitPatchSha256, computeGitProductTreeFingerprint, computeRouteEvidenceHash,
  hashBoundRehomeSecurityObject, listOrderedImplementationCommits, REHOME_EVIDENCE_CANON_VERSION,
} from '@/scripts/automation/workflow-v24-disposition';
import {
  cleanupWorkflowV24Fixtures, initGitRepo, makeTempRoot,
} from './workflow-v24-test-harness';

afterEach(cleanupWorkflowV24Fixtures);

const stamp = '2026-01-01T00:00:00.000Z';

function commit(repoRoot: string, content: string, message: string): string {
  writeFileSync(path.join(repoRoot, 'feature.txt'), content);
  evidenceGit(repoRoot, ['add', 'feature.txt']);
  evidenceGit(repoRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'gc.auto=0',
    'commit', '--quiet', '-m', message]);
  return evidenceGit(repoRoot, ['rev-parse', 'HEAD']);
}

function pruneFixture(repoRoot: string): void {
  evidenceGit(repoRoot, ['reflog', 'expire', '--expire=now', '--all']);
  evidenceGit(repoRoot, ['gc', '--prune=now', '--quiet']);
}

function attempt(pass: 'first' | 'closure' | 'delta', sha: string, result: 'passed' | 'failed') {
  return {
    pass, token: `rev_${pass}_fixture`, startedAt: stamp, recordedAt: stamp,
    headCommit: sha, treeFingerprint: 'fixture-tree', result,
    blockerFamilies: result === 'failed' ? ['fixture'] : [],
    blockerIds: result === 'failed' ? ['OLD-BLOCKER'] : [],
  };
}

function failedRecord(id: string, base: string, candidate: string, branch: string): WorkflowProtocolRecord {
  return {
    ...createEmptyProtocolRecord({
      workstreamId: id, baseCommit: base, headCommit: base, branchName: branch,
      now: () => new Date(stamp),
    }),
    phase: 'rehomed', nextAction: 'non_release_disposition', failedPremiumReviewCount: 2,
    reviewAttempts: [attempt('first', candidate, 'failed'), attempt('closure', candidate, 'failed')],
    blockerFamilies: ['fixture'], openBlockerIds: ['OLD-BLOCKER'],
  };
}

function bindHop(
  repoRoot: string, predecessor: WorkflowProtocolRecord, next: WorkflowProtocolRecord,
  candidate: string, imported: string
): void {
  const implementation = listOrderedImplementationCommits(repoRoot, predecessor.baseCommit, candidate);
  const patch = computeGitPatchSha256(repoRoot, predecessor.baseCommit, candidate);
  const fingerprint = computeGitProductTreeFingerprint(repoRoot, candidate);
  if (!Array.isArray(implementation) || typeof patch !== 'string' || typeof fingerprint !== 'string') {
    throw new Error('fixture Git evidence failed');
  }
  const sourceContext = `${repoRoot}#${predecessor.branchName}`;
  const provenance: WorkflowRehomeProvenance = {
    schemaVersion: '1', status: 'bound', predecessorRootWorkstreamId: predecessor.workstreamId,
    predecessorDescendantWorkstreamId: predecessor.workstreamId,
    predecessorHeadCommit: candidate, predecessorReleaseContext: sourceContext,
    successorBranchName: next.branchName!, successorBaselineCommit: next.baseCommit,
    successorWorktreeCanonicalPath: repoRoot,
    sourcePatchSha256: patch, sourceProductTreeFingerprint: fingerprint,
    sourceReleaseContext: sourceContext, sourceHeadCommit: candidate,
    sourceBaselineCommit: predecessor.baseCommit, sourceReviewWorkstreamId: predecessor.workstreamId,
    sourceImplementationCommits: implementation, predecessorBranchResolvedSha: candidate,
    predecessorHeadIsAncestor: false, predecessorPassedReview: false, boundAt: stamp,
    evidence: {
      canonVersion: REHOME_EVIDENCE_CANON_VERSION, currentHead: imported,
      currentBranch: next.branchName!, successorBaseline: next.baseCommit,
      successorBranchName: next.branchName!, predecessorHead: candidate,
      predecessorBranchResolvedSha: candidate, predecessorRootWorkstreamId: predecessor.workstreamId,
      predecessorDescendantWorkstreamId: predecessor.workstreamId, sourceHeadCommit: candidate,
      sourceBaselineCommit: predecessor.baseCommit, sourceBranchName: predecessor.branchName!,
      sourceReleaseContext: sourceContext, sourceReviewWorkstreamId: predecessor.workstreamId,
      sourcePatchSha256: patch, sourceProductTreeFingerprint: fingerprint,
      implementationCommits: implementation, latestLegalReviewCandidateHead: candidate,
      mergeBaseCheck: 'predecessor_head_not_ancestor', isolationDecision: 'predecessor_head_not_ancestor',
      predecessorHeadIsAncestor: false, predecessorExhausted: true, evidenceHash: '',
    },
  };
  provenance.evidence!.evidenceHash = hashBoundRehomeSecurityObject(provenance);
  next.rehomeProvenance = provenance;
  predecessor.routeDisposition = {
    schemaVersion: '1', command: 'route', recordedAt: stamp, target: 'rehomed',
    reason: 'historical isolation; not passed',
    gitEvidence: {
      kind: 'isolated_successor', baselineCommit: predecessor.baseCommit,
      releaseHeadCommit: imported, implementationCommits: implementation,
      successorBranch: next.branchName!, successorBaseline: next.baseCommit,
      successorRepoCanonicalPath: repoRoot, predecessorHead: candidate,
      predecessorHeadIsAncestor: false, latestLegalReviewCandidateHead: candidate,
      canonVersion: REHOME_EVIDENCE_CANON_VERSION,
      evidenceHash: computeRouteEvidenceHash({
        target: 'rehomed', baseline: predecessor.baseCommit, releaseHead: imported,
        implementationCommits: implementation, latestLegalReviewCandidateHead: candidate,
        successorRepo: repoRoot, successorBranch: next.branchName!, successorBaseline: next.baseCommit,
        predecessorHead: candidate,
      }),
    },
  };
}

function fixture() {
  const repoRoot = makeTempRoot('audited-retirement');
  const base = initGitRepo(repoRoot);
  evidenceGit(repoRoot, ['checkout', '--quiet', '-b', 'source']);
  const missing = commit(repoRoot, 'original product\n', 'failed original');
  evidenceGit(repoRoot, ['checkout', '--quiet', '-b', 'successor-one', base]);
  const importedOne = commit(repoRoot, 'original product\n', 'isolated import one');
  const candidateOne = commit(repoRoot, 'refined product\n', 'failed successor');
  evidenceGit(repoRoot, ['checkout', '--quiet', '-b', 'successor-two', base]);
  const importedTwo = commit(repoRoot, 'refined product\n', 'isolated import two');
  const terminalHead = commit(repoRoot, 'fixed product\n', 'passed terminal');
  evidenceGit(repoRoot, ['checkout', '--quiet', 'main']);
  evidenceGit(repoRoot, ['merge', '--ff-only', '--quiet', 'successor-two']);
  const original = failedRecord('ws_original', base, missing, 'source');
  const middle = failedRecord('ws_middle', base, candidateOne, 'successor-one');
  const terminal: WorkflowProtocolRecord = {
    ...createEmptyProtocolRecord({
      workstreamId: 'ws_terminal', baseCommit: base, headCommit: terminalHead,
      branchName: 'successor-two', now: () => new Date(stamp),
    }),
    phase: 'finalised', nextAction: 'done', failedPremiumReviewCount: 1,
    reviewAttempts: [attempt('first', importedTwo, 'failed'), attempt('closure', terminalHead, 'passed'),
      attempt('delta', terminalHead, 'passed')],
    reviewedTreeFingerprint: 'fixture-tree',
  };
  bindHop(repoRoot, original, middle, missing, importedOne);
  bindHop(repoRoot, middle, terminal, candidateOne, importedTwo);
  evidenceGit(repoRoot, ['branch', '-D', 'source']);
  pruneFixture(repoRoot);
  const state = createEmptyWorkflowReviewState();
  state.protocolRecords = Object.fromEntries([original, middle, terminal].map((record) => [record.workstreamId, record]));
  state.workstreams = {
    ws_terminal: {
      workstreamId: 'ws_terminal', branchName: 'successor-two', headCommit: terminalHead,
      taskIds: [], eventIds: [], status: 'finalised', updatedAt: stamp,
      finaliseOutcome: 'passed', finaliseRunId: 'fixture-finalise', finaliseCommit: terminalHead,
    },
  };
  const persist = () => {
    for (const record of Object.values(state.protocolRecords!)) {
      writeJsonAtomic(getProtocolRecordPath(repoRoot, record.workstreamId), record);
    }
    writeJsonAtomic(getWorkflowPaths(repoRoot).statePath, state);
  };
  persist();
  const params = {
    repoRoot, workstreamId: original.workstreamId, missingCommit: missing,
    reason: 'Owner authorised obsolete missing-object dependency retirement',
    ownerAuthorisedRetirement: true, dryRun: false,
  };
  return { repoRoot, base, missing, importedOne, candidateOne, terminalHead, original, middle, terminal, state, params, persist };
}

function refs(repoRoot: string): string {
  return evidenceGit(repoRoot, ['for-each-ref', '--format=%(refname) %(objectname)']);
}

function history(f: ReturnType<typeof fixture>): string[] {
  return [getWorkflowPaths(f.repoRoot).statePath,
    ...[f.original, f.middle, f.terminal].map((r) => getProtocolRecordPath(f.repoRoot, r.workstreamId))]
    .map((file) => readFileSync(file, 'utf8'));
}

describe('audited historical evidence retirement', () => {
  it('TEE-RETIRE-LEGAL-001 preserves history and opens the normal gate only after an authorised receipt', () => {
    const f = fixture();
    expect(inspectWorkflowEvidencePins(f.repoRoot, f.original).missing).toEqual([f.missing]);
    const blocked = getFinaliseProtocolReadiness(f.repoRoot);
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockingWorkstreams.map((r) => r.workstreamId)).toEqual(['ws_original']);
    const before = history(f);
    const oldRefs = refs(f.repoRoot);
    const dry = retireWorkflowEvidence({ ...f.params, dryRun: true });
    expect(dry.receipt.chain.records.map((r) => r.workstreamId)).toEqual(['ws_original', 'ws_middle', 'ws_terminal']);
    expect(refs(f.repoRoot)).toBe(oldRefs);
    expect(existsSync(getWorkflowRetirementPath(f.repoRoot, 'ws_original'))).toBe(false);
    expect(evidenceGit(f.repoRoot, ['merge-base', f.importedOne, f.terminalHead])).toBe(f.base);
    const applied = retireWorkflowEvidence(f.params);
    expect(applied.alreadyRecorded).toBe(false);
    expect(history(f)).toEqual(before);
    const allowed = getFinaliseProtocolReadiness(f.repoRoot);
    expect(allowed.blockingWorkstreams, JSON.stringify(allowed.blockingWorkstreams)).toEqual([]);
    expect(allowed.allowed).toBe(true);
    const auditPath = getWorkflowRetirementPath(f.repoRoot, 'ws_original');
    const receipt = readFileSync(auditPath, 'utf8');
    const pinned = refs(f.repoRoot);
    expect(retireWorkflowEvidence(f.params).alreadyRecorded).toBe(true);
    expect(readFileSync(auditPath, 'utf8')).toBe(receipt);
    expect(history(f)).toEqual(before);
    getFinaliseProtocolReadiness(f.repoRoot);
    expect(refs(f.repoRoot)).toBe(pinned);
    expect(readFileSync(auditPath, 'utf8')).toBe(receipt);
  });

  it('TEE-RETIRE-AUTH-002 requires explicit authorisation, reason and the exact missing candidate', () => {
    const f = fixture();
    for (const options of [
      { ownerAuthorisedRetirement: false }, { reason: '' }, { missingCommit: f.base },
      { missingCommit: 'f'.repeat(40) },
    ]) {
      expect(() => retireWorkflowEvidence({ ...f.params, ...options })).toThrow();
    }
    expect(refs(f.repoRoot)).not.toContain(WORKFLOW_RETIREMENT_REF_PREFIX);
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(false);
  });

  it.each([
    'unfinished', 'unrelated', 'malformed', 'ambiguous', 'bad-route-hash', 'bad-provenance-hash',
    'missing-terminal-history', 'missing-finalise-history', 'divergent-state', 'missing-terminal-object',
  ])('TEE-RETIRE-REJECT-003 rejects %s successors', (kind) => {
    const f = fixture();
    if (kind === 'unfinished') f.terminal.phase = 'review_closed';
    if (kind === 'unrelated') {
      f.terminal.rehomeProvenance!.sourceReviewWorkstreamId = 'ws_unrelated';
      f.terminal.rehomeProvenance!.evidence!.sourceReviewWorkstreamId = 'ws_unrelated';
      f.terminal.rehomeProvenance!.evidence!.evidenceHash = hashBoundRehomeSecurityObject(f.terminal.rehomeProvenance!);
    }
    if (kind === 'malformed') f.terminal.reviewedTreeFingerprint = 'not-reviewed';
    if (kind === 'ambiguous') {
      f.state.protocolRecords!.ws_duplicate = { ...f.middle, workstreamId: 'ws_duplicate' };
    }
    if (kind === 'bad-route-hash') f.original.routeDisposition!.gitEvidence.evidenceHash = 'a'.repeat(64);
    if (kind === 'bad-provenance-hash') f.middle.rehomeProvenance!.evidence!.evidenceHash = 'b'.repeat(64);
    if (kind === 'missing-terminal-history') delete f.state.protocolRecords!.ws_terminal;
    if (kind === 'missing-finalise-history') delete f.state.workstreams!.ws_terminal.finaliseOutcome;
    if (kind === 'missing-terminal-object') {
      f.terminal.reviewAttempts[2].headCommit = 'e'.repeat(40);
      f.terminal.headCommit = 'e'.repeat(40);
    }
    f.persist();
    if (kind === 'missing-terminal-history') rmSync(getProtocolRecordPath(f.repoRoot, 'ws_terminal'));
    if (kind === 'divergent-state') {
      writeJsonAtomic(getProtocolRecordPath(f.repoRoot, 'ws_original'), { ...f.original, blockerFamilies: ['tampered'] });
    }
    expect(() => retireWorkflowEvidence(f.params)).toThrow();
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(false);
  });

  it('TEE-RETIRE-NO-BYPASS-004 leaves unrelated normal blockers in force', () => {
    const f = fixture();
    retireWorkflowEvidence(f.params);
    const unresolved = createEmptyProtocolRecord({
      workstreamId: 'ws_unresolved', baseCommit: f.base, headCommit: f.terminalHead, branchName: 'main',
    });
    f.state.protocolRecords!.ws_unresolved = unresolved;
    f.persist();
    const gate = getFinaliseProtocolReadiness(f.repoRoot);
    expect(gate.allowed).toBe(false);
    expect(gate.blockingWorkstreams.some((row) => row.workstreamId === 'ws_unresolved')).toBe(true);
  });

  it.each(['receipt', 'original-history', 'terminal-regression', 'finalise-regression', 'head-ancestry'])(
    'TEE-RETIRE-TAMPER-005 revalidates %s at every gate', (kind) => {
      const f = fixture();
      retireWorkflowEvidence(f.params);
      if (kind === 'receipt') {
        const file = getWorkflowRetirementPath(f.repoRoot, 'ws_original');
        const receipt = JSON.parse(readFileSync(file, 'utf8'));
        writeJsonAtomic(file, { ...receipt, reason: 'forged reason' });
      }
      if (kind === 'original-history') f.original.routeDisposition!.reason = 'rewritten historical reason';
      if (kind === 'terminal-regression') f.terminal.openBlockerIds = ['NEW-BLOCKER'];
      if (kind === 'finalise-regression') f.state.workstreams!.ws_terminal.finaliseOutcome = 'failed';
      if (kind === 'head-ancestry') evidenceGit(f.repoRoot, ['checkout', '--quiet', '-b', 'unrelated-release', f.base]);
      if (kind !== 'receipt') f.persist();
      const gate = getFinaliseProtocolReadiness(f.repoRoot);
      expect(gate.allowed).toBe(false);
      expect(gate.blockingWorkstreams.some((row) => /retirement failed revalidation/u.test(row.message))).toBe(true);
    }
  );

  it('TEE-RETIRE-CRASH-006 fails closed on incomplete mirrors and recovers only by explicit replay', () => {
    const f = fixture();
    retireWorkflowEvidence(f.params);
    const file = getWorkflowRetirementPath(f.repoRoot, 'ws_original');
    rmSync(file);
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(false);
    expect(retireWorkflowEvidence({ ...f.params, dryRun: true }).alreadyRecorded).toBe(true);
    expect(existsSync(file)).toBe(false);
    retireWorkflowEvidence(f.params);
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(true);
    writeFileSync(file, '{"schemaVersion":');
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(false);
    expect(() => retireWorkflowEvidence(f.params)).toThrow(/tampering/u);
  });

  it('TEE-RETIRE-READONLY-007 never repairs missing evidence during status', () => {
    const f = fixture();
    const before = history(f);
    const oldRefs = refs(f.repoRoot);
    getFinaliseProtocolReadiness(f.repoRoot);
    getFinaliseProtocolReadiness(f.repoRoot);
    expect(refs(f.repoRoot)).toBe(oldRefs);
    expect(history(f)).toEqual(before);
    expect(existsSync(path.join(getWorkflowPaths(f.repoRoot).automationRoot, 'evidence-retirements'))).toBe(false);
  });

  it('TEE-RETIRE-SEAL-008 rejects missing and symbolic seals without rewriting the receipt', () => {
    const f = fixture();
    retireWorkflowEvidence(f.params);
    const file = getWorkflowRetirementPath(f.repoRoot, 'ws_original');
    const before = readFileSync(file, 'utf8');
    const seal = `${WORKFLOW_RETIREMENT_REF_PREFIX}ws_original`;
    const blob = evidenceGit(f.repoRoot, ['rev-parse', seal]);
    evidenceGit(f.repoRoot, ['update-ref', '-d', seal]);
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(false);
    expect(() => retireWorkflowEvidence(f.params)).toThrow(/unsealed/u);
    evidenceGit(f.repoRoot, ['update-ref', 'refs/fixture/receipt', blob]);
    evidenceGit(f.repoRoot, ['symbolic-ref', seal, 'refs/fixture/receipt']);
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(false);
    expect(() => retireWorkflowEvidence(f.params)).toThrow(/symbolic/u);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('TEE-RETIRE-CLI-009 validates CLI authorisation and dry run before an explicit apply', () => {
    const f = fixture();
    const before = history(f);
    const oldRefs = refs(f.repoRoot);
    const cli = (args: string[]) => spawnSync(process.execPath, [
      '--import', 'tsx', path.resolve('scripts', 'workflow-protocol.ts'),
      'retire-evidence', '--repo-root', f.repoRoot, '--workstream', f.params.workstreamId,
      '--missing-commit', f.missing, ...args,
    ], { encoding: 'utf8', shell: false, timeout: 120_000 });
    expect(cli(['--reason', f.params.reason]).status).toBe(1);
    const malformed = cli(['--reason', '--owner-authorised-retirement']);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('--reason requires a value');
    const flags = ['--reason', f.params.reason, '--owner-authorised-retirement'];
    const dry = cli([...flags, '--dry-run']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).dryRun).toBe(true);
    expect(refs(f.repoRoot)).toBe(oldRefs);
    expect(history(f)).toEqual(before);
    const apply = cli(flags);
    expect(apply.status, apply.stderr).toBe(0);
    expect(JSON.parse(apply.stdout).alreadyRecorded).toBe(false);
    expect(history(f)).toEqual(before);
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(true);
  });
});

describe('local Git evidence retention', () => {
  it('TEE-EVIDENCE-GC-001 automatically retains candidates, route and terminal evidence across branch deletion and GC', () => {
    const repoRoot = makeTempRoot('evidence-pin-gc');
    const base = initGitRepo(repoRoot);
    evidenceGit(repoRoot, ['checkout', '--quiet', '-b', 'temporary-review']);
    const candidate = commit(repoRoot, 'review\n', 'candidate');
    const terminal = commit(repoRoot, 'terminal\n', 'terminal evidence');
    const record = createEmptyProtocolRecord({ workstreamId: 'ws_pin', baseCommit: base, headCommit: terminal });
    record.reviewAttempts = [attempt('first', candidate, 'failed')];
    record.routeDisposition = {
      schemaVersion: '1', command: 'route', target: 'rehomed', recordedAt: stamp, reason: 'fixture',
      gitEvidence: {
        kind: 'isolated_successor', baselineCommit: base, releaseHeadCommit: terminal,
        implementationCommits: [candidate], evidenceHash: 'fixture',
      },
    };
    writeProtocolRecord(repoRoot, record);
    const stateOnly = commit(repoRoot, 'finalise result\n', 'state-only finalise result');
    const state = createEmptyWorkflowReviewState();
    state.workstreams = {
      ws_pin: {
        workstreamId: 'ws_pin', branchName: 'temporary-review', headCommit: terminal,
        taskIds: [], eventIds: [], status: 'finalised', updatedAt: stamp,
        finaliseOutcome: 'passed', finaliseRunId: 'fixture-finalise', finaliseCommit: stateOnly,
      },
    };
    saveWorkflowReviewState(getWorkflowPaths(repoRoot).statePath, state);
    evidenceGit(repoRoot, ['checkout', '--quiet', 'main']);
    evidenceGit(repoRoot, ['branch', '-D', 'temporary-review']);
    pruneFixture(repoRoot);
    expect(evidenceGit(repoRoot, ['cat-file', '-t', candidate])).toBe('commit');
    expect(evidenceGit(repoRoot, ['cat-file', '-t', terminal])).toBe('commit');
    expect(evidenceGit(repoRoot, ['cat-file', '-t', stateOnly])).toBe('commit');
    expect(inspectWorkflowEvidencePins(repoRoot, record).unpinned).toEqual([]);
    expect(refs(repoRoot)).toContain(`${WORKFLOW_EVIDENCE_REF_PREFIX}${candidate}`);
  });

  it('TEE-EVIDENCE-BACKFILL-002 audits/backfills idempotently, retaining all available history and reporting missing objects', () => {
    const f = fixture();
    const oldRefs = refs(f.repoRoot);
    const dry = auditWorkflowEvidence({ repoRoot: f.repoRoot, dryRun: true });
    expect(dry.missing).toEqual([f.missing]);
    expect(dry.unpinned.length).toBeGreaterThan(0);
    expect(refs(f.repoRoot)).toBe(oldRefs);
    const applied = auditWorkflowEvidence({ repoRoot: f.repoRoot, dryRun: false });
    expect(applied.missing).toEqual([f.missing]);
    const pinned = refs(f.repoRoot);
    expect(auditWorkflowEvidence({ repoRoot: f.repoRoot, dryRun: false }).unpinned).toEqual([]);
    expect(refs(f.repoRoot)).toBe(pinned);
    expect(refs(f.repoRoot)).not.toContain(`${WORKFLOW_EVIDENCE_REF_PREFIX}${f.missing}`);
    evidenceGit(f.repoRoot, ['branch', '-D', 'successor-one']);
    pruneFixture(f.repoRoot);
    expect(evidenceGit(f.repoRoot, ['cat-file', '-t', f.candidateOne])).toBe('commit');
    expect(evidenceGit(f.repoRoot, ['cat-file', '-t', f.importedOne])).toBe('commit');
    expect(getFinaliseProtocolReadiness(f.repoRoot).allowed).toBe(false);
  });

  it('TEE-EVIDENCE-CAS-003 refuses conflicting refs without publishing any other pins', () => {
    const repoRoot = makeTempRoot('evidence-cas');
    const base = initGitRepo(repoRoot);
    const candidate = commit(repoRoot, 'candidate\n', 'candidate');
    evidenceGit(repoRoot, ['update-ref', `${WORKFLOW_EVIDENCE_REF_PREFIX}${candidate}`, base]);
    expect(() => pinWorkflowEvidence(repoRoot, { baseCommit: base, headCommit: candidate })).toThrow(/collision/u);
    expect(refs(repoRoot)).not.toContain(`${WORKFLOW_EVIDENCE_REF_PREFIX}${base} `);
  });

  it('TEE-EVIDENCE-CLI-004 returns nonzero for missing backfill objects, without mutation on dry run', () => {
    const f = fixture();
    const before = refs(f.repoRoot);
    const cli = spawnSync(process.execPath, [
      '--import', 'tsx', path.resolve('scripts', 'workflow-protocol.ts'),
      'evidence-backfill', '--repo-root', f.repoRoot, '--dry-run',
    ], { encoding: 'utf8', shell: false });
    expect(cli.status, cli.stderr).toBe(1);
    expect(JSON.parse(cli.stdout).missing).toEqual([f.missing]);
    expect(refs(f.repoRoot)).toBe(before);
  });
});
