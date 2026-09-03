import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowProtocolRecord, WorkflowProtocolReviewAttempt } from '@/scripts/automation/types';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
} from '@/scripts/automation/workflow-events';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import { reviewAuthorizesProtectedFinalise, writeProtocolRecord } from '@/scripts/automation/workflow-review-protocol';
import {
  latestLegalFinalDiffAttempt,
  validateCurrentV24ProtocolRecord,
} from '@/scripts/automation/workflow-v24-protocol-validator';

const tempRoots: string[] = [];
const HEAD_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const FINGERPRINT_A = 'a'.repeat(32);
const FINGERPRINT_B = 'b'.repeat(32);
const NOW = '2026-09-03T12:00:00.000Z';

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function passedAttempt(
  pass: 'first' | 'closure' | 'delta',
  extras: Partial<WorkflowProtocolReviewAttempt> = {}
): WorkflowProtocolReviewAttempt {
  return {
    pass,
    token: extras.token ?? `rev_${pass}_passedtoken`,
    startedAt: extras.startedAt ?? NOW,
    recordedAt: extras.recordedAt ?? NOW,
    result: 'passed',
    headCommit: extras.headCommit ?? HEAD_A,
    treeFingerprint: extras.treeFingerprint ?? FINGERPRINT_A,
    ...extras,
  };
}

function failedAttempt(
  pass: 'first' | 'closure' | 'delta',
  extras: Partial<WorkflowProtocolReviewAttempt> = {}
): WorkflowProtocolReviewAttempt {
  return {
    pass,
    token: extras.token ?? `rev_${pass}_failedtoken`,
    startedAt: extras.startedAt ?? NOW,
    recordedAt: extras.recordedAt ?? NOW,
    result: 'failed',
    blockerFamilies: extras.blockerFamilies ?? ['review'],
    blockerIds: extras.blockerIds ?? ['FDR-PROTOCOL-RECORD-VALIDATION-002'],
    siblingSurfaces: extras.siblingSurfaces ?? ['workflow'],
    headCommit: extras.headCommit,
    treeFingerprint: extras.treeFingerprint,
    ...extras,
  };
}

function makeRecord(extra: Partial<WorkflowProtocolRecord> = {}): WorkflowProtocolRecord {
  const phase = extra.phase ?? 'initialized';
  const successPhase = phase === 'review_closed' || phase === 'finalise_ready' || phase === 'finalised';
  return {
    schemaVersion: '1',
    workstreamId: extra.workstreamId ?? 'ws_latest_legal',
    identityStatus: 'present',
    inheritedFailedReviewCount: extra.inheritedFailedReviewCount ?? 0,
    branchName: extra.branchName ?? 'main',
    baseCommit: extra.baseCommit ?? HEAD_A,
    headCommit: extra.headCommit ?? HEAD_A,
    phase,
    nextAction:
      extra.nextAction ??
      (phase === 'finalise_ready'
        ? 'run_finalise'
        : phase === 'review_closed'
          ? 'finalise_start'
          : phase === 'finalised'
            ? 'done'
            : phase === 'routing_required'
              ? 'route_or_isolate'
              : 'continue'),
    failedPremiumReviewCount: extra.failedPremiumReviewCount ?? 0,
    activeReviewToken: extra.activeReviewToken ?? null,
    activeReviewPass: extra.activeReviewPass ?? null,
    reviewAttempts: extra.reviewAttempts ?? [],
    blockerFamilies: extra.blockerFamilies ?? [],
    openBlockerIds: extra.openBlockerIds ?? [],
    evidenceManifestPath: extra.evidenceManifestPath ?? null,
    fixDeltaManifestPath: extra.fixDeltaManifestPath ?? null,
    activeCheckpointId:
      extra.activeCheckpointId === undefined
        ? phase === 'finalise_ready'
          ? 'ckpt_latest'
          : null
        : extra.activeCheckpointId,
    planPath: extra.planPath ?? null,
    sourceWorkstreamIds: extra.sourceWorkstreamIds,
    reviewedTreeFingerprint:
      extra.reviewedTreeFingerprint ?? (successPhase ? FINGERPRINT_A : null),
    updatedAt: extra.updatedAt ?? NOW,
  };
}

