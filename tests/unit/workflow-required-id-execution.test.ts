import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import {
  createPreflightWorkflowStages,
  formatProgressRecord,
} from '@/scripts/automation/workflow-verify-progress';
import {
  captureVerificationIdentity,
  readAndValidateVerificationLedger,
} from '@/scripts/automation/workflow-verification-ledger';
import {
  discoverRequiredIdOwners,
  leftoverRequiredCaseIds,
  leftoverVitestRunOptions,
  proveAndExecuteLeftoverRequiredIds,
  runLeftoverRequiredIdStage,
  selectLeftoverExecutionMode,
  type LeftoverVitestRunner,
} from '@/scripts/automation/workflow-required-id-execution';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  makeTempRoot,
  persistFixtureLedger,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function writeOwnedTest(repoRoot: string, relativePath: string, ids: string[]): void {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(
    absolute,
    `import { describe, expect, it } from 'vitest';\n\ndescribe('${relativePath}', () => {\n${ids
      .map((id) => `  it('${id}: leftover owner', () => {\n    expect(true).toBe(true);\n  });\n`)
      .join('')}});\n`,
    'utf8'
  );
}

function commitTree(repoRoot: string, message: string): string {
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'], {
    cwd: repoRoot,
    shell: false,
  });
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message],
    { cwd: repoRoot, shell: false }
  );
  return spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  }).stdout.trim();
}

function identityOf(repoRoot: string): { headCommit: string; fingerprint: string } {
  const identity = captureVerificationIdentity(repoRoot);
  expect(identity.ok).toBe(true);
  if (!identity.ok) throw new Error(identity.message);
  return { headCommit: identity.headCommit, fingerprint: identity.productTreeFingerprint };
}

function passingRunner(
  repoRoot: string,
  workstreamId: string,
  calls: Array<{ files: string[]; requiredIds: string[] }>,
  options: {
    spawnFail?: boolean;
    omitIds?: boolean;
    failTests?: boolean;
    wrongFingerprint?: boolean;
    delayMs?: number;
    onStart?: () => void;
    onEnd?: () => void;
  } = {}
): LeftoverVitestRunner {
  return async (params) => {
    options.onStart?.();
    calls.push({ files: [...params.files], requiredIds: [...params.requiredIds] });
    if (options.delayMs) {
      await new Promise((resolve) => {
        setTimeout(resolve, options.delayMs);
      });
    }
    options.onEnd?.();
    if (options.spawnFail) {
      return { ok: false, message: 'vitest spawn failed: ENOENT' };
    }
    const titles = options.omitIds ? ['UNRELATED-TITLE'] : params.requiredIds;
    const reference = persistFixtureLedger(repoRoot, workstreamId, titles, {
      file: params.files[0],
      status: options.failTests ? 'failed' : 'passed',
    });
    const identity = identityOf(repoRoot);
    const validated = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId,
      relativePath: reference.relativePath,
      expectedFingerprint: identity.fingerprint,
      expectedHeadCommit: identity.headCommit,
    });
    if (!validated.ok) return validated;
    return {
      ok: true,
      record: options.wrongFingerprint
        ? { ...validated.record, productTreeFingerprint: '0'.repeat(64) }
        : validated.record,
      reference,
    };
  };
}

