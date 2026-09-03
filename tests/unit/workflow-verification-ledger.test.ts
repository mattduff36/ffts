import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import {
  inspectCommitAncestry,
  isCommitAncestor,
  hashCanonicalEvidence,
  rejectUnreviewedHeadDrift,
  requireCommitNotAncestor,
  resolveExactCommitObject,
  type GitCommandResult,
  type GitCommandRunner,
} from '@/scripts/automation/workflow-v24-disposition';
import {
  BLOCKER_REQUIRED_TEST_IDS,
  captureVerificationIdentity,
  hashVerificationLedgerBody,
  loadCanonicalV24RequiredTestIds,
  persistVerificationLedgerFromReporterFile,
  proveCanonicalWorkflowSuite,
  proveRequiredIdsAgainstCandidate,
  provenVitestCaseIds,
  hashCanonicalWorkflowSuiteManifest,
  readAndValidateVerificationLedger,
  resolveVitestLedgerExtraArgs,
  runVitestJsonAndPersistLedger,
  titleContainsExactRequiredId,
  type CanonicalWorkflowSuiteManifest,
  type VerificationLedgerCommandType,
  type VerificationLedgerReference,
} from '@/scripts/automation/workflow-verification-ledger';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  git,
  initGitRepo,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

const INSTALL_ROOT = path.resolve(__dirname, '..', '..');
const FAKE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const COLLIDE_PREFIX = 'abcdef1';
const PRED_COLLIDE = `${COLLIDE_PREFIX}${'a'.repeat(33)}`;
const DESC_COLLIDE = `${COLLIDE_PREFIX}${'b'.repeat(33)}`;
const MALFORMED_COLLIDE = `${COLLIDE_PREFIX}${'z'.repeat(33)}`;

function verifySpec(args: string[]): string | null {
  if (args[0] !== 'rev-parse' || !args.includes('--verify')) return null;
  const spec = args[args.length - 1] ?? '';
  return spec.replace(/\^\{commit\}$/u, '');
}

function fixtureGit(params: {
  commits?: Record<string, string | GitCommandResult>;
  mergeBase?: GitCommandResult | ((pred: string, desc: string) => GitCommandResult);
  onMergeBase?: () => void;
}): { git: GitCommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitCommandRunner = (_root, args) => {
    calls.push([...args]);
    const spec = verifySpec(args);
    if (spec !== null) {
      const mapped = params.commits?.[spec];
      if (typeof mapped === 'string') return { status: 0, stdout: mapped, stderr: '' };
      if (mapped) return mapped;
      return {
        status: 128,
        stdout: '',
        stderr: `fatal: Not a valid object name ${spec}`,
      };
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      params.onMergeBase?.();
      if (typeof params.mergeBase === 'function') return params.mergeBase(args[2]!, args[3]!);
      if (params.mergeBase) return params.mergeBase;
      return { status: 2, stdout: '', stderr: 'unhandled merge-base' };
    }
    return { status: 128, stdout: '', stderr: `unhandled ${args.join(' ')}` };
  };
  return { git, calls };
}

