import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
  readProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  hashBoundRehomeSecurityObject,
  hashCanonicalEvidence,
  revalidateBoundRehomeProvenance,
} from '@/scripts/automation/workflow-v24-disposition';
import type { WorkflowRehomeProvenance } from '@/scripts/automation/types';
import {
  assertSecurityMutationsFail,
  cloneJson,
} from '@/tests/unit/workflow-v24-mutation-helper';
import {
  commitFile,
  declaredRehome,
  git,
  setupIsolatedRehomeFixture,
  writeCriticalPlan,
} from '@/tests/unit/workflow-v24-test-harness';

let shared: ReturnType<typeof setupIsolatedRehomeFixture>;

beforeAll(() => {
  shared = setupIsolatedRehomeFixture();
});

function requireBound(fixture: ReturnType<typeof setupIsolatedRehomeFixture>) {
  expect(fixture.bound.ok, fixture.bound.ok ? '' : fixture.bound.message).toBe(true);
  const record = readProtocolRecord(fixture.successorRoot, 'ws_fd_rehome');
  expect(record?.rehomeProvenance?.status).toBe('bound');
  return record!.rehomeProvenance!;
}

function rehash(provenance: WorkflowRehomeProvenance): WorkflowRehomeProvenance {
  const next = cloneJson(provenance);
  next.evidence = {
    ...next.evidence!,
    evidenceHash: hashBoundRehomeSecurityObject(next),
  };
  return next;
}