describe('required-ID leftover execution', () => {
  it('RID-LEFTOVER-NONE-001: no leftover IDs launch no product-test process', async () => {
    const repoRoot = makeTempRoot('none');
    initGitRepo(repoRoot);
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const candidate = identityOf(repoRoot);
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_none',
      requiredIds: ['SUITE-ID-001'],
      completedIds: ['SUITE-ID-001'],
      candidate,
      jobs: 3,
      runner: passingRunner(repoRoot, 'ws_leftover_none', calls),
    });
    expect(result.ok).toBe(true);
    expect(result.launchedProcess).toBe(false);
    expect(result.leftoverIds).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('RID-LEFTOVER-EXEC-002: required IDs outside the workflow suite execute and complete', async () => {
    const repoRoot = makeTempRoot('exec');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/suite-fake.test.ts', ['SUITE-ID-001']);
    writeOwnedTest(repoRoot, 'tests/unit/product-a.test.ts', ['RID-LEFTOVER-OWN-001']);
    commitTree(repoRoot, 'tests');
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const candidate = identityOf(repoRoot);
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_exec',
      requiredIds: ['SUITE-ID-001', 'RID-LEFTOVER-OWN-001'],
      completedIds: ['SUITE-ID-001'],
      candidate,
      jobs: 1,
      canonicalSuiteFiles: ['tests/unit/suite-fake.test.ts'],
      runner: passingRunner(repoRoot, 'ws_leftover_exec', calls),
    });
    expect(result.ok).toBe(true);
    expect(result.launchedProcess).toBe(true);
    expect(result.completedIds).toEqual(['RID-LEFTOVER-OWN-001']);
    expect(calls.map((row) => row.files)).toEqual([['tests/unit/product-a.test.ts']]);
  });

  it('RID-LEFTOVER-MIN-003: unrelated trusted product files are not executed', async () => {
    const repoRoot = makeTempRoot('min');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/needed.test.ts', ['RID-LEFTOVER-MIN-001']);
    writeOwnedTest(repoRoot, 'tests/unit/unrelated.test.ts', ['OTHER-PRODUCT-009']);
    commitTree(repoRoot, 'tests');
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_min',
      requiredIds: ['RID-LEFTOVER-MIN-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_min', calls),
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.files).toEqual(['tests/unit/needed.test.ts']);
    expect(calls.some((row) => row.files.includes('tests/unit/unrelated.test.ts'))).toBe(false);
  });

  it('RID-LEFTOVER-MISS-004: missing trusted owner fails closed', async () => {
    const repoRoot = makeTempRoot('miss');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'app/hidden.test.ts', ['RID-LEFTOVER-MISS-001']);
    commitTree(repoRoot, 'untrusted');
    const discovered = discoverRequiredIdOwners({
      repoRoot,
      ids: ['RID-LEFTOVER-MISS-001'],
    });
    expect(discovered.ok).toBe(false);
    if (!discovered.ok) {
      expect(discovered.code).toBe('missing_owner');
    }
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_miss',
      requiredIds: ['RID-LEFTOVER-MISS-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      runner: passingRunner(repoRoot, 'ws_leftover_miss', calls),
    });
    expect(result.ok).toBe(false);
    expect(result.launchedProcess).toBe(false);
    expect(result.message).toMatch(/no trusted test owner/);
    expect(calls).toEqual([]);
  });

  it('RID-LEFTOVER-SOURCE-005: source presence alone cannot complete an ID', async () => {
    const repoRoot = makeTempRoot('source');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/present.test.ts', ['RID-LEFTOVER-SOURCE-001']);
    commitTree(repoRoot, 'present');
    const discovered = discoverRequiredIdOwners({
      repoRoot,
      ids: ['RID-LEFTOVER-SOURCE-001'],
    });
    expect(discovered.ok).toBe(true);
    const leftover = leftoverRequiredCaseIds({
      requiredIds: ['RID-LEFTOVER-SOURCE-001'],
      completedIds: [],
    });
    expect(leftover).toEqual(['RID-LEFTOVER-SOURCE-001']);
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_source',
      requiredIds: ['RID-LEFTOVER-SOURCE-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_source', calls, { omitIds: true }),
    });
    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.completedIds).toEqual([]);
  });

  it('RID-LEFTOVER-FAIL-006: failing owning test leaves the ID incomplete', async () => {
    const repoRoot = makeTempRoot('fail');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/failing.test.ts', ['RID-LEFTOVER-FAIL-001']);
    commitTree(repoRoot, 'failing');
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_fail',
      requiredIds: ['RID-LEFTOVER-FAIL-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_fail', [], { failTests: true }),
    });
    expect(result.ok).toBe(false);
    expect(result.completedIds).toEqual([]);
    expect(result.command?.status).toBe('failed');
  });

  it('RID-LEFTOVER-AMBIG-007: duplicate ownership fails closed', () => {
    const repoRoot = makeTempRoot('ambig');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/one.test.ts', ['RID-LEFTOVER-AMBIG-001']);
    writeOwnedTest(repoRoot, 'tests/unit/two.test.ts', ['RID-LEFTOVER-AMBIG-001']);
    const discovered = discoverRequiredIdOwners({
      repoRoot,
      ids: ['RID-LEFTOVER-AMBIG-001'],
    });
    expect(discovered.ok).toBe(false);
    if (!discovered.ok) {
      expect(discovered.code).toBe('ambiguous_owner');
      expect(discovered.message).toMatch(/multiple assertions; fail closed/);
    }
  });

  it('RID-LEFTOVER-DRIFT-008: candidate drift rejects leftover evidence', async () => {
    const repoRoot = makeTempRoot('drift');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/drift.test.ts', ['RID-LEFTOVER-DRIFT-001']);
    commitTree(repoRoot, 'drift');
    const candidate = identityOf(repoRoot);
    let checks = 0;
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_drift',
      requiredIds: ['RID-LEFTOVER-DRIFT-001'],
      completedIds: [],
      candidate,
      jobs: 1,
      canonicalSuiteFiles: [],
      readCandidate: () => {
        checks += 1;
        return checks === 1 ? candidate : { drifted: true };
      },
      runner: passingRunner(repoRoot, 'ws_leftover_drift', []),
    });
    expect(result.ok).toBe(false);
    expect(result.completedIds).toEqual([]);
    expect(result.message).toMatch(/candidate drift/);
  });

  it('RID-LEFTOVER-BIND-009: wrong HEAD or fingerprint ledger is rejected', async () => {
    const repoRoot = makeTempRoot('bind');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/bind.test.ts', ['RID-LEFTOVER-BIND-001']);
    commitTree(repoRoot, 'bind');
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_bind',
      requiredIds: ['RID-LEFTOVER-BIND-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_bind', [], { wrongFingerprint: true }),
    });
    expect(result.ok).toBe(false);
    expect(result.completedIds).toEqual([]);
    expect(result.message).toMatch(/different HEAD or fingerprint/);
  });

  it('RID-LEFTOVER-SUITE-010: workflow-suite IDs are not rerun', async () => {
    const repoRoot = makeTempRoot('suite');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/workflow-suite-fake.test.ts', ['SUITE-ID-001']);
    commitTree(repoRoot, 'suite');
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_suite',
      requiredIds: ['SUITE-ID-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: ['tests/unit/workflow-suite-fake.test.ts'],
      runner: passingRunner(repoRoot, 'ws_leftover_suite', calls),
    });
    expect(result.launchedProcess).toBe(false);
    expect(calls).toEqual([]);
    expect(result.completedIds).toEqual([]);
    expect(
      leftoverRequiredCaseIds({
        requiredIds: ['SUITE-ID-001'],
        completedIds: result.completedIds,
      })
    ).toEqual(['SUITE-ID-001']);
  });

  it('RID-LEFTOVER-CHILD-011: child process failure cannot become PASS', async () => {
    const repoRoot = makeTempRoot('child');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/child.test.ts', ['RID-LEFTOVER-CHILD-001']);
    commitTree(repoRoot, 'child');
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_child',
      requiredIds: ['RID-LEFTOVER-CHILD-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_child', [], { spawnFail: true }),
    });
    expect(result.ok).toBe(false);
    expect(result.command?.status).toBe('failed');
    expect(result.message).toMatch(/spawn failed/);
    expect(result.completedIds).toEqual([]);
  });

  it('RID-LEFTOVER-WIN-012: leftover execution uses the spawn-safe runner', () => {
    const execution = readFileSync(
      path.resolve(__dirname, '../../scripts/automation/workflow-required-id-execution.ts'),
      'utf8'
    );
    const ledger = readFileSync(
      path.resolve(__dirname, '../../scripts/automation/workflow-verification-ledger.ts'),
      'utf8'
    );
    const batch = readFileSync(
      path.resolve(__dirname, '../../scripts/automation/workflow-verify-batch.ts'),
      'utf8'
    );
    expect(execution).toContain('runVitestJsonAndPersistLedgerAsync');
    expect(execution).not.toMatch(/runCapturedProcess\(\{[\s\S]*command: 'npx'/);
    expect(ledger).toContain('spawn(process.execPath');
    expect(batch).toContain('runLeftoverRequiredIdStage');
    expect(batch.indexOf('const batch = await runVerifyBatch')).toBeLessThan(
      batch.indexOf('runLeftoverRequiredIdStage({')
    );
  });

  it('RID-LEFTOVER-JOBS1-013: jobs=1 executes leftover files serially', async () => {
    const repoRoot = makeTempRoot('jobs1');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/a.test.ts', ['RID-LEFTOVER-JOBS-A']);
    writeOwnedTest(repoRoot, 'tests/unit/b.test.ts', ['RID-LEFTOVER-JOBS-B']);
    commitTree(repoRoot, 'jobs1');
    expect(
      selectLeftoverExecutionMode({
        files: ['tests/unit/a.test.ts', 'tests/unit/b.test.ts'],
        jobs: 1,
        isolation: 'proven',
      })
    ).toBe('serial');
    expect(
      selectLeftoverExecutionMode({
        files: ['tests/unit/a.test.ts', 'tests/unit/b.test.ts'],
        jobs: 3,
      })
    ).toBe('serial');
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_jobs1',
      requiredIds: ['RID-LEFTOVER-JOBS-A', 'RID-LEFTOVER-JOBS-B'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_jobs1', [], { delayMs: 20 }),
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('serial');
    expect(result.maxConcurrent).toBe(1);
    expect(result.completedIds).toEqual(['RID-LEFTOVER-JOBS-A', 'RID-LEFTOVER-JOBS-B']);
  });

  it('RID-LEFTOVER-PAR-014: isolated leftover files may use bounded parallel jobs', async () => {
    const repoRoot = makeTempRoot('par');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/iso-a.test.ts', ['RID-LEFTOVER-PAR-A']);
    writeOwnedTest(repoRoot, 'tests/unit/iso-b.test.ts', ['RID-LEFTOVER-PAR-B']);
    commitTree(repoRoot, 'par');
    expect(
      selectLeftoverExecutionMode({
        files: ['tests/unit/iso-a.test.ts', 'tests/unit/iso-b.test.ts'],
        jobs: 3,
        isolation: 'proven',
      })
    ).toBe('bounded-parallel');
    expect(
      selectLeftoverExecutionMode({
        files: ['tests/unit/iso-a.test.ts', 'tests/unit/iso-b.test.ts'],
        jobs: 3,
      })
    ).toBe('serial');
    let current = 0;
    let max = 0;
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_par',
      requiredIds: ['RID-LEFTOVER-PAR-A', 'RID-LEFTOVER-PAR-B'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 3,
      isolation: 'proven',
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_par', [], {
        delayMs: 40,
        onStart: () => {
          current += 1;
          max = Math.max(max, current);
        },
        onEnd: () => {
          current -= 1;
        },
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('bounded-parallel');
    expect(result.maxConcurrent).toBeGreaterThan(1);
    expect(max).toBeGreaterThan(1);
    expect(result.completedIds).toEqual(['RID-LEFTOVER-PAR-A', 'RID-LEFTOVER-PAR-B']);
  });

  it('RID-LEFTOVER-NONTTY-015: leftover progress remains newline-safe for machine output', () => {
    const rendered = formatProgressRecord({
      title: 'TEE preflight',
      percent: 70,
      message: 'Leftover tests',
      elapsedMs: 4_000,
      etaRemainingMs: null,
      workers: [],
      stages: [
        {
          id: 'leftover-tests',
          label: 'Leftover tests',
          status: 'running',
          weight: 10,
          elapsedMs: 1_000,
          measure: 'count',
          completed: 12,
          total: 16,
        },
      ],
      terminal: false,
    });
    expect(rendered).toMatch(/Leftover tests\s+\[█+░+\] 12\/16 RUNNING/);
    expect(rendered.includes(String.fromCharCode(27))).toBe(false);
    expect(rendered.includes('\r')).toBe(false);
  });

  it('RID-LEFTOVER-UI-016: progress updates cannot change leftover result', async () => {
    const repoRoot = makeTempRoot('ui');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/ui.test.ts', ['RID-LEFTOVER-UI-001']);
    commitTree(repoRoot, 'ui');
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_ui',
      requiredIds: ['RID-LEFTOVER-UI-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 1,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_ui', []),
    });
    expect(result.ok).toBe(true);
    const frozen = { ...result, completedIds: [...result.completedIds] };
    formatProgressRecord({
      title: 'TEE preflight',
      percent: 100,
      message: 'display only',
      elapsedMs: 1,
      etaRemainingMs: 0,
      workers: [],
      stages: createPreflightWorkflowStages({ runChecks: true, runRequiredTests: true }),
      terminal: true,
      result: 'FAIL',
    });
    expect(result).toEqual(frozen);
    const stages = createPreflightWorkflowStages({ runChecks: true, runRequiredTests: true });
    expect(stages.some((stage) => stage.id === 'required-id-discovery')).toBe(true);
    expect(stages.some((stage) => stage.id === 'leftover-tests')).toBe(true);
    expect(stages.find((stage) => stage.id === 'required-id-proof')?.measure).toBe('count');
  });

  it('RID-LEFTOVER-SCHED-017: scheduling-style leftovers execute and converge evidence', async () => {
    const repoRoot = makeTempRoot('sched');
    const workstreamId = 'ws_leftover_sched';
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'tests/unit/workflow-suite-fake.test.ts', ['TEE-WF-FAKE-001']);
    writeOwnedTest(repoRoot, 'tests/unit/sched-fixture-settings.test.ts', [
      'sched-fixture-team-settings-persist',
      'sched-fixture-team-leader-implicit',
      'sched-fixture-team-leader-locked',
    ]);
    writeOwnedTest(repoRoot, 'tests/unit/sched-fixture-assign.test.ts', [
      'sched-fixture-team-assign-leader',
      'sched-fixture-team-capacity-leader',
    ]);
    writeOwnedTest(repoRoot, 'tests/unit/unrelated-product.test.ts', ['OTHER-PRODUCT-009']);
    writeOwnedTest(repoRoot, 'app/not-trusted.test.ts', ['sched-fixture-team-settings-persist']);
    commitTree(repoRoot, 'sched fixture');
    const leftoverIds = [
      'sched-fixture-team-settings-persist',
      'sched-fixture-team-leader-implicit',
      'sched-fixture-team-leader-locked',
      'sched-fixture-team-assign-leader',
      'sched-fixture-team-capacity-leader',
    ];
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const candidate = identityOf(repoRoot);
    const leftover = await runLeftoverRequiredIdStage({
      repoRoot,
      workstreamId,
      requiredTestIds: ['TEE-WF-FAKE-001', ...leftoverIds],
      completedIds: ['TEE-WF-FAKE-001'],
      candidate,
      jobs: 3,
      canonicalSuiteFiles: ['tests/unit/workflow-suite-fake.test.ts'],
      runner: passingRunner(repoRoot, workstreamId, calls),
    });
    expect(leftover.ok).toBe(true);
    expect(leftover.launchedProcess).toBe(true);
    expect(leftover.completedIds.sort()).toEqual([...leftoverIds].sort());
    expect(leftover.files.sort()).toEqual([
      'tests/unit/sched-fixture-assign.test.ts',
      'tests/unit/sched-fixture-settings.test.ts',
    ]);
    expect(calls.some((row) => row.files.includes('tests/unit/workflow-suite-fake.test.ts'))).toBe(
      false
    );
    expect(calls.some((row) => row.files.includes('tests/unit/unrelated-product.test.ts'))).toBe(
      false
    );
    expect(calls.some((row) => row.files.includes('app/not-trusted.test.ts'))).toBe(false);
    const suiteLedger = persistFixtureLedger(repoRoot, workstreamId, ['TEE-WF-FAKE-001'], {
      file: 'tests/unit/workflow-suite-fake.test.ts',
    });
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId,
      kind: 'preflight',
      baseCommit: candidate.headCommit,
      requiredTestIds: ['TEE-WF-FAKE-001', ...leftoverIds],
      runChecks: false,
      runRequiredTests: false,
      executedTestIds: ['TEE-WF-FAKE-001', ...leftover.completedIds],
      verificationLedgerRefs: [suiteLedger, ...leftover.verificationLedgerRefs],
      commandResults: [
        {
          name: 'typecheck',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'ok',
          command: 'npm run typecheck',
        },
      ],
      frozenCandidate: {
        headCommit: candidate.headCommit,
        productTreeFingerprint: candidate.fingerprint,
      },
    });
    expect(built.manifest.status).toBe('passed');
    expect(built.manifest.requiredTests.every((test) => test.status === 'completed')).toBe(true);
  });

  it('RID-LEFTOVER-SUITEAPI-018: testsuite API owners use their Vitest config; Playwright fails closed', async () => {
    expect(leftoverVitestRunOptions('testsuite/api/absence-api.test.ts')).toEqual({
      ok: true,
      vitestProject: false,
      configFile: 'testsuite/config/vitest.config.ts',
    });
    expect(leftoverVitestRunOptions('tests/unit/workflow-required-id-execution.test.ts')).toEqual({
      ok: true,
      vitestProject: 'integration',
    });
    expect(leftoverVitestRunOptions('tests/ui/components/SchedulingManagerBoard.test.tsx').ok).toBe(true);
    const playwright = leftoverVitestRunOptions('testsuite/ui/scheduling.spec.ts');
    expect(playwright.ok).toBe(false);
    if (!playwright.ok) {
      expect(playwright.message).toMatch(/Playwright/);
    }
    const repoRoot = makeTempRoot('pw');
    initGitRepo(repoRoot);
    writeOwnedTest(repoRoot, 'testsuite/ui/sched-fixture.spec.ts', ['RID-LEFTOVER-PW-001']);
    commitTree(repoRoot, 'playwright owner');
    const calls: Array<{ files: string[]; requiredIds: string[] }> = [];
    const result = await proveAndExecuteLeftoverRequiredIds({
      repoRoot,
      workstreamId: 'ws_leftover_pw',
      requiredIds: ['RID-LEFTOVER-PW-001'],
      completedIds: [],
      candidate: identityOf(repoRoot),
      jobs: 3,
      canonicalSuiteFiles: [],
      runner: passingRunner(repoRoot, 'ws_leftover_pw', calls),
    });
    expect(result.ok).toBe(false);
    expect(result.launchedProcess).toBe(false);
    expect(result.message).toMatch(/Playwright/);
    expect(calls).toEqual([]);
  });

  it('RID-LEFTOVER-ORCH-019: canonical batch runs leftover only after the workflow suite', () => {
    const batch = readFileSync(
      path.resolve(__dirname, '../../scripts/automation/workflow-verify-batch.ts'),
      'utf8'
    );
    expect(batch).toContain('runVerifyBatch');
    expect(batch).toContain('runLeftoverRequiredIdStage');
    expect(batch.indexOf('const batch = await runVerifyBatch')).toBeLessThan(
      batch.indexOf('runLeftoverRequiredIdStage({')
    );
    expect(batch.indexOf('executedTestIds.push(...value.executedTestIds)')).toBeLessThan(
      batch.indexOf('runLeftoverRequiredIdStage({')
    );
    expect(batch).toContain('!batch.drifted');
    expect(batch).not.toContain("isolation: 'proven'");
  });
});
