import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertAuthenticLedgerProjection,
  captureVerificationIdentity,
  deriveTrustedReporterExitCode,
  hashVerificationLedgerBody,
  persistVerificationLedgerFromReporterFile,
  proveRequiredIdsAgainstCandidate,
  runVitestJsonAndPersistLedger,
} from '@/scripts/automation/workflow-verification-ledger';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  makeTempRoot,
  persistFixtureLedger,
} from '@/tests/unit/workflow-v24-test-harness';
import { assertSecurityMutationsFail } from '@/tests/unit/workflow-v24-mutation-helper';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

const INSTALL_ROOT = path.resolve(__dirname, '..', '..');

function reloadLedger(repoRoot: string, relativePath: string) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function rehashRecord(record: Record<string, unknown>) {
  const { contentHash: _ignored, ...body } = record;
  return {
    ...body,
    contentHash: hashVerificationLedgerBody(
      body as Parameters<typeof hashVerificationLedgerBody>[0]
    ),
  };
}

describe('TEE V2.4 verification ledger authenticity', () => {
  it('FD-VERIFY-UNTRUSTED-REHASH-004 / TEE-V24-LEDGER-AUTH-VALID-001: genuine reporter projection passes', () => {
    const repoRoot = makeTempRoot('ledger-auth-valid');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth', [
      'FD-VERIFY-UNTRUSTED-REHASH-004 genuine',
    ]);
    const record = reloadLedger(repoRoot, reference.relativePath);
    const reporterRaw = readFileSync(path.join(repoRoot, reference.reporterRelativePath));
    const authentic = assertAuthenticLedgerProjection({
      record,
      reporterRaw,
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
    });
    expect(authentic.ok, authentic.ok ? '' : authentic.message).toBe(true);
    const proven = proveRequiredIdsAgainstCandidate({
      records: [record],
      requiredIds: ['FD-VERIFY-UNTRUSTED-REHASH-004'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth',
    });
    expect(proven.ok, proven.ok ? '' : proven.message).toBe(true);
  });

  it('TEE-V24-LEDGER-AUTH-NO-REHASH-002: status change without rehash fails integrity', () => {
    const repoRoot = makeTempRoot('ledger-auth-norehash');
    initGitRepo(repoRoot);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth2', ['TEE-V24-LEDGER-AUTH-NO-REHASH-002']);
    const record = reloadLedger(repoRoot, reference.relativePath);
    record.executedTests[0].status = 'failed';
    const reporterRaw = readFileSync(path.join(repoRoot, reference.reporterRelativePath));
    const authentic = assertAuthenticLedgerProjection({ record, reporterRaw });
    expect(authentic.ok).toBe(false);
    expect(authentic.ok ? '' : authentic.message).toMatch(/contentHash|canonical body/i);
  });

  it('TEE-V24-LEDGER-AUTH-REHASH-003: status change plus recomputed contentHash still fails authenticity', () => {
    const repoRoot = makeTempRoot('ledger-auth-rehash');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth3', ['TEE-V24-LEDGER-AUTH-REHASH-003']);
    const record = reloadLedger(repoRoot, reference.relativePath);
    record.executedTests[0].status = 'failed';
    const forged = rehashRecord(record);
    const proven = proveRequiredIdsAgainstCandidate({
      records: [forged as never],
      requiredIds: ['TEE-V24-LEDGER-AUTH-REHASH-003'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth3',
    });
    expect(proven.ok).toBe(false);
    expect(proven.ok ? '' : proven.message).toMatch(/projection|authenticity|reporter/i);
  });

  it('TEE-V24-LEDGER-AUTH-ADD-004: add nonexistent executed test plus rehash fails', () => {
    const repoRoot = makeTempRoot('ledger-auth-add');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth4', ['TEE-V24-LEDGER-AUTH-ADD-004']);
    const record = reloadLedger(repoRoot, reference.relativePath);
    record.executedTests.push({
      canonicalId: 'GHOST-ID',
      file: 'ghost.test.ts',
      fullName: 'ghost',
      title: 'ghost',
      status: 'passed',
    });
    const proven = proveRequiredIdsAgainstCandidate({
      records: [rehashRecord(record) as never],
      requiredIds: ['TEE-V24-LEDGER-AUTH-ADD-004'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth4',
    });
    expect(proven.ok).toBe(false);
  });

  it('TEE-V24-LEDGER-AUTH-REMOVE-005: remove failed test plus rehash fails', () => {
    const repoRoot = makeTempRoot('ledger-auth-remove');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'status.test.ts'),
      `it('TEE-V24-LEDGER-AUTH-REMOVE-005 fails', () => { throw new Error('boom'); });\n`,
      'utf8'
    );
    const run = runVitestJsonAndPersistLedger({
      repoRoot,
      workstreamId: 'ws_auth5',
      commandId: 'status',
      commandType: 'vitest_case',
      files: ['status.test.ts'],
      requiredIds: ['TEE-V24-LEDGER-AUTH-REMOVE-005'],
      persist: true,
      vitestInstallRoot: INSTALL_ROOT,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);
    const record = { ...run.record, executedTests: [] };
    const proven = proveRequiredIdsAgainstCandidate({
      records: [rehashRecord(record) as never],
      requiredIds: ['TEE-V24-LEDGER-AUTH-REMOVE-005'],
      expectedHeadCommit: run.record.headCommit,
      expectedFingerprint: run.record.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth5',
    });
    expect(proven.ok).toBe(false);
  });

  it('TEE-V24-LEDGER-AUTH-SKIP-PASS-006: skipped turned into passed plus rehash fails', () => {
    const repoRoot = makeTempRoot('ledger-auth-skip');
    initGitRepo(repoRoot);
    const reference = persistFixtureLedger(
      repoRoot,
      'ws_auth6',
      ['TEE-V24-LEDGER-AUTH-SKIP-PASS-006'],
      { status: 'skipped' }
    );
    const record = reloadLedger(repoRoot, reference.relativePath);
    record.executedTests[0].status = 'passed';
    const reporterRaw = readFileSync(path.join(repoRoot, reference.reporterRelativePath));
    const authentic = assertAuthenticLedgerProjection({
      record: rehashRecord(record) as never,
      reporterRaw,
    });
    expect(authentic.ok).toBe(false);
  });

  it('TEE-V24-LEDGER-AUTH-RUNNER-007: replacing runner command metadata plus rehash fails proof reuse', () => {
    const repoRoot = makeTempRoot('ledger-auth-runner');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth7', ['TEE-V24-LEDGER-AUTH-RUNNER-007']);
    const record = reloadLedger(repoRoot, reference.relativePath);
    record.command = 'not-vitest';
    record.args = ['--forged'];
    const proven = proveRequiredIdsAgainstCandidate({
      records: [rehashRecord(record) as never],
      requiredIds: ['TEE-V24-LEDGER-AUTH-RUNNER-007'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth7',
    });
    expect(proven.ok).toBe(false);
    expect(proven.ok ? '' : proven.message).toMatch(/runner|command|trusted/i);
  });

  it('TEE-V24-LEDGER-AUTH-HEAD-008: candidate HEAD mismatch fails', () => {
    const repoRoot = makeTempRoot('ledger-auth-head');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth8', ['TEE-V24-LEDGER-AUTH-HEAD-008']);
    const record = reloadLedger(repoRoot, reference.relativePath);
    const proven = proveRequiredIdsAgainstCandidate({
      records: [record],
      requiredIds: ['TEE-V24-LEDGER-AUTH-HEAD-008'],
      expectedHeadCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth8',
    });
    expect(proven.ok).toBe(false);
    expect(proven.ok ? '' : proven.message).toMatch(/HEAD|candidate/i);
  });

  it('TEE-V24-LEDGER-AUTH-FINGERPRINT-009: product fingerprint mismatch fails', () => {
    const repoRoot = makeTempRoot('ledger-auth-fp');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth9', ['TEE-V24-LEDGER-AUTH-FINGERPRINT-009']);
    const record = reloadLedger(repoRoot, reference.relativePath);
    const proven = proveRequiredIdsAgainstCandidate({
      records: [record],
      requiredIds: ['TEE-V24-LEDGER-AUTH-FINGERPRINT-009'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: 'ab'.repeat(32),
      repoRoot,
      workstreamId: 'ws_auth9',
    });
    expect(proven.ok).toBe(false);
    expect(proven.ok ? '' : proven.message).toMatch(/fingerprint/i);
  });

  it('TEE-V24-LEDGER-AUTH-REPORTER-HASH-010: reporter artifact hash mismatch fails', () => {
    const repoRoot = makeTempRoot('ledger-auth-rhash');
    initGitRepo(repoRoot);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth10', [
      'TEE-V24-LEDGER-AUTH-REPORTER-HASH-010',
    ]);
    const record = reloadLedger(repoRoot, reference.relativePath);
    writeFileSync(path.join(repoRoot, reference.reporterRelativePath), '{"tampered":true}');
    const proven = proveRequiredIdsAgainstCandidate({
      records: [record],
      requiredIds: ['TEE-V24-LEDGER-AUTH-REPORTER-HASH-010'],
      expectedHeadCommit: record.headCommit,
      expectedFingerprint: record.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth10',
    });
    expect(proven.ok).toBe(false);
    expect(proven.ok ? '' : proven.message).toMatch(/reporter|hash/i);
  });

  it('TEE-V24-LEDGER-AUTH-ROWS-011: projection that does not correspond to reporter rows fails', () => {
    const repoRoot = makeTempRoot('ledger-auth-rows');
    initGitRepo(repoRoot);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth11', ['TEE-V24-LEDGER-AUTH-ROWS-011']);
    const record = reloadLedger(repoRoot, reference.relativePath);
    record.executedTests[0].title = 'different title';
    const reporterRaw = readFileSync(path.join(repoRoot, reference.reporterRelativePath));
    const authentic = assertAuthenticLedgerProjection({
      record: rehashRecord(record) as never,
      reporterRaw,
    });
    expect(authentic.ok).toBe(false);
    expect(authentic.ok ? '' : authentic.message).toMatch(/projection/i);
  });

  it('TEE-V24-LEDGER-AUTH-RELOAD-012: exact genuine persisted projection passes after reload', () => {
    const repoRoot = makeTempRoot('ledger-auth-reload');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth12', ['TEE-V24-LEDGER-AUTH-RELOAD-012']);
    const first = reloadLedger(repoRoot, reference.relativePath);
    const second = reloadLedger(repoRoot, reference.relativePath);
    expect(second.contentHash).toBe(first.contentHash);
    const proven = proveRequiredIdsAgainstCandidate({
      records: [second],
      requiredIds: ['TEE-V24-LEDGER-AUTH-RELOAD-012'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth12',
    });
    expect(proven.ok, proven.ok ? '' : proven.message).toBe(true);
  });

  it('TEE-V24-LEDGER-AUTH-MEMORY-013: arbitrary in-memory object cannot become proof by hashing itself', () => {
    const repoRoot = makeTempRoot('ledger-auth-memory');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const body = {
      schemaVersion: '1' as const,
      runId: 'memory',
      commandId: 'memory',
      commandType: 'vitest_case' as const,
      command: 'vitest',
      args: [],
      cwd: repoRoot,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitCode: 0,
      headCommit: identity.headCommit,
      productTreeFingerprint: identity.productTreeFingerprint,
      runnerName: 'vitest',
      runnerVersion: '3.2.4',
      reporterOutputHash: 'ab'.repeat(32),
      mappedRequiredIds: ['TEE-V24-LEDGER-AUTH-MEMORY-013'],
      executedTests: [
        {
          canonicalId: 'TEE-V24-LEDGER-AUTH-MEMORY-013',
          file: 'memory.test.ts',
          fullName: 'TEE-V24-LEDGER-AUTH-MEMORY-013',
          title: 'TEE-V24-LEDGER-AUTH-MEMORY-013',
          status: 'passed' as const,
        },
      ],
    };
    const record = { ...body, contentHash: hashVerificationLedgerBody(body) };
    const proven = proveRequiredIdsAgainstCandidate({
      records: [record],
      requiredIds: ['TEE-V24-LEDGER-AUTH-MEMORY-013'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
    });
    expect(proven.ok).toBe(false);
    expect(proven.ok ? '' : proven.message).toMatch(/untrusted|reporter/i);
  });

  it('TEE-V24-LEDGER-AUTH-DRYRUN-014: dry-run does not persist trusted proof artifacts', () => {
    const repoRoot = makeTempRoot('ledger-auth-dry');
    initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'ok.test.ts'), `it('dry', () => {});\n`, 'utf8');
    const run = runVitestJsonAndPersistLedger({
      repoRoot,
      workstreamId: 'ws_auth14',
      commandId: 'dry',
      commandType: 'vitest_case',
      files: ['ok.test.ts'],
      persist: false,
      vitestInstallRoot: INSTALL_ROOT,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.message);
    expect(run.reference.relativePath).toContain('verification-ledger-');
    const ledgerOnDisk = path.join(repoRoot, run.reference.relativePath);
    const reporterOnDisk = path.join(repoRoot, run.reference.reporterRelativePath);
    expect(() => readFileSync(ledgerOnDisk)).toThrow();
    expect(() => readFileSync(reporterOnDisk)).toThrow();
  });

  it('TEE-V24-LEDGER-AUTH-MUTATION-015: mutating ledger security fields fails authenticity', () => {
    const repoRoot = makeTempRoot('ledger-auth-mutation');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth15', [
      'TEE-V24-LEDGER-AUTH-MUTATION-015',
    ]);
    const record = reloadLedger(repoRoot, reference.relativePath);
    const reporterRaw = readFileSync(path.join(repoRoot, reference.reporterRelativePath));
    assertSecurityMutationsFail({
      valid: record,
      validate: (value) =>
        assertAuthenticLedgerProjection({
          record: rehashRecord(value) as never,
          reporterRaw,
          expectedHeadCommit: identity.headCommit,
          expectedFingerprint: identity.productTreeFingerprint,
        }),
      allow: ['startedAt', 'completedAt', 'runId'],
      fields: [
        {
          path: 'executedTests',
          mutate: (value) => ({
            ...value,
            executedTests: value.executedTests.map((test: { status: string }) => ({
              ...test,
              status: 'failed',
            })),
          }),
        },
        {
          path: 'headCommit',
          mutate: (value) => ({
            ...value,
            headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }),
        },
        {
          path: 'productTreeFingerprint',
          mutate: (value) => ({ ...value, productTreeFingerprint: 'ab'.repeat(32) }),
        },
        {
          path: 'reporterOutputHash',
          mutate: (value) => ({ ...value, reporterOutputHash: 'cd'.repeat(32) }),
        },
        {
          path: 'command',
          mutate: (value) => ({ ...value, command: 'not-vitest' }),
        },
        {
          path: 'exitCode',
          mutate: (value) => ({ ...value, exitCode: 1 }),
        },
        {
          path: 'schemaVersion',
          mutate: (value) => ({ ...value, schemaVersion: '9' }),
        },
      ],
    });
  });

  it('FD-VERIFY-EXIT-STATUS-001 / TEE-V24-LEDGER-AUTH-EXIT-016: process exit 1 cannot be laundered by reporter success', () => {
    const repoRoot = makeTempRoot('ledger-auth-exit');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const reference = persistFixtureLedger(repoRoot, 'ws_auth16', [
      'TEE-V24-LEDGER-AUTH-EXIT-016 genuine',
    ]);
    const reporterRaw = readFileSync(path.join(repoRoot, reference.reporterRelativePath));
    const derived = deriveTrustedReporterExitCode({
      reporterRaw,
      processExitCode: 1,
    });
    expect(derived.ok && derived.exitCode).toBe(1);
    const persisted = persistVerificationLedgerFromReporterFile({
      repoRoot,
      workstreamId: 'ws_auth16',
      commandId: 'exit-override',
      commandType: 'vitest_case',
      command: 'vitest',
      args: ['run'],
      cwd: repoRoot,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitCode: 1,
      runnerName: 'vitest',
      runnerVersion: '3.2.4',
      reporterAbsolutePath: path.join(repoRoot, reference.reporterRelativePath),
      requiredIds: ['TEE-V24-LEDGER-AUTH-EXIT-016'],
      persist: true,
      beforeIdentity: identity,
      afterIdentity: identity,
    });
    expect(persisted.ok, persisted.ok ? '' : persisted.message).toBe(true);
    if (!persisted.ok) throw new Error(persisted.message);
    expect(persisted.record.exitCode).toBe(1);
    const proven = proveRequiredIdsAgainstCandidate({
      records: [persisted.record],
      requiredIds: ['TEE-V24-LEDGER-AUTH-EXIT-016'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
      repoRoot,
      workstreamId: 'ws_auth16',
    });
    expect(proven.ok).toBe(false);
    expect(proven.ok ? '' : proven.message).toMatch(/proof-eligible|exitCode|successful suite/i);
    const failedReporter = {
      success: false,
      testResults: [
        {
          name: path.join(repoRoot, 'fail.test.ts'),
          assertionResults: [
            {
              ancestorTitles: [],
              fullName: 'failed',
              title: 'failed',
              status: 'failed',
            },
          ],
        },
      ],
    };
    const failedDerived = deriveTrustedReporterExitCode({
      reporterRaw: Buffer.from(JSON.stringify(failedReporter)),
      processExitCode: 0,
    });
    expect(failedDerived.ok && failedDerived.exitCode).toBe(0);
    expect(failedDerived.ok && failedDerived.processTermination).toEqual({
      kind: 'exit',
      exitCode: 0,
      signal: null,
    });
  });
});