describe('TEE V2.4 bound rehome provenance integrity', { timeout: 60_000 }, () => {
  it('FD-LINEAGE-BOUND-INTEGRITY-004 / TEE-V24-BOUND-VALID-001: valid canonical bound evidence passes', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const valid = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance,
    });
    expect(valid.ok, valid.ok ? '' : valid.message).toBe(true);
  });

  it('TEE-V24-BOUND-HASH-TAMPER-002: evidenceHash tamper without rehash fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = cloneJson(provenance);
    tampered.evidence = { ...tampered.evidence!, evidenceHash: 'ab'.repeat(32) };
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/hash/i);
  });

  it('TEE-V24-BOUND-GENERIC-REHASH-003: field tamper plus generic content hash still fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = cloneJson(provenance);
    tampered.sourceHeadCommit = fixture.sourceBaseline;
    tampered.evidence = {
      ...tampered.evidence!,
      sourceHeadCommit: fixture.sourceBaseline,
      latestLegalReviewCandidateHead: fixture.sourceBaseline,
      evidenceHash: hashCanonicalEvidence({ tampered: true, ...tampered.evidence }),
    };
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-SOURCE-BRANCH-004: source branch altered fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      sourceReleaseContext: `${fixture.sourceRoot}#other`,
      evidence: { ...provenance.evidence!, sourceReleaseContext: `${fixture.sourceRoot}#other` },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-SOURCE-HEAD-005: source HEAD altered fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      sourceHeadCommit: fixture.sourceBaseline,
      evidence: {
        ...provenance.evidence!,
        sourceHeadCommit: fixture.sourceBaseline,
        latestLegalReviewCandidateHead: fixture.sourceBaseline,
      },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-BASELINE-006: baseline altered fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      sourceBaselineCommit: fixture.sourceHead,
      evidence: { ...provenance.evidence!, sourceBaselineCommit: fixture.sourceHead },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-PRED-HEAD-007: predecessor HEAD altered fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      predecessorHeadCommit: fixture.successorBaseline,
      evidence: {
        ...provenance.evidence!,
        predecessorHead: fixture.successorBaseline,
        predecessorBranchResolvedSha: fixture.successorBaseline,
      },
      predecessorBranchResolvedSha: fixture.successorBaseline,
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-COMMITS-008: implementationCommits altered fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      sourceImplementationCommits: [fixture.sourceBaseline],
      evidence: { ...provenance.evidence!, implementationCommits: [fixture.sourceBaseline] },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-FINGERPRINT-009: product fingerprint altered fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      sourceProductTreeFingerprint: 'ab'.repeat(32),
      evidence: { ...provenance.evidence!, sourceProductTreeFingerprint: 'ab'.repeat(32) },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-ANCESTOR-TRUE-010: predecessorHeadIsAncestor=true fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      predecessorHeadIsAncestor: true as never,
      evidence: { ...provenance.evidence!, predecessorHeadIsAncestor: false },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/predecessorHeadIsAncestor|ancestor/i);
  });

  it('TEE-V24-BOUND-ANCESTOR-MISSING-011: ancestry flag missing fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = cloneJson(provenance) as WorkflowRehomeProvenance & {
      predecessorHeadIsAncestor?: false;
    };
    delete tampered.predecessorHeadIsAncestor;
    tampered.evidence = {
      ...tampered.evidence!,
      evidenceHash: hashBoundRehomeSecurityObject(tampered),
    };
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-CROSSBIND-013: branch/HEAD cross-bind mismatch fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      evidence: { ...provenance.evidence!, currentHead: fixture.sourceHead },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-RANGE-014: baseline/range mismatch fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    const tampered = rehash({
      ...provenance,
      successorBaselineCommit: fixture.sourceHead,
      evidence: { ...provenance.evidence!, successorBaseline: fixture.sourceHead },
    });
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('TEE-V24-BOUND-REINIT-RETAIN-015: re-init retains the complete bound object', () => {
    const fixture = shared;
    const first = requireBound(fixture);
    const again = applyProtocolTransition({
      repoRoot: fixture.successorRoot,
      command: 'init',
      workstreamId: 'ws_fd_rehome',
      baseCommit: fixture.successorBaseline,
    });
    expect(again.ok, again.message).toBe(true);
    const stored = readProtocolRecord(fixture.successorRoot, 'ws_fd_rehome')!.rehomeProvenance!;
    expect(stored).toEqual(first);
  });

  it('TEE-V24-BOUND-REINIT-CONFLICT-016: conflicting re-init cannot replace a bound security field', () => {
    const fixture = shared;
    const first = requireBound(fixture);
    const planPath = writeCriticalPlan(fixture.successorRoot, 'ws_fd_rehome', {
      rehome: declaredRehome(fixture.successorBaseline, 'successor', fixture.predHead, `${fixture.predRoot}#main`, {
        sourceHeadCommit: fixture.sourceBaseline,
        sourceBaselineCommit: fixture.sourceBaseline,
        sourcePatchSha256: first.sourcePatchSha256,
        sourceProductTreeFingerprint: first.sourceProductTreeFingerprint,
      }),
    });
    const again = applyProtocolTransition({
      repoRoot: fixture.successorRoot,
      command: 'init',
      workstreamId: 'ws_fd_rehome',
      planPath,
      baseCommit: fixture.successorBaseline,
    });
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/cannot replace bound security field/i);
    const stored = readProtocolRecord(fixture.successorRoot, 'ws_fd_rehome')!.rehomeProvenance!;
    expect(stored.sourceHeadCommit).toBe(first.sourceHeadCommit);
    expect(stored.evidence?.evidenceHash).toBe(first.evidence?.evidenceHash);
  });

  it('TEE-V24-BOUND-MUTATION-017: mutating any bound security field fails validation', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    assertSecurityMutationsFail({
      valid: provenance,
      validate: (value) =>
        revalidateBoundRehomeProvenance({ repoRoot: fixture.successorRoot, provenance: value }),
      fields: [
        {
          path: 'sourceHeadCommit',
          mutate: (value) => rehash({ ...value, sourceHeadCommit: fixture.sourceBaseline }),
        },
        {
          path: 'predecessorHeadIsAncestor',
          mutate: (value) => ({ ...value, predecessorHeadIsAncestor: true as never }),
          remove: (value) => {
            const next = cloneJson(value) as WorkflowRehomeProvenance & {
              predecessorHeadIsAncestor?: false;
            };
            delete next.predecessorHeadIsAncestor;
            return next;
          },
        },
        {
          path: 'evidenceHash',
          mutate: (value) => ({
            ...value,
            evidence: { ...value.evidence!, evidenceHash: 'cd'.repeat(32) },
          }),
        },
        {
          path: 'sourceBaselineCommit',
          mutate: (value) => rehash({ ...value, sourceBaselineCommit: fixture.predHead }),
        },
        {
          path: 'sourceProductTreeFingerprint',
          mutate: (value) =>
            rehash({ ...value, sourceProductTreeFingerprint: 'ab'.repeat(32) }),
        },
        {
          path: 'sourceImplementationCommits',
          mutate: (value) => rehash({ ...value, sourceImplementationCommits: [fixture.predHead] }),
        },
        {
          path: 'successorBranchName',
          mutate: (value) => rehash({ ...value, successorBranchName: 'other' }),
        },
      ],
    });
  });

  it('TEE-V24-BOUND-FALSE-FLAG-GIT-ANCESTOR-012: false stored flag but Git proves ancestor fails', () => {
    const fixture = shared;
    const provenance = requireBound(fixture);
    commitFile(fixture.successorRoot, 'import-pred.ts', 'keep moving');
    const merge = git(fixture.successorRoot, [
      'commit-tree',
      `${git(fixture.successorRoot, ['rev-parse', 'HEAD^{tree}'])}`,
    ]);
    void merge;
    const imported = git(fixture.successorRoot, ['cat-file', '-t', fixture.predHead]);
    expect(imported).toBe('commit');
    git(fixture.successorRoot, ['reset', '--soft', fixture.predHead]);
    const result = revalidateBoundRehomeProvenance({
      repoRoot: fixture.successorRoot,
      provenance,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/ancestor/i);
  });
});