function writeReadinessFixture(
  label: string,
  record: WorkflowProtocolRecord,
  active?: { workstreamId: string; checkpointId: string }
): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), `latest-legal-${label}-`));
  tempRoots.push(repoRoot);
  mkdirSync(path.join(repoRoot, 'docs_private', 'automation'), { recursive: true });
  writeProtocolRecord(repoRoot, record);
  const paths = getWorkflowPaths(repoRoot);
  saveWorkflowReviewState(paths.statePath, {
    ...createEmptyWorkflowReviewState(),
    protocolRecords: { [record.workstreamId]: record },
    activeFinaliseContext: active
      ? {
          workstreamId: active.workstreamId,
          checkpointId: active.checkpointId,
          activatedAt: NOW,
        }
      : null,
  });
  return repoRoot;
}

function expectAuthorized(record: WorkflowProtocolRecord): void {
  const latest = latestLegalFinalDiffAttempt(record);
  expect(latest.ok).toBe(true);
  if (latest.ok) {
    expect(latest.attempt?.result).toBe('passed');
  }
  expect(validateCurrentV24ProtocolRecord(record).ok).toBe(true);
  expect(reviewAuthorizesProtectedFinalise(record)).toBe(true);
}

function expectNotAuthorized(record: WorkflowProtocolRecord): void {
  expect(reviewAuthorizesProtectedFinalise(record)).toBe(false);
}