afterEach(async () => {
  cleanupWorkflowV24Fixtures();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

function expectOk<T extends { ok: true } | { ok: false; message: string }>(
  result: T
): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(result.message);
  return result;
}

function writeVitestConfig(repoRoot: string): string {
  const configPath = path.join(repoRoot, 'vitest.config.mjs');
  writeFileSync(
    configPath,
    `export default { test: { include: ['**/*.test.ts'], globals: true, setupFiles: [] } };\n`,
    'utf8'
  );
  return configPath;
}

function persistSyntheticLedger(params: {
  repoRoot: string;
  workstreamId: string;
  titles: Array<{ title: string; status?: 'passed' | 'failed' | 'skipped' | 'todo'; file?: string }>;
  commandType?: VerificationLedgerCommandType;
  requiredIds?: string[];
  expectedSuiteManifestHash?: string;
  persist?: boolean;
}):
  | { ok: true; reference: VerificationLedgerReference; record: import('@/scripts/automation/workflow-verification-ledger').VerificationLedgerRecord }
  | { ok: false; message: string } {
  const identity = captureVerificationIdentity(params.repoRoot);
  if (!identity.ok) return identity;
  const byFile = new Map<string, typeof params.titles>();
  for (const row of params.titles) {
    const file = row.file ?? 'tests/unit/fixture.test.ts';
    const list = byFile.get(file) ?? [];
    list.push(row);
    byFile.set(file, list);
  }
  const reporter = {
    success: params.titles.every((row) => (row.status ?? 'passed') === 'passed'),
    testResults: [...byFile.entries()].map(([file, rows]) => ({
      name: path.join(params.repoRoot, file),
      assertionResults: rows.map((row) => ({
        ancestorTitles: [],
        fullName: row.title,
        title: row.title,
        status: row.status ?? 'passed',
      })),
    })),
  };
  const workstreamDir = path.join(
    params.repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    params.workstreamId
  );
  mkdirSync(workstreamDir, { recursive: true });
  const reporterPath = path.join(workstreamDir, `synthetic-reporter-${Date.now()}-${Math.random()}.json`);
  writeFileSync(reporterPath, JSON.stringify(reporter));
  return persistVerificationLedgerFromReporterFile({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    commandId: 'synthetic-ledger',
    commandType: params.commandType ?? 'vitest_case',
    command: 'vitest',
    args: ['run'],
    cwd: params.repoRoot,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: reporter.success ? 0 : 1,
    runnerName: 'vitest',
    runnerVersion: '3.2.4',
    reporterAbsolutePath: reporterPath,
    requiredIds: params.requiredIds ?? params.titles.map((row) => row.title),
    expectedSuiteManifestHash: params.expectedSuiteManifestHash,
    persist: params.persist,
    beforeIdentity: identity,
    afterIdentity: identity,
  });
}

function prepareLiveVitestRoot(repoRoot: string): string {
  writeFileSync(
    path.join(repoRoot, '.gitignore'),
    ['node_modules/', '.vitest/', '.vite/', 'coverage/', '*.timestamp-*'].join('\n') + '\n',
    'utf8'
  );
  return writeVitestConfig(repoRoot);
}

function runLiveVitest(params: {
  repoRoot: string;
  workstreamId: string;
  files: string[];
  requiredIds?: string[];
  commandType?: VerificationLedgerCommandType;
  extraArgs?: string[];
  persist?: boolean;
  expectedSuiteManifestHash?: string;
}) {
  const configPath = prepareLiveVitestRoot(params.repoRoot);
  return runVitestJsonAndPersistLedger({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    commandId: 'live-vitest',
    commandType: params.commandType ?? 'vitest_case',
    files: params.files,
    extraArgs: [
      '--config',
      configPath,
      '--root',
      params.repoRoot,
      ...(params.extraArgs ?? []),
    ],
    requiredIds: params.requiredIds,
    expectedSuiteManifestHash: params.expectedSuiteManifestHash,
    persist: params.persist,
    vitestInstallRoot: INSTALL_ROOT,
  });
}

describe('TEE V2.4 verification ledger', { timeout: 90_000 }, () => {
  it('TEE-V24-VERIFY-MANIFEST-001 / FD-VERIFY-REQUIRED-001: canonical required IDs are enumerated and candidate-bound', () => {
    const ids = loadCanonicalV24RequiredTestIds();
    expect(ids).toContain('TEE-V24-SPLIT-001');
    expect(ids).toContain('FD-LINEAGE-INIT-001');
    expect(ids).toContain('FD-GIT-C9-001');
    expect(ids).toContain('FD-VERIFY-REQUIRED-001');
    expect(ids).toContain('TEE-V24-REINIT-PLANPATH-001');
    expect(ids).toContain('TEE-V24-C9-FINISH-VALID-001');
    expect(ids).toContain('TEE-V24-SCOPE-001');
    expect(ids).toContain('FD-LINEAGE-BOUND-MALFORMED-002');
    expect(ids).toContain('FD-GIT-C9-STATE-LOSS-002');
    expect(ids).toContain('FD-GIT-C9-PREPUSH-003');
    expect(ids).toContain('FD-VERIFY-SCOPE-002');
    expect(ids).toContain('FD-VERIFY-UNTRUSTED-003');
    expect(ids).toContain('FD-LINEAGE-BOUND-INTEGRITY-004');
    expect(ids).toContain('FD-GIT-C9-PREPUSH-CONTEXT-SWAP-004');
    expect(ids).toContain('FD-VERIFY-SCOPE-INDEX-004');
    expect(ids).toContain('FD-VERIFY-UNTRUSTED-REHASH-004');
    expect(ids).toContain('FD-VERIFY-EXIT-STATUS-001');
    expect(ids).toContain('FD-C9-FINISH-ATOMICITY-004');
    const repoRoot = makeTempRoot('verify-bound');
    const head = initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const stale = proveRequiredIdsAgainstCandidate({
      records: [
        {
          schemaVersion: '1',
          runId: 'stale',
          commandId: 'stale',
          commandType: 'vitest_case',
          command: 'vitest',
          args: [],
          cwd: repoRoot,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          exitCode: 0,
          headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          productTreeFingerprint: identity.productTreeFingerprint,
          runnerName: 'vitest',
          runnerVersion: '3.2.4',
          reporterOutputHash: 'b'.repeat(64),
          mappedRequiredIds: ['TEE-V24-VERIFY-MANIFEST-001'],
          executedTests: [],
          contentHash: 'c'.repeat(64),
        },
      ],
      requiredIds: ['TEE-V24-VERIFY-MANIFEST-001'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
    });
    expect(stale.ok).toBe(false);
    expect(stale.ok ? '' : stale.message).toMatch(/not candidate|untrusted|reporter/i);
    expect(head).toBe(identity.headCommit);
  });

  it('FD-VERIFY-UNTRUSTED-003: forged in-memory ledger hashes are not candidate proof', () => {
    const repoRoot = makeTempRoot('verify-untrusted');
    initGitRepo(repoRoot);
    const identity = captureVerificationIdentity(repoRoot);
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error(identity.message);
    const forged = proveRequiredIdsAgainstCandidate({
      records: [
        {
          schemaVersion: '1',
          runId: 'forged',
          commandId: 'forged',
          commandType: 'vitest_case',
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
          reporterOutputHash: 'b'.repeat(64),
          mappedRequiredIds: ['FD-VERIFY-UNTRUSTED-003'],
          executedTests: [
            {
              file: 'forged.test.ts',
              fullName: 'FD-VERIFY-UNTRUSTED-003 forged',
              title: 'FD-VERIFY-UNTRUSTED-003 forged',
              status: 'passed',
              canonicalId: 'FD-VERIFY-UNTRUSTED-003',
            },
          ],
          contentHash: 'c'.repeat(64),
        },
      ],
      requiredIds: ['FD-VERIFY-UNTRUSTED-003'],
      expectedHeadCommit: identity.headCommit,
      expectedFingerprint: identity.productTreeFingerprint,
    });
    expect(forged.ok).toBe(false);
    expect(forged.ok ? '' : forged.message).toMatch(/contentHash|canonical body|untrusted/i);
  });

  it('TEE-V24-LEDGER-001 / T-LEDGER-SRC-NOT-EXECUTED: source titles are not execution proof', () => {
    const repoRoot = makeTempRoot('src-not-run');
    initGitRepo(repoRoot);
    mkdirSync(path.join(repoRoot, 'tests', 'unit'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'tests', 'unit', 'present.test.ts'),
      `import { it } from 'vitest';\nit('TEE-V24-LEDGER-001 in source', () => {});\n`,
      'utf8'
    );
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_src',
      kind: 'preflight',
      baseCommit: git(repoRoot, ['rev-parse', 'HEAD']),
      requiredTestIds: ['TEE-V24-LEDGER-001'],
      runChecks: false,
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(built.manifest.requiredTests.find((test) => test.id === 'TEE-V24-LEDGER-001')?.executed).toBe(
      false
    );
    expect(built.manifest.status).toBe('failed');
  });

  it('T-LEDGER-FILTERED-NOT-PROVEN / T-LEDGER-EXACT-PASS-PROVEN: live Vitest proves only executed matches', () => {
    const repoRoot = makeTempRoot('live-filter');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'exact.test.ts'),
      `it('T-LEDGER-EXACT-PASS-PROVEN live', () => {});\n`,
      'utf8'
    );
    writeFileSync(
      path.join(repoRoot, 'filtered.test.ts'),
      `it('T-LEDGER-FILTERED-NOT-PROVEN live', () => {});\n`,
      'utf8'
    );
    const run = expectOk(
      runLiveVitest({
        repoRoot,
        workstreamId: 'ws_filter',
        files: ['exact.test.ts'],
        requiredIds: ['T-LEDGER-EXACT-PASS-PROVEN', 'T-LEDGER-FILTERED-NOT-PROVEN'],
      })
    );
    expect(run.record.executedTests.map((test) => test.title)).toEqual([
      'T-LEDGER-EXACT-PASS-PROVEN live',
    ]);
    const proof = provenVitestCaseIds({
      records: [run.record],
      requiredIds: ['T-LEDGER-EXACT-PASS-PROVEN', 'T-LEDGER-FILTERED-NOT-PROVEN'],
    });
    expect(proof.ok).toBe(true);
    expect(proof.provenIds).toEqual(['T-LEDGER-EXACT-PASS-PROVEN']);
  });

  it('T-LEDGER-SKIP-NOT-PROVEN / T-LEDGER-TODO-NOT-PROVEN / T-LEDGER-FAIL-NOT-PROVEN: non-pass statuses are not proof', () => {
    const repoRoot = makeTempRoot('live-status');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'status.test.ts'),
      `it.skip('T-LEDGER-SKIP-NOT-PROVEN skipped', () => {});
it.todo('T-LEDGER-TODO-NOT-PROVEN todo');
it('T-LEDGER-FAIL-NOT-PROVEN fails', () => { throw new Error('boom'); });
`,
      'utf8'
    );
    const run = expectOk(
      runLiveVitest({
      repoRoot,
      workstreamId: 'ws_status',
      files: ['status.test.ts'],
      requiredIds: [
        'T-LEDGER-SKIP-NOT-PROVEN',
        'T-LEDGER-TODO-NOT-PROVEN',
        'T-LEDGER-FAIL-NOT-PROVEN',
      ],
    })
    );
    const proof = provenVitestCaseIds({
      records: [run.record],
      requiredIds: [
        'T-LEDGER-SKIP-NOT-PROVEN',
        'T-LEDGER-TODO-NOT-PROVEN',
        'T-LEDGER-FAIL-NOT-PROVEN',
      ],
    });
    expect(proof.ok).toBe(true);
    expect(proof.provenIds).toEqual([]);
  });

  it('T-LEDGER-SIMILAR-TITLE-NO-CROSS: similar titles do not cross-map', () => {
    expect(titleContainsExactRequiredId('T-LEDGER-SIMILAR-TITLE-NO-CROSSING', 'T-LEDGER-SIMILAR-TITLE-NO-CROSS')).toBe(
      false
    );
    const repoRoot = makeTempRoot('similar');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'similar.test.ts'),
      `it('T-LEDGER-SIMILAR-TITLE-NO-CROSSING similar', () => {});\n`,
      'utf8'
    );
    const run = expectOk(
      runLiveVitest({
      repoRoot,
      workstreamId: 'ws_similar',
      files: ['similar.test.ts'],
      requiredIds: ['T-LEDGER-SIMILAR-TITLE-NO-CROSS'],
    })
    );
    const proof = provenVitestCaseIds({
      records: [run.record],
      requiredIds: ['T-LEDGER-SIMILAR-TITLE-NO-CROSS'],
    });
    expect(proof.provenIds).toEqual([]);
  });

  it('T-LEDGER-DUPLICATE-ID-FAIL-CLOSED: duplicate required IDs fail closed', () => {
    const repoRoot = makeTempRoot('dup');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'dup.test.ts'),
      `it('T-LEDGER-DUPLICATE-ID-FAIL-CLOSED first', () => {});
it('T-LEDGER-DUPLICATE-ID-FAIL-CLOSED second', () => {});
`,
      'utf8'
    );
    const run = runLiveVitest({
      repoRoot,
      workstreamId: 'ws_dup',
      files: ['dup.test.ts'],
      requiredIds: ['T-LEDGER-DUPLICATE-ID-FAIL-CLOSED'],
    });
    expect(run.ok).toBe(false);
    if (run.ok) {
      throw new Error(
        `duplicate ID should fail closed: ${JSON.stringify(run.record.executedTests)}`
      );
    }
    expect(run.message).toMatch(/multiple assertions|fail closed/i);
  });

  it('T-LEDGER-CHANGED-NOT-SUITE: changed-files ledgers cannot prove the canonical suite', () => {
    const repoRoot = makeTempRoot('changed-not-suite');
    initGitRepo(repoRoot);
    const manifest: CanonicalWorkflowSuiteManifest = {
      schemaVersion: '1',
      id: 'fixture-suite',
      files: ['a.test.ts'],
    };
    const persisted = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_changed',
      titles: [{ title: 'ok', file: 'a.test.ts' }],
      commandType: 'changed_files',
      requiredIds: [],
      expectedSuiteManifestHash: hashCanonicalWorkflowSuiteManifest(manifest),
    })
    );
    const proof = proveCanonicalWorkflowSuite({
      record: persisted.record,
      reporterSuccess: true,
      manifest,
    });
    expect(proof.ok).toBe(false);
  });

  it('T-LEDGER-PARTIAL-SUITE-NOT-PROVEN / T-LEDGER-FULL-SUITE-PROVEN / T-LEDGER-ZERO-TESTS-NOT-SUITE', () => {
    const repoRoot = makeTempRoot('suite');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'a.test.ts'),
      `it('suite a', () => {});\n`,
      'utf8'
    );
    writeFileSync(
      path.join(repoRoot, 'b.test.ts'),
      `it('suite b', () => {});\n`,
      'utf8'
    );
    const manifest: CanonicalWorkflowSuiteManifest = {
      schemaVersion: '1',
      id: 'fixture-suite',
      files: ['a.test.ts', 'b.test.ts'],
    };
    const expectedHash = hashCanonicalWorkflowSuiteManifest(manifest);

    const partial = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_suite',
      titles: [{ title: 'suite a', file: 'a.test.ts' }],
      commandType: 'vitest_suite',
      requiredIds: [],
      expectedSuiteManifestHash: expectedHash,
    })
    );
    expect(
      proveCanonicalWorkflowSuite({
        record: partial.record,
        reporterSuccess: true,
        manifest,
      }).ok
    ).toBe(false);

    const full = expectOk(
      runLiveVitest({
      repoRoot,
      workstreamId: 'ws_suite',
      files: ['a.test.ts', 'b.test.ts'],
      commandType: 'vitest_suite',
      requiredIds: [],
      expectedSuiteManifestHash: expectedHash,
    })
    );
    const suiteProof = proveCanonicalWorkflowSuite({
      record: full.record,
      reporterSuccess: full.reporterSuccess,
      manifest,
    });
    expect(suiteProof.ok, JSON.stringify({
      files: full.record.executedTests.map((test) => test.file),
      hash: full.record.expectedSuiteManifestHash,
      expectedHash,
      reporterSuccess: full.reporterSuccess,
      commandType: full.record.commandType,
      exitCode: full.record.exitCode,
      message: suiteProof.ok ? null : suiteProof.message,
    })).toBe(true);

    const zero = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_suite',
      titles: [],
      commandType: 'vitest_suite',
      requiredIds: [],
      expectedSuiteManifestHash: expectedHash,
    })
    );
    expect(
      proveCanonicalWorkflowSuite({
        record: zero.record,
        reporterSuccess: true,
        manifest,
      }).ok
    ).toBe(false);
  });

  it('T-FIXDELTA-NO-LEDGER / T-FIXDELTA-UNRELATED-TESTS / T-FIXDELTA-VALID-LEDGER', () => {
    const repoRoot = makeTempRoot('fixdelta');
    const head = initGitRepo(repoRoot);
    const noLedger = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['A'],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(noLedger.manifest.status).toBe('failed');

    const unrelated = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_fix',
      titles: [{ title: 'OTHER-ID unrelated' }],
      requiredIds: ['OTHER-ID'],
    })
    );
    const unrelatedManifest = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['A'],
      verificationLedgerRefs: [unrelated.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(unrelatedManifest.manifest.status).toBe('failed');

    const valid = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_fix',
      titles: [{ title: 'A proven' }],
      requiredIds: ['A'],
    })
    );
    const validManifest = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['A'],
      blockerEvidence: [{ blockerId: 'A', evidenceLabel: 'targeted:A', commandName: 'fixture' }],
      verificationLedgerRefs: [valid.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(validManifest.manifest.status).toBe('passed');
    expect(validManifest.manifest.closedBlockerIds).toEqual(['A']);
  });

  it('T-FIXDELTA-WRONG-FINGERPRINT / T-FIXDELTA-STALE-AFTER-CHANGE / T-FIXDELTA-TAMPER-HASH', () => {
    const repoRoot = makeTempRoot('stale');
    initGitRepo(repoRoot);
    const persisted = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_stale',
      titles: [{ title: 'A proven' }],
      requiredIds: ['A'],
    })
    );

    const wrong = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId: 'ws_stale',
      relativePath: persisted.reference.relativePath,
      expectedFingerprint: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      expectedHeadCommit: git(repoRoot, ['rev-parse', 'HEAD']),
    });
    expect(wrong.ok).toBe(false);

    commitFile(repoRoot, 'changed.ts', 'stale after change');
    const stale = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_stale',
      kind: 'fix-delta',
      baseCommit: git(repoRoot, ['rev-parse', 'HEAD']),
      runChecks: false,
      closedBlockerIds: ['A'],
      verificationLedgerRefs: [persisted.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(stale.manifest.status).toBe('failed');

    const ledgerPath = path.join(repoRoot, persisted.reference.relativePath);
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { contentHash: string; runId: string };
    parsed.runId = 'tampered';
    writeFileSync(ledgerPath, JSON.stringify(parsed));
    const tampered = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId: 'ws_stale',
      relativePath: persisted.reference.relativePath,
      expectedFingerprint: persisted.record.productTreeFingerprint,
      expectedHeadCommit: persisted.record.headCommit,
    });
    expect(tampered.ok).toBe(false);
  });

  it('TEE-V24-GIT-001 / T-DRIFT-GIT-THROW / T-DRIFT-SPAWN-FAILURE / T-DRIFT-GIT-NONZERO / T-DRIFT-GIT-MALFORMED / T-DRIFT-GIT-SUCCESS / T-DRIFT-ANCESTOR-REJECTS-ISOLATION / T-DRIFT-NON-ANCESTOR-ISOLATION-OK / T-DRIFT-EXIT-1-BOTH-VERIFIED', () => {
    const throwing: GitCommandRunner = () => {
      throw new Error('spawn failed');
    };
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, throwing).status).toBe('error');
    expect(() => isCommitAncestor('.', FAKE_A, FAKE_B, throwing)).toThrow(/spawn failed/);
    const thrown = rejectUnreviewedHeadDrift('.', FAKE_A, FAKE_B, throwing);
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.kind).toBe('git-error');
    expect(requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', throwing).ok).toBe(false);

    const nonzero: GitCommandRunner = () => ({
      status: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, nonzero).status).toBe('error');
    const nonzeroDrift = rejectUnreviewedHeadDrift('.', FAKE_A, FAKE_B, nonzero);
    expect(nonzeroDrift.ok).toBe(false);
    if (!nonzeroDrift.ok) expect(nonzeroDrift.kind).toBe('git-error');

    const malformed: GitCommandRunner = () => ({
      status: 1,
      stdout: '',
      stderr: 'fatal: Not a valid object name',
    });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, malformed).status).toBe('error');

    let mergeBaseCalls = 0;
    const ancestor = fixtureGit({
      commits: { [FAKE_A]: FAKE_A, [FAKE_B]: FAKE_B },
      mergeBase: { status: 0, stdout: '', stderr: '' },
      onMergeBase: () => {
        mergeBaseCalls += 1;
      },
    });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, ancestor.git).status).toBe('ancestor');
    expect(requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', ancestor.git).ok).toBe(false);
    expect(mergeBaseCalls).toBeGreaterThan(0);

    const notAncestor = fixtureGit({
      commits: { [FAKE_A]: FAKE_A, [FAKE_B]: FAKE_B },
      mergeBase: { status: 1, stdout: '', stderr: '' },
    });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, notAncestor.git).status).toBe('not_ancestor');
    expect(requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', notAncestor.git).ok).toBe(
      true
    );

    const missingHead = rejectUnreviewedHeadDrift('.', FAKE_A, null);
    expect(missingHead.ok).toBe(false);
    if (!missingHead.ok) expect(missingHead.kind).toBe('git-error');

    const repoRoot = makeTempRoot('drift-success');
    const first = initGitRepo(repoRoot);
    const second = commitFile(repoRoot, 'extra.ts', 'extra');
    expect(inspectCommitAncestry(repoRoot, first, second).status).toBe('ancestor');
    expect(inspectCommitAncestry(repoRoot, second, first).status).toBe('not_ancestor');
    expect(requireCommitNotAncestor(repoRoot, first, second, 'not isolated').ok).toBe(false);
    expect(requireCommitNotAncestor(repoRoot, second, first, 'not isolated').ok).toBe(true);
    const same = rejectUnreviewedHeadDrift(repoRoot, second, second);
    expect(same.ok).toBe(true);
    const extras = rejectUnreviewedHeadDrift(repoRoot, first, second);
    expect(extras.ok).toBe(false);
    if (!extras.ok) expect(extras.kind).toBe('unreviewed-implementation');
    const unrelated = rejectUnreviewedHeadDrift(repoRoot, second, first);
    expect(unrelated.ok).toBe(true);
  });

  it('T-LEDGER-FORGED-PROJECTION: forged executedTests that still hash cannot prove a required ID', () => {
    const repoRoot = makeTempRoot('forged-projection');
    initGitRepo(repoRoot);
    const persisted = expectOk(
      persistSyntheticLedger({
        repoRoot,
        workstreamId: 'ws_forged',
        titles: [{ title: 'UNRELATED-ID only' }],
        requiredIds: ['UNRELATED-ID'],
      })
    );
    const ledgerPath = path.join(repoRoot, persisted.reference.relativePath);
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
      contentHash: string;
      executedTests: Array<Record<string, unknown>>;
      mappedRequiredIds: string[];
    };
    const { contentHash: _ignored, ...body } = parsed as typeof parsed & Record<string, unknown>;
    const forgedBody = {
      ...body,
      mappedRequiredIds: ['A'],
      executedTests: [
        {
          canonicalId: 'A',
          file: 'tests/unit/fixture.test.ts',
          fullName: 'A forged',
          title: 'A forged',
          status: 'passed',
        },
      ],
    };
    const forgedHash = hashVerificationLedgerBody(
      forgedBody as Parameters<typeof hashVerificationLedgerBody>[0]
    );
    const forgedPath = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      'ws_forged',
      `verification-ledger-${forgedHash}.json`
    );
    writeFileSync(forgedPath, JSON.stringify({ ...forgedBody, contentHash: forgedHash }));
    const validated = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId: 'ws_forged',
      relativePath: path.relative(repoRoot, forgedPath).replace(/\\/g, '/'),
      expectedFingerprint: persisted.record.productTreeFingerprint,
      expectedHeadCommit: persisted.record.headCommit,
    });
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.message).toMatch(/reporter projection/i);
    }
  });

  it('T-TYPECHECK-NAME-ONLY-NOT-PROVEN / T-LINT-NAME-ONLY-NOT-PROVEN: name-only commands without exact argv do not prove', () => {
    const repoRoot = makeTempRoot('exact-argv');
    const head = initGitRepo(repoRoot);
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_exact',
      kind: 'preflight',
      baseCommit: head,
      requiredTestIds: ['T-TYPECHECK', 'T-LINT'],
      runChecks: false,
      commandResults: [
        { name: 'typecheck', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
        { name: 'oxlint-changed', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
        { name: 'eslint-changed', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(built.manifest.requiredTests.find((test) => test.id === 'T-TYPECHECK')?.executed).toBe(
      false
    );
    expect(built.manifest.requiredTests.find((test) => test.id === 'T-LINT')?.executed).toBe(false);
    expect(built.manifest.status).toBe('failed');
  });

  it('T-DRIFT-DESCENDANT-MISSING-NOT-ISOLATION / T-DRIFT-PREDECESSOR-MISSING-ISOLATION: missing objects fail closed, never isolation', () => {
    const descendantMissing = fixtureGit({
      commits: { [FAKE_A]: FAKE_A },
    });
    const isolated = requireCommitNotAncestor(
      '.',
      FAKE_A,
      FAKE_B,
      'not isolated',
      descendantMissing.git
    );
    expect(isolated.ok).toBe(false);
    expect(descendantMissing.calls.some((args) => args[0] === 'merge-base')).toBe(false);

    const predecessorMissing = fixtureGit({
      commits: { [FAKE_B]: FAKE_B },
    });
    const predecessor = requireCommitNotAncestor(
      '.',
      FAKE_A,
      FAKE_B,
      'not isolated',
      predecessorMissing.git
    );
    expect(predecessor.ok).toBe(false);
    expect(predecessorMissing.calls.some((args) => args[0] === 'merge-base')).toBe(false);

    const repoRoot = makeTempRoot('drift-real-collide');
    const pred = initGitRepo(repoRoot);
    const prefix = pred.slice(0, 7).toLowerCase();
    const missingDesc = `${prefix}${'c'.repeat(33)}`;
    const missingPred = `${prefix}${'d'.repeat(33)}`;
    expect(missingDesc).toHaveLength(40);
    expect(missingPred).toHaveLength(40);
    expect(resolveExactCommitObject(repoRoot, pred).ok).toBe(true);
    expect(resolveExactCommitObject(repoRoot, missingDesc).ok).toBe(false);
    expect(resolveExactCommitObject(repoRoot, missingPred).ok).toBe(false);
    const gitMissing = spawnSync('git', ['rev-parse', '--verify', `${missingDesc}^{commit}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(gitMissing.status).not.toBe(0);
    const realMissingDesc = requireCommitNotAncestor(repoRoot, pred, missingDesc, 'not isolated');
    expect(realMissingDesc.ok).toBe(false);
    const realMissingPred = requireCommitNotAncestor(repoRoot, missingPred, pred, 'not isolated');
    expect(realMissingPred.ok).toBe(false);
  });

  it('T-DRIFT-COLLIDING-PREFIX-MISSING-DESCENDANT / T-DRIFT-COLLIDING-PREFIX-MISSING-PREDECESSOR / T-DRIFT-BOTH-MISSING-SAME-PREFIX / T-DRIFT-MALFORMED-SAME-PREFIX', () => {
    const missingDesc = fixtureGit({
      commits: { [PRED_COLLIDE]: PRED_COLLIDE },
    });
    const descResult = requireCommitNotAncestor(
      '.',
      PRED_COLLIDE,
      DESC_COLLIDE,
      'not isolated',
      missingDesc.git
    );
    expect(descResult.ok).toBe(false);
    expect(missingDesc.calls.some((args) => args[0] === 'merge-base')).toBe(false);
    const descVerify = missingDesc.calls.find((args) => verifySpec(args) === DESC_COLLIDE);
    expect(descVerify).toBeTruthy();

    const missingPred = fixtureGit({
      commits: { [DESC_COLLIDE]: DESC_COLLIDE },
    });
    const predResult = requireCommitNotAncestor(
      '.',
      PRED_COLLIDE,
      DESC_COLLIDE,
      'not isolated',
      missingPred.git
    );
    expect(predResult.ok).toBe(false);
    expect(missingPred.calls.some((args) => args[0] === 'merge-base')).toBe(false);

    const bothMissing = fixtureGit({ commits: {} });
    const both = requireCommitNotAncestor(
      '.',
      PRED_COLLIDE,
      DESC_COLLIDE,
      'not isolated',
      bothMissing.git
    );
    expect(both.ok).toBe(false);
    expect(bothMissing.calls.some((args) => args[0] === 'merge-base')).toBe(false);

    const malformed = requireCommitNotAncestor('.', MALFORMED_COLLIDE, DESC_COLLIDE, 'not isolated');
    expect(malformed.ok).toBe(false);
    expect(malformed.ok === false && malformed.message).toMatch(/malformed commit identity/i);
  });

  it('T-DRIFT-AMBIGUOUS-SHA / T-DRIFT-NON-COMMIT-OBJECT / T-DRIFT-MERGE-BASE-EXIT-2 / T-DRIFT-TIMEOUT / T-DRIFT-UNEXPECTED-SIGNAL', () => {
    const ambiguous = fixtureGit({
      commits: {
        abcdef1: {
          status: 128,
          stdout: '',
          stderr: 'error: short SHA1 abcdef1 is ambiguous',
        },
        [FAKE_B]: FAKE_B,
      },
    });
    expect(requireCommitNotAncestor('.', 'abcdef1', FAKE_B, 'not isolated', ambiguous.git).ok).toBe(
      false
    );
    expect(ambiguous.calls.some((args) => args[0] === 'merge-base')).toBe(false);

    const repoRoot = makeTempRoot('non-commit');
    initGitRepo(repoRoot);
    writeFileSync(path.join(repoRoot, 'blob.txt'), 'payload');
    const blob = git(repoRoot, ['hash-object', '-w', 'blob.txt']);
    expect(blob).toMatch(/^[0-9a-f]{40}$/i);
    expect(resolveExactCommitObject(repoRoot, blob).ok).toBe(false);
    expect(requireCommitNotAncestor(repoRoot, blob, git(repoRoot, ['rev-parse', 'HEAD']), 'not isolated').ok).toBe(
      false
    );

    const exitTwo = fixtureGit({
      commits: { [FAKE_A]: FAKE_A, [FAKE_B]: FAKE_B },
      mergeBase: { status: 2, stdout: '', stderr: 'fatal: Not a valid commit name abcdef1' },
    });
    expect(requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', exitTwo.git).ok).toBe(false);

    const timeout = fixtureGit({
      commits: {
        [FAKE_A]: { status: null, stdout: '', stderr: '', timedOut: true, error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }) },
        [FAKE_B]: FAKE_B,
      },
    });
    expect(requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', timeout.git).ok).toBe(false);

    const signaled = fixtureGit({
      commits: {
        [FAKE_A]: { status: null, stdout: '', stderr: '', signal: 'SIGTERM' },
        [FAKE_B]: FAKE_B,
      },
    });
    expect(requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', signaled.git).ok).toBe(false);
  });

  it('T-DRIFT-STDERR-CONTAINS-SHA-STILL-ERROR / T-DRIFT-STDERR-EMPTY-STILL-ERROR / T-DRIFT-FULL-SHA-IN-EVIDENCE / T-DRIFT-ABBREV-DISPLAY-DOES-NOT-DECIDE', () => {
    const stderrSha = fixtureGit({
      commits: { [PRED_COLLIDE]: PRED_COLLIDE, [FAKE_B]: FAKE_B },
      mergeBase: {
        status: 128,
        stdout: '',
        stderr: `fatal: Not a valid object name ${PRED_COLLIDE}`,
      },
    });
    expect(requireCommitNotAncestor('.', PRED_COLLIDE, FAKE_B, 'not isolated', stderrSha.git).ok).toBe(
      false
    );

    const emptyStderr = fixtureGit({
      commits: { [FAKE_A]: FAKE_A, [FAKE_B]: FAKE_B },
      mergeBase: { status: 128, stdout: '', stderr: '' },
    });
    expect(requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', emptyStderr.git).ok).toBe(
      false
    );

    const abbrev = COLLIDE_PREFIX;
    const recorded: string[][] = [];
    const fullShaGit = fixtureGit({
      commits: { [abbrev]: PRED_COLLIDE, [PRED_COLLIDE]: PRED_COLLIDE, [FAKE_B]: FAKE_B },
      mergeBase: (pred, desc) => {
        recorded.push([pred, desc]);
        return { status: 1, stdout: '', stderr: abbrev };
      },
    });
    const isolated = requireCommitNotAncestor('.', abbrev, FAKE_B, 'not isolated', fullShaGit.git);
    expect(isolated.ok).toBe(true);
    expect(recorded).toEqual([[PRED_COLLIDE, FAKE_B]]);
    expect(resolveExactCommitObject('.', abbrev, fullShaGit.git)).toEqual({
      ok: true,
      sha: PRED_COLLIDE,
    });
    expect(hashCanonicalEvidence({ predecessorHead: PRED_COLLIDE })).not.toBe(
      hashCanonicalEvidence({ predecessorHead: abbrev })
    );
    expect(PRED_COLLIDE).toHaveLength(40);
    expect(abbrev).toHaveLength(7);
  });

  it('mapped blocker IDs require the registered ledger tests, not the blocker token', () => {
    expect(BLOCKER_REQUIRED_TEST_IDS['FD-LEDGER-PROVER-001']?.length).toBeGreaterThan(1);
    const repoRoot = makeTempRoot('mapped');
    const head = initGitRepo(repoRoot);
    const onlyBlockerToken = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_mapped',
      titles: [{ title: 'FD-LEDGER-PROVER-001 token' }],
      requiredIds: ['FD-LEDGER-PROVER-001'],
    })
    );
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_mapped',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['FD-LEDGER-PROVER-001'],
      verificationLedgerRefs: [onlyBlockerToken.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(built.manifest.status).toBe('failed');
  });

  it('does not repeat canonical suite flags that crash Vitest cac when duplicated', () => {
    const duplicated = resolveVitestLedgerExtraArgs('vitest_suite', [
      '--testTimeout=120000',
      '--maxWorkers=1',
      '--no-file-parallelism',
      '--pool=threads',
      '--poolOptions.threads.singleThread=true',
    ]);
    expect(
      duplicated.filter((arg) => arg === '--poolOptions.threads.singleThread=true')
    ).toHaveLength(1);
    expect(duplicated.filter((arg) => arg.startsWith('--maxWorkers'))).toHaveLength(1);
    expect(resolveVitestLedgerExtraArgs('vitest_suite', [])).toEqual(
      expect.arrayContaining(['--pool=threads', '--poolOptions.threads.singleThread=true'])
    );
  });
});
