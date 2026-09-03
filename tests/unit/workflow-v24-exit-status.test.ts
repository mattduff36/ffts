import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEvidenceManifest,
  recomputeManifestProvenIds,
} from '@/scripts/automation/workflow-evidence-manifest';
import {
  POST_REPORT_INFRASTRUCTURE_EXCEPTION_ENABLED,
  captureVerificationIdentity,
  classifySpawnSyncTermination,
  deriveTrustedReporterExitCode,
  hashVerificationLedgerBody,
  persistVerificationLedgerFromReporterFile,
  processOutcomeIsProofEligible,
  proveCanonicalWorkflowSuite,
  proveRequiredIdsAgainstCandidate,
  readAndValidateVerificationLedger,
  verificationRunIsProofEligible,
  type VerificationLedgerRecord,
  type VerificationProcessTermination,
} from '@/scripts/automation/workflow-verification-ledger';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  makeTempRoot,
  persistFixtureLedger,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function reloadLedger(repoRoot: string, relativePath: string): VerificationLedgerRecord {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as VerificationLedgerRecord;
}

function rehashRecord(record: VerificationLedgerRecord): VerificationLedgerRecord {
  const { contentHash: _ignored, ...body } = record;
  return { ...body, contentHash: hashVerificationLedgerBody(body) };
}

function persistProcessCase(
  repoRoot: string,
  workstreamId: string,
  title: string,
  extras: {
    exitCode: number;
    processTermination?: VerificationProcessTermination;
    reporterSuccess?: boolean;
    status?: 'passed' | 'failed' | 'skipped';
  }
) {
  const identity = captureVerificationIdentity(repoRoot);
  if (!identity.ok) throw new Error(identity.message);
  const status = extras.status ?? (extras.reporterSuccess === false ? 'failed' : 'passed');
  const reporter = {
    success: extras.reporterSuccess ?? status === 'passed',
    testResults: [
      {
        name: path.join(repoRoot, 'tests/unit/fixture.test.ts'),
        assertionResults: [
          {
            ancestorTitles: [],
            fullName: title,
            title,
            status,
          },
        ],
      },
    ],
  };
  const workstreamDir = path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId
  );
  mkdirSync(workstreamDir, { recursive: true });
  const reporterPath = path.join(workstreamDir, `exit-reporter-${title}.json`);
  writeFileSync(reporterPath, JSON.stringify(reporter));
  const persisted = persistVerificationLedgerFromReporterFile({
    repoRoot,
    workstreamId,
    commandId: 'exit-case',
    commandType: 'vitest_case',
    command: 'vitest',
    args: ['run'],
    cwd: repoRoot,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: extras.exitCode,
    processTermination: extras.processTermination,
    runnerName: 'vitest',
    runnerVersion: '3.2.4',
    reporterAbsolutePath: reporterPath,
    requiredIds: [title],
    persist: true,
    beforeIdentity: identity,
    afterIdentity: identity,
  });
  if (!persisted.ok) throw new Error(persisted.message);
  const reporterRaw = readFileSync(path.join(repoRoot, persisted.reference.reporterRelativePath));
  return { identity, persisted, reporterRaw };
}

function expectNotProofEligible(
  repoRoot: string,
  workstreamId: string,
  record: VerificationLedgerRecord,
  reporterRaw: Buffer,
  identity: { headCommit: string; productTreeFingerprint: string },
  requiredId: string
) {
  const eligible = verificationRunIsProofEligible({
    record,
    reporterRaw,
    expectedHeadCommit: identity.headCommit,
    expectedFingerprint: identity.productTreeFingerprint,
    requiredIds: [requiredId],
  });
  expect(eligible.ok).toBe(false);
  const proven = proveRequiredIdsAgainstCandidate({
    records: [record],
    requiredIds: [requiredId],
    expectedHeadCommit: identity.headCommit,
    expectedFingerprint: identity.productTreeFingerprint,
    repoRoot,
    workstreamId,
  });
  expect(proven.ok).toBe(false);
  return { eligible, proven };
}