describe('FDR-PROTOCOL-RECORD-VALIDATION-002 latest legal final-diff authority', () => {
  it('latest-legal: first passed and no closure is authorised', () => {
    const record = makeRecord({
      phase: 'finalise_ready',
      reviewAttempts: [passedAttempt('first')],
    });
    expectAuthorized(record);
    const repoRoot = writeReadinessFixture('first-passed', record, {
      workstreamId: record.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(true);
  });

  it('latest-legal: first failed then closure passed is authorised', () => {
    const record = makeRecord({
      phase: 'finalise_ready',
      failedPremiumReviewCount: 1,
      reviewAttempts: [failedAttempt('first'), passedAttempt('closure')],
    });
    expectAuthorized(record);
    const repoRoot = writeReadinessFixture('closure-passed', record, {
      workstreamId: record.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(true);
  });

  it('latest-legal: first failed and closure failed is rejected', () => {
    const successClaim = makeRecord({
      phase: 'finalise_ready',
      failedPremiumReviewCount: 2,
      reviewAttempts: [failedAttempt('first'), failedAttempt('closure')],
    });
    expect(validateCurrentV24ProtocolRecord(successClaim).ok).toBe(false);
    expectNotAuthorized(successClaim);

    const exhausted = makeRecord({
      workstreamId: 'ws_latest_both_failed',
      phase: 'routing_required',
      failedPremiumReviewCount: 2,
      reviewedTreeFingerprint: null,
      activeCheckpointId: null,
      reviewAttempts: [failedAttempt('first'), failedAttempt('closure')],
    });
    expect(validateCurrentV24ProtocolRecord(exhausted).ok).toBe(true);
    expectNotAuthorized(exhausted);
    const repoRoot = writeReadinessFixture('both-failed', exhausted);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });

  it('latest-legal: passed then later failed legal attempt is rejected', () => {
    const record = makeRecord({
      phase: 'finalise_ready',
      failedPremiumReviewCount: 1,
      reviewAttempts: [passedAttempt('first'), failedAttempt('closure')],
    });
    const latest = latestLegalFinalDiffAttempt(record);
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.attempt?.result).toBe('failed');
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
    expectNotAuthorized(record);
    const repoRoot = writeReadinessFixture('pass-then-fail', record, {
      workstreamId: record.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });

  it('latest-legal: earlier pass cannot override latest legal failure', () => {
    const record = makeRecord({
      phase: 'review_closed',
      failedPremiumReviewCount: 1,
      activeCheckpointId: null,
      reviewAttempts: [
        passedAttempt('first', { token: 'rev_first_earlierpass', headCommit: HEAD_A, treeFingerprint: FINGERPRINT_A }),
        failedAttempt('closure', { token: 'rev_closure_laterfail' }),
      ],
    });
    expectNotAuthorized(record);
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
  });

  it('latest-legal: no legal review is rejected', () => {
    const record = makeRecord({ phase: 'finalise_ready' });
    const latest = latestLegalFinalDiffAttempt(record);
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.attempt).toBeNull();
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
    expectNotAuthorized(record);
    const repoRoot = writeReadinessFixture('no-review', record, {
      workstreamId: record.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });

  it('latest-legal: architecture approval alone is rejected', () => {
    const record = makeRecord({
      workstreamId: 'ws_latest_arch_only',
      phase: 'finalise_ready',
      reviewAttempts: [],
    });
    expect(latestLegalFinalDiffAttempt(record).ok).toBe(true);
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
    expectNotAuthorized(record);
  });

  it('latest-legal: illegal third review does not grant authority', () => {
    const record = makeRecord({
      phase: 'finalise_ready',
      failedPremiumReviewCount: 2,
      reviewAttempts: [
        failedAttempt('first', { token: 'rev_first_legalone' }),
        failedAttempt('closure', { token: 'rev_closure_legaltwo' }),
        passedAttempt('first', { token: 'rev_first_illegalthird' }),
      ],
    });
    const latest = latestLegalFinalDiffAttempt(record);
    expect(latest.ok).toBe(false);
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
    expectNotAuthorized(record);
    const repoRoot = writeReadinessFixture('illegal-third', record, {
      workstreamId: record.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });

  it('latest-legal: malformed first/closure ordering is rejected', () => {
    const record = makeRecord({
      phase: 'finalise_ready',
      failedPremiumReviewCount: 1,
      reviewAttempts: [failedAttempt('closure')],
    });
    expect(latestLegalFinalDiffAttempt(record).ok).toBe(false);
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
    expectNotAuthorized(record);
  });

  it('latest-legal: duplicate or impossible attempt ordering fails closed', () => {
    const duplicateFirst = makeRecord({
      phase: 'review_closed',
      activeCheckpointId: null,
      reviewAttempts: [
        passedAttempt('first', { token: 'rev_first_one' }),
        passedAttempt('first', { token: 'rev_first_two' }),
      ],
    });
    expect(latestLegalFinalDiffAttempt(duplicateFirst).ok).toBe(false);
    expect(validateCurrentV24ProtocolRecord(duplicateFirst).ok).toBe(false);
    expectNotAuthorized(duplicateFirst);

    const closureThenFirst = makeRecord({
      phase: 'finalise_ready',
      failedPremiumReviewCount: 1,
      reviewAttempts: [failedAttempt('closure'), passedAttempt('first')],
    });
    expect(latestLegalFinalDiffAttempt(closureThenFirst).ok).toBe(false);
    expect(validateCurrentV24ProtocolRecord(closureThenFirst).ok).toBe(false);
    expectNotAuthorized(closureThenFirst);
  });

  it('latest-legal: routing_required after latest failure is rejected', () => {
    const record = makeRecord({
      workstreamId: 'ws_latest_routing',
      phase: 'routing_required',
      failedPremiumReviewCount: 2,
      reviewedTreeFingerprint: null,
      activeCheckpointId: null,
      reviewAttempts: [
        passedAttempt('first'),
        failedAttempt('closure', { token: 'rev_closure_latestfail' }),
      ],
    });
    const latest = latestLegalFinalDiffAttempt(record);
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.attempt?.result).toBe('failed');
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(true);
    expectNotAuthorized(record);
    const repoRoot = writeReadinessFixture('routing-required', record);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });

  it('latest-legal: stale earlier-pass HEAD/fingerprint cannot grant finalise', () => {
    const record = makeRecord({
      phase: 'finalise_ready',
      failedPremiumReviewCount: 1,
      headCommit: HEAD_A,
      reviewedTreeFingerprint: FINGERPRINT_A,
      reviewAttempts: [
        passedAttempt('first', { headCommit: HEAD_A, treeFingerprint: FINGERPRINT_A }),
        failedAttempt('closure', {
          token: 'rev_closure_newhead',
          headCommit: HEAD_B,
          treeFingerprint: FINGERPRINT_B,
        }),
      ],
    });
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
    expectNotAuthorized(record);
    const repoRoot = writeReadinessFixture('stale-head', record, {
      workstreamId: record.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });

  it('latest-legal: current valid passed record remains compatible', () => {
    const record = makeRecord({
      workstreamId: 'ws_latest_compatible',
      phase: 'review_closed',
      activeCheckpointId: null,
      reviewAttempts: [passedAttempt('first')],
    });
    expectAuthorized(record);
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(true);
  });

  it('FDR-AUTH-INHERITED-FIRST-001: inherited count of one plus local passed first is rejected', () => {
    const record = makeRecord({
      workstreamId: 'ws_latest_inherited_first',
      phase: 'finalise_ready',
      inheritedFailedReviewCount: 1,
      failedPremiumReviewCount: 1,
      reviewAttempts: [passedAttempt('first')],
    });
    expect(latestLegalFinalDiffAttempt(record).ok).toBe(false);
    expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
    expectNotAuthorized(record);
    const repoRoot = writeReadinessFixture('inherited-first', record, {
      workstreamId: record.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);

    const legalClosure = makeRecord({
      workstreamId: 'ws_latest_inherited_closure',
      phase: 'finalise_ready',
      inheritedFailedReviewCount: 1,
      failedPremiumReviewCount: 1,
      reviewAttempts: [passedAttempt('closure')],
    });
    expectAuthorized(legalClosure);
  });

  it('FDR-AUTH-INHERITED-EXHAUSTED-002: exhausted inherited budget plus later passed attempt fails closed', () => {
    const withFirst = makeRecord({
      workstreamId: 'ws_latest_inherited_exh_first',
      phase: 'finalise_ready',
      inheritedFailedReviewCount: 2,
      failedPremiumReviewCount: 2,
      reviewAttempts: [passedAttempt('first')],
    });
    expect(latestLegalFinalDiffAttempt(withFirst).ok).toBe(false);
    expect(validateCurrentV24ProtocolRecord(withFirst).ok).toBe(false);
    expectNotAuthorized(withFirst);

    const withClosure = makeRecord({
      workstreamId: 'ws_latest_inherited_exh_closure',
      phase: 'finalise_ready',
      inheritedFailedReviewCount: 2,
      failedPremiumReviewCount: 2,
      reviewAttempts: [passedAttempt('closure')],
    });
    expect(latestLegalFinalDiffAttempt(withClosure).ok).toBe(false);
    expect(validateCurrentV24ProtocolRecord(withClosure).ok).toBe(false);
    expectNotAuthorized(withClosure);
    const repoRoot = writeReadinessFixture('inherited-exhausted', withClosure, {
      workstreamId: withClosure.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });

  it('FDR-AUTH-CASES-A-F-003: cases A-F use validator, authority, and readiness consumers', () => {
    const authorized = [
      makeRecord({
        workstreamId: 'ws_latest_case_a',
        phase: 'finalise_ready',
        reviewAttempts: [passedAttempt('first')],
      }),
      makeRecord({
        workstreamId: 'ws_latest_case_b',
        phase: 'finalise_ready',
        failedPremiumReviewCount: 1,
        reviewAttempts: [failedAttempt('first'), passedAttempt('closure')],
      }),
    ];
    for (const record of authorized) {
      expectAuthorized(record);
      const repoRoot = writeReadinessFixture(record.workstreamId, record, {
        workstreamId: record.workstreamId,
        checkpointId: 'ckpt_latest',
      });
      expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(true);
    }

    const rejected = [
      makeRecord({
        workstreamId: 'ws_latest_case_c',
        phase: 'finalise_ready',
        failedPremiumReviewCount: 1,
        reviewAttempts: [passedAttempt('first'), failedAttempt('closure')],
      }),
      makeRecord({
        workstreamId: 'ws_latest_case_d',
        phase: 'finalise_ready',
        failedPremiumReviewCount: 2,
        reviewAttempts: [failedAttempt('first'), failedAttempt('closure')],
      }),
      makeRecord({
        workstreamId: 'ws_latest_case_e',
        phase: 'finalise_ready',
        reviewAttempts: [],
      }),
      makeRecord({
        workstreamId: 'ws_latest_case_f',
        phase: 'finalise_ready',
        failedPremiumReviewCount: 1,
        reviewAttempts: [failedAttempt('closure')],
      }),
    ];
    for (const record of rejected) {
      expect(validateCurrentV24ProtocolRecord(record).ok).toBe(false);
      expectNotAuthorized(record);
      const repoRoot = writeReadinessFixture(record.workstreamId, record, {
        workstreamId: record.workstreamId,
        checkpointId: 'ckpt_latest',
      });
      expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    }
  });

  it('latest-legal: appending a later failed attempt withdraws readiness', () => {
    const valid = makeRecord({
      workstreamId: 'ws_latest_mutate',
      phase: 'finalise_ready',
      reviewAttempts: [passedAttempt('first')],
    });
    const repoRoot = writeReadinessFixture('mutation', valid, {
      workstreamId: valid.workstreamId,
      checkpointId: 'ckpt_latest',
    });
    expect(validateCurrentV24ProtocolRecord(valid).ok).toBe(true);
    expect(reviewAuthorizesProtectedFinalise(valid)).toBe(true);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(true);

    const mutated: WorkflowProtocolRecord = {
      ...valid,
      failedPremiumReviewCount: 1,
      reviewAttempts: [
        ...valid.reviewAttempts,
        failedAttempt('closure', { token: 'rev_closure_appended' }),
      ],
    };
    writeProtocolRecord(repoRoot, mutated);
    expect(validateCurrentV24ProtocolRecord(mutated).ok).toBe(false);
    expect(reviewAuthorizesProtectedFinalise(mutated)).toBe(false);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
  });
});