describe('TEE V2.4 verification exit-status proof contract', () => {
  it('TEE-V24-EXIT-PROOF-0-001: exit 0 + valid reporter + required tests pass is proof-eligible', () => {
    const repoRoot = makeTempRoot('exit-0');
    initGitRepo(repoRoot);
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_exit0',
      'TEE-V24-EXIT-PROOF-0-001',
      { exitCode: 0 }
    );
    const eligible = verificationRunIsProofEligible({
      record: persisted.record,
      reporterRaw,
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      requiredIds: ['TEE-V24-EXIT-PROOF-0-001'],
    });
    expect(eligible.ok, eligible.ok ? '' : eligible.message).toBe(true);
    const proven = proveRequiredIdsAgainstCandidate({
      records: [persisted.record],
      requiredIds: ['TEE-V24-EXIT-PROOF-0-001'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_exit0',
    });
    expect(proven.ok, proven.ok ? '' : proven.message).toBe(true);
  });

  it('TEE-V24-EXIT-FAIL-TESTS-002: exit 1 + failed tests is rejected', () => {
    const repoRoot = makeTempRoot('exit-fail-tests');
    initGitRepo(repoRoot);
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_exit_fail',
      'TEE-V24-EXIT-FAIL-TESTS-002',
      { exitCode: 1, reporterSuccess: false, status: 'failed' }
    );
    expectNotProofEligible(
      repoRoot,
      'ws_exit_fail',
      persisted.record,
      reporterRaw,
      identity,
      'TEE-V24-EXIT-FAIL-TESTS-002'
    );
  });

  it('TEE-V24-EXIT-REPORTER-FAIL-003: exit 1 + reporter success false is rejected', () => {
    const repoRoot = makeTempRoot('exit-reporter-fail');
    initGitRepo(repoRoot);
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_exit_rep',
      'TEE-V24-EXIT-REPORTER-FAIL-003',
      { exitCode: 1, reporterSuccess: false, status: 'failed' }
    );
    const parsedFail = expectNotProofEligible(
      repoRoot,
      'ws_exit_rep',
      persisted.record,
      reporterRaw,
      identity,
      'TEE-V24-EXIT-REPORTER-FAIL-003'
    );
    expect(parsedFail.eligible.ok ? '' : parsedFail.eligible.message).toMatch(
      /reporter|failed tests|exitCode|proof-eligible/i
    );
  });

  it('TEE-V24-EXIT-REPORTER-MISSING-004: exit 1 + missing reporter is rejected', () => {
    const repoRoot = makeTempRoot('exit-missing-reporter');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const persisted = persistVerificationLedgerFromReporterFile({
      repoRoot,
      workstreamId: 'ws_exit_missing',
      commandId: 'missing',
      commandType: 'vitest_case',
      command: 'vitest',
      args: ['run'],
      cwd: repoRoot,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitCode: 1,
      runnerName: 'vitest',
      runnerVersion: '3.2.4',
      reporterAbsolutePath: path.join(repoRoot, 'does-not-exist.json'),
      requiredIds: ['TEE-V24-EXIT-REPORTER-MISSING-004'],
      persist: true,
      beforeIdentity: identity,
      afterIdentity: identity,
    });
    expect(persisted.ok).toBe(false);
    expect(persisted.ok ? '' : persisted.message).toMatch(/missing/i);
  });

  it('TEE-V24-EXIT-SUCCESS-LOOKING-005: exit 1 + successful-looking reporter is rejected unless trusted exception is proven', () => {
    const repoRoot = makeTempRoot('exit-success-looking');
    initGitRepo(repoRoot);
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_exit_look',
      'TEE-V24-EXIT-SUCCESS-LOOKING-005',
      { exitCode: 1, reporterSuccess: true, status: 'passed' }
    );
    expect(persisted.record.exitCode).toBe(1);
    expectNotProofEligible(
      repoRoot,
      'ws_exit_look',
      persisted.record,
      reporterRaw,
      identity,
      'TEE-V24-EXIT-SUCCESS-LOOKING-005'
    );
    expect(POST_REPORT_INFRASTRUCTURE_EXCEPTION_ENABLED).toBe(false);
  });

  it('TEE-V24-EXIT-NUMERIC-NOT-ENOUGH-006: a non-zero numeric exit is not proof merely because it is numeric', () => {
    expect(typeof 1 === 'number').toBe(true);
    expect(processOutcomeIsProofEligible({ exitCode: 1 }).ok).toBe(false);
    expect(processOutcomeIsProofEligible({ exitCode: Number.NaN }).ok).toBe(false);
    expect(processOutcomeIsProofEligible({ exitCode: 1.5 }).ok).toBe(false);
    expect(processOutcomeIsProofEligible({ exitCode: 0 }).ok).toBe(true);
  });

  it('TEE-V24-EXIT-CODE-2-007: exit 2 is rejected', () => {
    const repoRoot = makeTempRoot('exit-2');
    initGitRepo(repoRoot);
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_exit2',
      'TEE-V24-EXIT-CODE-2-007',
      { exitCode: 2, reporterSuccess: true }
    );
    expectNotProofEligible(
      repoRoot,
      'ws_exit2',
      persisted.record,
      reporterRaw,
      identity,
      'TEE-V24-EXIT-CODE-2-007'
    );
  });

  it('TEE-V24-EXIT-SIGNAL-008: signal/termination is rejected', () => {
    const repoRoot = makeTempRoot('exit-signal');
    initGitRepo(repoRoot);
    const classified = classifySpawnSyncTermination({
      status: null,
      signal: 'SIGTERM',
    });
    expect(classified.kind).toBe('signal');
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_signal',
      'TEE-V24-EXIT-SIGNAL-008',
      {
        exitCode: 1,
        reporterSuccess: true,
        processTermination: { kind: 'signal', exitCode: null, signal: 'SIGTERM' },
      }
    );
    expectNotProofEligible(
      repoRoot,
      'ws_signal',
      persisted.record,
      reporterRaw,
      identity,
      'TEE-V24-EXIT-SIGNAL-008'
    );
  });

  it('TEE-V24-EXIT-TIMEOUT-009: timeout is rejected', () => {
    const repoRoot = makeTempRoot('exit-timeout');
    initGitRepo(repoRoot);
    const classified = classifySpawnSyncTermination({
      status: null,
      signal: null,
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });
    expect(classified.kind).toBe('timeout');
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_timeout',
      'TEE-V24-EXIT-TIMEOUT-009',
      {
        exitCode: 1,
        reporterSuccess: true,
        processTermination: { kind: 'timeout', exitCode: null, signal: null },
      }
    );
    expectNotProofEligible(
      repoRoot,
      'ws_timeout',
      persisted.record,
      reporterRaw,
      identity,
      'TEE-V24-EXIT-TIMEOUT-009'
    );
  });

  it('TEE-V24-EXIT-SPAWN-010: spawn failure is rejected', () => {
    const repoRoot = makeTempRoot('exit-spawn');
    initGitRepo(repoRoot);
    const classified = classifySpawnSyncTermination({
      status: null,
      signal: null,
      error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    });
    expect(classified.kind).toBe('spawn_error');
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_spawn',
      'TEE-V24-EXIT-SPAWN-010',
      {
        exitCode: 1,
        reporterSuccess: true,
        processTermination: { kind: 'spawn_error', exitCode: null, signal: null },
      }
    );
    expectNotProofEligible(
      repoRoot,
      'ws_spawn',
      persisted.record,
      reporterRaw,
      identity,
      'TEE-V24-EXIT-SPAWN-010'
    );
  });

  it('TEE-V24-EXIT-TAMPER-REHASH-011: tampered reporter with rehashed ledger is rejected', () => {
    const repoRoot = makeTempRoot('exit-tamper');
    initGitRepo(repoRoot);
    const reference = persistFixtureLedger(repoRoot, 'ws_tamper', [
      'TEE-V24-EXIT-TAMPER-REHASH-011 genuine',
    ]);
    const record = reloadLedger(repoRoot, reference.relativePath);
    const reporterPath = path.join(repoRoot, reference.reporterRelativePath);
    const tamperedRaw = Buffer.from(
      JSON.stringify({
        success: true,
        testResults: [
          {
            name: path.join(repoRoot, 'forged.test.ts'),
            assertionResults: [
              {
                ancestorTitles: [],
                fullName: 'TEE-V24-EXIT-TAMPER-REHASH-011 genuine',
                title: 'TEE-V24-EXIT-TAMPER-REHASH-011 genuine',
                status: 'passed',
              },
            ],
          },
        ],
      })
    );
    const tamperedHash = createHash('sha256').update(tamperedRaw).digest('hex');
    const tamperedReporterPath = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      'ws_tamper',
      `verification-reporter-${tamperedHash}.json`
    );
    writeFileSync(tamperedReporterPath, tamperedRaw);
    const rehashed = rehashRecord({
      ...record,
      reporterOutputHash: tamperedHash,
    });
    writeFileSync(path.join(repoRoot, reference.relativePath), JSON.stringify(rehashed, null, 2));
    writeFileSync(reporterPath, tamperedRaw);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const validated = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId: 'ws_tamper',
      relativePath: reference.relativePath,
      expectedFingerprint: identity.productTreeFingerprint,
      expectedHeadCommit: identity.headCommit,
    });
    expect(validated.ok).toBe(false);
  });

  it('TEE-V24-EXIT-PROCESS-DRIFT-012: changing process exit after ledger creation is inconsistent', () => {
    const repoRoot = makeTempRoot('exit-drift');
    initGitRepo(repoRoot);
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_drift',
      'TEE-V24-EXIT-PROCESS-DRIFT-012',
      { exitCode: 0 }
    );
    const drifted = rehashRecord({
      ...persisted.record,
      exitCode: 1,
    });
    const eligible = verificationRunIsProofEligible({
      record: drifted,
      reporterRaw,
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      requiredIds: ['TEE-V24-EXIT-PROCESS-DRIFT-012'],
    });
    expect(eligible.ok).toBe(false);
    expect(eligible.ok ? '' : eligible.message).toMatch(
      /exitCode|processTermination|canonical body|proof-eligible|successful suite/i
    );
  });

  it('TEE-V24-EXIT-PREFLIGHT-013 / TEE-V24-EXIT-FIXDELTA-014 / TEE-V24-EXIT-REQUIRED-ID-015 / TEE-V24-EXIT-READINESS-016: proof consumers refuse non-proof-eligible ledgers', () => {
    const repoRoot = makeTempRoot('exit-consumers');
    const head = initGitRepo(repoRoot);
    const id = 'TEE-V24-EXIT-PREFLIGHT-013';
    const { identity, persisted } = persistProcessCase(repoRoot, 'ws_cons', id, {
      exitCode: 1,
      reporterSuccess: true,
    });
    const proven = proveRequiredIdsAgainstCandidate({
      records: [persisted.record],
      requiredIds: [id],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_cons',
    });
    expect(proven.ok).toBe(false);

    const preflight = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_cons',
      kind: 'preflight',
      baseCommit: head,
      requiredTestIds: [id],
      runChecks: false,
      verificationLedgerRefs: [persisted.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(preflight.manifest.requiredTests.find((test) => test.id === id)?.executed).toBe(false);

    const recomputed = recomputeManifestProvenIds({
      repoRoot,
      workstreamId: 'ws_cons',
      parsed: preflight.manifest as unknown as Record<string, unknown>,
    });
    expect(recomputed.ok).toBe(false);

    const fixDelta = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_cons',
      kind: 'fix-delta',
      baseCommit: head,
      requiredTestIds: [id],
      closedBlockerIds: [id],
      blockerEvidence: [{ blockerId: id, evidenceLabel: id }],
      runChecks: false,
      verificationLedgerRefs: [persisted.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(fixDelta.manifest.status).not.toBe('passed');

    expect(
      proveCanonicalWorkflowSuite({
        record: { ...persisted.record, commandType: 'vitest_suite' },
        reporterSuccess: true,
      }).ok
    ).toBe(false);
  });

  it('TEE-V24-EXIT-POST-REPORT-POS-017 / TEE-V24-EXIT-POST-REPORT-NEG-018: post-report exception is fail-closed', () => {
    expect(POST_REPORT_INFRASTRUCTURE_EXCEPTION_ENABLED).toBe(false);
    const repoRoot = makeTempRoot('exit-post-report');
    initGitRepo(repoRoot);
    const { identity, persisted, reporterRaw } = persistProcessCase(
      repoRoot,
      'ws_post',
      'TEE-V24-EXIT-POST-REPORT-POS-017',
      {
        exitCode: 1,
        reporterSuccess: true,
        processTermination: { kind: 'exit', exitCode: 1, signal: null },
      }
    );
    const positiveBoundary = verificationRunIsProofEligible({
      record: persisted.record,
      reporterRaw,
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      requiredIds: ['TEE-V24-EXIT-POST-REPORT-POS-017'],
    });
    expect(positiveBoundary.ok).toBe(false);
    const derived = deriveTrustedReporterExitCode({
      reporterRaw,
      processExitCode: 1,
    });
    expect(derived.ok && derived.exitCode).toBe(1);
    const negative = persistProcessCase(
      repoRoot,
      'ws_post_neg',
      'TEE-V24-EXIT-POST-REPORT-NEG-018',
      {
        exitCode: 1,
        reporterSuccess: false,
        status: 'failed',
        processTermination: { kind: 'exit', exitCode: 1, signal: null },
      }
    );
    expect(
      verificationRunIsProofEligible({
        record: negative.persisted.record,
        reporterRaw: negative.reporterRaw,
        expectedHeadCommit: negative.identity.headCommit,
        expectedFingerprint: negative.identity.productTreeFingerprint,
        requiredIds: ['TEE-V24-EXIT-POST-REPORT-NEG-018'],
      }).ok
    ).toBe(false);
  });
});
