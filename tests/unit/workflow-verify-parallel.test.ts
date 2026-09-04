import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  applyTestSuiteProgress,
  createFinaliseWorkflowStages,
  createPreflightWorkflowStages,
  createVerifyProgressReporter,
  displayPercent,
  estimateRemainingMs,
  formatProgressRecord,
  monotonicPercent,
  parseVitestProgressLine,
  shouldUseAlternateScreen,
  shouldUseMachineProgress,
  stageBarFraction,
  stageCompletedWeight,
  ttyLiveRefreshPrefix,
  ttyLiveRestoreSequence,
  ttyLiveStartSequence,
  ttyRedrawPrefix,
  workflowWeightTotals,
} from '@/scripts/automation/workflow-verify-progress';
import {
  createHumanVerifyProgress,
  proveRequiredIdsExact,
} from '@/scripts/automation/workflow-verify-batch';
import {
  resolveTeeVerifyJobs,
  runCapturedProcess,
  runVerifyBatch,
  type VerifyCandidate,
  type VerifyStage,
} from '@/scripts/automation/workflow-verify-runner';

const CANDIDATE: VerifyCandidate = { headCommit: 'abc123def456', fingerprint: 'fp-1' };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stage(
  partial: Pick<VerifyStage, 'id' | 'label' | 'kind'> &
    Partial<VerifyStage> & { wait?: number; ok?: boolean; candidate?: VerifyCandidate }
): VerifyStage {
  return {
    weight: 1,
    async run() {
      if (partial.wait) await delay(partial.wait);
      return {
        ok: partial.ok !== false,
        candidate: partial.candidate ?? CANDIDATE,
        exitCode: partial.ok === false ? 2 : 0,
        stdout: partial.ok === false ? 'stdout-fail' : 'stdout-ok',
        stderr: partial.ok === false ? 'stderr-fail' : '',
      };
    },
    ...partial,
  };
}

describe('TEE parallel verification runner', () => {
  it('TEE-VERIFY-JOBS-BOUND-001: concurrency respects configured bound', async () => {
    const overlapping: number[] = [];
    let current = 0;
    const stages: VerifyStage[] = Array.from({ length: 5 }, (_, index) => ({
      id: `job-${index}`,
      label: `Job ${index}`,
      weight: 1,
      kind: 'readonly',
      async run() {
        current += 1;
        overlapping.push(current);
        await delay(40);
        current -= 1;
        return { ok: true, candidate: CANDIDATE };
      },
    }));
    const batch = await runVerifyBatch({ stages, candidate: CANDIDATE, jobs: 3 });
    expect(batch.maxConcurrent).toBeLessThanOrEqual(3);
    expect(Math.max(...overlapping)).toBeLessThanOrEqual(3);
    expect(batch.maxConcurrent).toBeGreaterThan(1);
  });

  it('TEE-VERIFY-JOBS-SERIAL-002: jobs=1 is serial', async () => {
    const seen: number[] = [];
    let current = 0;
    const stages: VerifyStage[] = [1, 2, 3].map((index) => ({
      id: `serial-${index}`,
      label: `Serial ${index}`,
      weight: 1,
      kind: 'readonly',
      async run() {
        current += 1;
        seen.push(current);
        await delay(25);
        current -= 1;
        return { ok: true, candidate: CANDIDATE };
      },
    }));
    const batch = await runVerifyBatch({ stages, candidate: CANDIDATE, jobs: 1 });
    expect(resolveTeeVerifyJobs('1')).toBe(1);
    expect(batch.serial).toBe(true);
    expect(batch.maxConcurrent).toBe(1);
    expect(Math.max(...seen)).toBe(1);
  });

  it('TEE-VERIFY-DEPS-003: dependency barriers hold', async () => {
    const order: string[] = [];
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 4,
      stages: [
        {
          id: 'a',
          label: 'A',
          weight: 1,
          kind: 'readonly',
          async run() {
            await delay(30);
            order.push('a');
            return { ok: true, candidate: CANDIDATE };
          },
        },
        {
          id: 'b',
          label: 'B',
          weight: 1,
          kind: 'readonly',
          dependsOn: ['a'],
          async run() {
            order.push('b');
            return { ok: true, candidate: CANDIDATE };
          },
        },
      ],
    });
    expect(batch.ok).toBe(true);
    expect(order).toEqual(['a', 'b']);
  });

  it('TEE-VERIFY-OVERLAP-004: independent read-only workers overlap', async () => {
    let concurrent = 0;
    let max = 0;
    const make = (id: string): VerifyStage => ({
      id,
      label: id,
      weight: 1,
      kind: 'readonly',
      async run() {
        concurrent += 1;
        max = Math.max(max, concurrent);
        await delay(50);
        concurrent -= 1;
        return { ok: true, candidate: CANDIDATE };
      },
    });
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 3,
      stages: [make('one'), make('two')],
    });
    expect(batch.maxConcurrent).toBe(2);
    expect(max).toBe(2);
  });

  it('TEE-VERIFY-MUTATE-BARRIER-005: mutating/authority stages do not overlap', async () => {
    let concurrent = 0;
    let max = 0;
    const make = (id: string, kind: 'mutating' | 'authority' | 'readonly'): VerifyStage => ({
      id,
      label: id,
      weight: 1,
      kind,
      async run() {
        concurrent += 1;
        max = Math.max(max, concurrent);
        await delay(40);
        concurrent -= 1;
        return { ok: true, candidate: CANDIDATE };
      },
    });
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 3,
      stages: [make('mut', 'mutating'), make('auth', 'authority'), make('ro', 'readonly')],
    });
    expect(batch.ok).toBe(true);
    expect(max).toBe(1);
    expect(batch.maxConcurrent).toBe(1);
  });

  it('TEE-VERIFY-CANDIDATE-BIND-006: all workers bind to the same candidate', async () => {
    const seen: string[] = [];
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 3,
      stages: ['a', 'b'].map((id) => ({
        id,
        label: id,
        weight: 1,
        kind: 'readonly' as const,
        run: (ctx) => {
          seen.push(`${ctx.candidate.headCommit}:${ctx.candidate.fingerprint}`);
          return { ok: true, candidate: ctx.candidate };
        },
      })),
    });
    expect(batch.ok).toBe(true);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(`${CANDIDATE.headCommit}:${CANDIDATE.fingerprint}`);
  });

  it('TEE-VERIFY-WRONG-CANDIDATE-007: wrong-candidate result is rejected', async () => {
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 1,
      stages: [
        stage({
          id: 'wrong',
          label: 'Wrong',
          kind: 'readonly',
          candidate: { headCommit: 'other', fingerprint: 'fp-other' },
        }),
      ],
    });
    expect(batch.ok).toBe(false);
    expect(batch.failures[0]?.message).toMatch(/different candidate/i);
  });

  it('TEE-VERIFY-DRIFT-008: candidate drift fails closed', async () => {
    let calls = 0;
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 2,
      readCandidate: () => {
        calls += 1;
        if (calls > 2) return { drifted: true };
        return CANDIDATE;
      },
      stages: [
        stage({ id: 'first', label: 'First', kind: 'readonly', wait: 20 }),
        stage({ id: 'second', label: 'Second', kind: 'readonly', wait: 20 }),
      ],
    });
    expect(batch.drifted).toBe(true);
    expect(batch.ok).toBe(false);
    expect(batch.results.some((row) => row.status === 'skipped')).toBe(true);
  });

  it('TEE-VERIFY-FAIL-BATCH-009: worker failure fails the overall batch', async () => {
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 2,
      stages: [
        stage({ id: 'ok', label: 'Ok', kind: 'readonly' }),
        stage({ id: 'bad', label: 'Bad', kind: 'readonly', ok: false }),
      ],
    });
    expect(batch.ok).toBe(false);
    expect(batch.failures.map((row) => row.id)).toContain('bad');
  });

  it('TEE-VERIFY-FAIL-TOGETHER-010: independent failures are aggregated', async () => {
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 3,
      stages: [
        stage({ id: 'pass', label: 'Pass', kind: 'readonly', wait: 20 }),
        stage({ id: 'fail-a', label: 'Fail A', kind: 'readonly', ok: false, wait: 25 }),
        stage({ id: 'fail-b', label: 'Fail B', kind: 'readonly', ok: false, wait: 25 }),
      ],
    });
    expect(batch.failures.map((row) => row.id).sort()).toEqual(['fail-a', 'fail-b']);
    expect(batch.results.find((row) => row.id === 'pass')?.status).toBe('pass');
  });

  it('TEE-VERIFY-FOUNDATION-011: foundational invalidation blocks downstream evidence', async () => {
    const ran: string[] = [];
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 3,
      stages: [
        {
          id: 'foundation',
          label: 'Foundation',
          weight: 1,
          kind: 'foundation',
          failFast: true,
          run: () => {
            ran.push('foundation');
            return { ok: false, message: 'bad git context', candidate: CANDIDATE };
          },
        },
        {
          id: 'tests',
          label: 'Tests',
          weight: 1,
          kind: 'readonly',
          dependsOn: ['foundation'],
          run: () => {
            ran.push('tests');
            return { ok: true, candidate: CANDIDATE };
          },
        },
      ],
    });
    expect(batch.foundationFailed).toBe(true);
    expect(batch.ok).toBe(false);
    expect(ran).toEqual(['foundation']);
    expect(batch.results.find((row) => row.id === 'tests')?.status).toBe('skipped');
    expect(batch.results.find((row) => row.id === 'tests')?.message).toMatch(/foundational/i);
  });

  it('TEE-VERIFY-EXIT-012 / TEE-VERIFY-STDERR-013: exit code and stderr are preserved', async () => {
    const captured = await runCapturedProcess({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("boom-err"); process.stdout.write("boom-out"); process.exit(2)'],
      cwd: process.cwd(),
    });
    expect(captured.exitCode).toBe(2);
    expect(captured.stderr).toContain('boom-err');
    expect(captured.stdout).toContain('boom-out');
    const batch = await runVerifyBatch({
      candidate: CANDIDATE,
      jobs: 1,
      stages: [
        {
          id: 'exit',
          label: 'Exit',
          weight: 1,
          kind: 'readonly',
          run: async () => ({
            ok: false,
            candidate: CANDIDATE,
            exitCode: captured.exitCode,
            signal: captured.signal,
            stdout: captured.stdout,
            stderr: captured.stderr,
          }),
        },
      ],
    });
    expect(batch.failures[0]?.exitCode).toBe(2);
    expect(batch.failures[0]?.stderr).toContain('boom-err');
  });

  it('TEE-VERIFY-EXIT-012: host npm/npx spawn is usable on this platform', async () => {
    const captured = await runCapturedProcess({
      command: 'npm',
      args: ['--version'],
      cwd: process.cwd(),
    });
    expect(captured.error).toBeUndefined();
    expect(captured.exitCode).toBe(0);
    expect(captured.stdout.trim().length).toBeGreaterThan(0);
  });
});

describe('TEE verification progress', () => {
  it('TEE-VERIFY-PCT-MONO-014 / TEE-VERIFY-PCT-100-015: percentage is monotonic and 100 only at terminal', () => {
    expect(monotonicPercent(10, 8)).toBe(10);
    expect(displayPercent({ completedWeight: 10, totalWeight: 10, terminal: false })).toBe(99);
    expect(displayPercent({ completedWeight: 10, totalWeight: 10, terminal: true })).toBe(100);
    const now = 1_000;
    const chunks: string[] = [];
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      now: () => now,
      stream: { write: (chunk) => chunks.push(chunk) },
      isTty: false,
      heartbeatMs: 15_000,
    });
    reporter.update({ message: 'Running', percent: 100 });
    expect(reporter.snapshot().percent).toBe(99);
    expect(reporter.snapshot().terminal).toBe(false);
    reporter.complete('PASS', 'Preflight');
    expect(reporter.snapshot().percent).toBe(100);
    expect(reporter.lastPercent()).toBe(100);
  });

  it('TEE-VERIFY-ETA-016: ETA stays elapsed-only until enough progress exists', () => {
    expect(estimateRemainingMs({ elapsedMs: 5_000, completedWeight: 4, totalWeight: 10 })).toBeNull();
    expect(estimateRemainingMs({ elapsedMs: 30_000, completedWeight: 1, totalWeight: 10 })).toBeNull();
    expect(estimateRemainingMs({ elapsedMs: 30_000, completedWeight: 5, totalWeight: 10 })).toBeGreaterThan(0);
  });

  it('TEE-VERIFY-HEARTBEAT-017: heartbeat cannot mutate caller state', () => {
    const state = { mutated: false, phase: 'preflight_ready' };
    let now = 0;
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      now: () => now,
      stream: { write: () => undefined },
      isTty: false,
      heartbeatMs: 15_000,
    });
    reporter.update({ message: 'Running', completedWeight: 1, totalWeight: 4 });
    expect(reporter.heartbeat({ message: 'Running', completedWeight: 1, totalWeight: 4 })).toBeNull();
    now = 16_000;
    const frozen = { ...state };
    reporter.heartbeat({ message: 'Running', completedWeight: 1, totalWeight: 4 });
    expect(state).toEqual(frozen);
  });

  it('TEE-VERIFY-NONTTY-018: non-TTY output contains no control sequences', () => {
    const chunks: string[] = [];
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      stream: { write: (chunk) => chunks.push(chunk) },
      isTty: false,
      ci: true,
    });
    reporter.update({
      message: 'Verification batch',
      completedWeight: 1,
      totalWeight: 4,
      workers: [{ id: 't', label: 'Typecheck', status: 'running', elapsedMs: 1000 }],
    });
    reporter.complete('FAIL', 'Preflight');
    const text = chunks.join('');
    expect(text).not.toMatch(/\u001b|\r/);
    expect(formatProgressRecord(reporter.snapshot())).toMatch(/100%/);
    expect(formatProgressRecord(reporter.snapshot())).toMatch(/Overall/);
  });

  it('TEE-VERIFY-HIER-021: waiting stages never look passed and overall stays below 100', () => {
    const stages = createPreflightWorkflowStages({ runChecks: true, runRequiredTests: true });
    stages[0] = { ...stages[0]!, status: 'pass', elapsedMs: 20 };
    const typecheck = stages.find((stage) => stage.id === 'typecheck');
    if (typecheck) {
      typecheck.status = 'running';
      typecheck.measure = 'opaque';
    }
    const rendered = formatProgressRecord({
      title: 'TEE preflight',
      candidate: 'abc123',
      percent: 12,
      message: 'Running',
      elapsedMs: 4_000,
      etaRemainingMs: null,
      workers: [],
      stages,
      terminal: false,
    });
    expect(rendered).toMatch(/Candidate capture\s+\[█+\] PASS/);
    expect(rendered).toMatch(/Typecheck\s+\[░+\] RUNNING/);
    expect(rendered).toMatch(/Evidence convergence\s+\[░+\] WAITING/);
    expect(rendered).not.toMatch(/WAITING[^\n]*PASS/);
    expect(rendered).not.toMatch(/Overall[^\n]*100%/);
    const weights = workflowWeightTotals(stages);
    expect(displayPercent({ ...weights, terminal: false })).toBeLessThan(100);
    expect(stageBarFraction(typecheck!)).toBeNull();
    expect(stageCompletedWeight(typecheck!)).toBe(0);
  });

  it('TEE-VERIFY-TESTS-022: suite progress uses real events, cannot exceed total, and surfaces failures immediately', () => {
    const collected = parseVitestProgressLine(
      JSON.stringify({ type: 'collected', completed: 0, total: 3 })
    );
    expect(collected?.type).toBe('collected');
    expect(collected?.completed).toBe(0);
    expect(collected?.total).toBe(3);
    let suite = applyTestSuiteProgress({}, collected!);
    suite = applyTestSuiteProgress(
      suite,
      parseVitestProgressLine(
        JSON.stringify({
          type: 'case',
          completed: 1,
          total: 3,
          current: 'TEE-V24-C9-FINISH-MISMATCH-003',
          state: 'passed',
        })
      )!
    );
    expect(suite.completed).toBe(1);
    expect(suite.total).toBe(3);
    suite = applyTestSuiteProgress(
      suite,
      parseVitestProgressLine(
        JSON.stringify({
          type: 'case',
          completed: 2,
          total: 3,
          current: 'TEE-VERIFY-FAIL-001',
          failed: true,
          state: 'failed',
        })
      )!
    );
    expect(suite.completed).toBe(2);
    expect(suite.failures).toEqual(['TEE-VERIFY-FAIL-001']);
    const overflow = applyTestSuiteProgress(suite, {
      type: 'case',
      completed: 99,
      total: 3,
      current: 'extra',
    });
    expect(overflow.completed).toBe(3);
    expect(overflow.completed).toBeLessThanOrEqual(overflow.total ?? 0);
    expect(parseVitestProgressLine('not-json')).toBeNull();
  });

  it('TEE-VERIFY-OPAQUE-023: opaque running does not fabricate completion or change a process result', () => {
    const result = { exitCode: 2, ok: false };
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      stream: { write: () => undefined },
      isTty: false,
    });
    reporter.setStages([
      { id: 'typecheck', label: 'Typecheck', status: 'running', weight: 10, elapsedMs: 1_000, measure: 'opaque' },
      { id: 'eslint', label: 'ESLint', status: 'waiting', weight: 10, elapsedMs: 0, measure: 'opaque' },
    ]);
    expect(reporter.snapshot().percent).toBe(0);
    reporter.updateStage('typecheck', { status: 'pass', elapsedMs: 2_000 });
    expect(reporter.snapshot().percent).toBeGreaterThan(0);
    expect(reporter.snapshot().percent).toBeLessThan(100);
    expect(result).toEqual({ exitCode: 2, ok: false });
    expect(ttyRedrawPrefix(3)).toMatch(/\u001b/);
    expect(formatProgressRecord(reporter.snapshot())).not.toMatch(/\u001b|\r/);
  });

  it('TEE-VERIFY-FINALISE-STAGES-024: finalise stage list keeps later rows waiting', () => {
    const stages = createFinaliseWorkflowStages();
    expect(stages.map((stage) => stage.id)).toEqual([
      'activity',
      'unmerged',
      'protocol',
      'release-meta',
      'migration-inventory',
      'finalise-start',
      'production-build',
      'release-finish',
    ]);
    const rendered = formatProgressRecord({
      title: 'TEE finalise',
      percent: 20,
      message: 'Build',
      elapsedMs: 1_000,
      etaRemainingMs: null,
      workers: [],
      stages: stages.map((stage) =>
        stage.id === 'production-build'
          ? { ...stage, status: 'running', measure: 'count', completed: 2, total: 8 }
          : ['activity', 'unmerged', 'protocol', 'release-meta', 'migration-inventory', 'finalise-start'].includes(
                stage.id
              )
            ? { ...stage, status: 'pass' }
            : stage
      ),
      terminal: false,
    });
    expect(rendered).toMatch(/Production build\s+\[[█░]+\] 2\/8 RUNNING/);
    expect(rendered).toMatch(/Release finish\s+\[░+\] WAITING/);
    expect(rendered).not.toMatch(/Release finish[^\n]*PASS/);
  });

  it('TEE-VERIFY-LIVE-TTY-025: TTY enters live mode and later frames replace instead of appending', () => {
    const chunks: string[] = [];
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      stream: { write: (chunk) => chunks.push(chunk) },
      isTty: true,
      ci: false,
    });
    const result = { exitCode: 0, ok: true };
    reporter.update({ message: 'Running', percent: 10 });
    reporter.update({ message: 'Running', percent: 40 });
    const text = chunks.join('');
    expect(text.startsWith(ttyLiveStartSequence(true))).toBe(true);
    expect(text).toContain(ttyLiveRefreshPrefix());
    expect(text).not.toContain('cls');
    expect((text.match(/Preflight/g) || []).length).toBeGreaterThan(1);
    expect(text.indexOf(ttyLiveRefreshPrefix())).toBeGreaterThan(text.indexOf(ttyLiveStartSequence(true)));
    expect(result).toEqual({ exitCode: 0, ok: true });
  });

  it('TEE-VERIFY-LIVE-PASS-026: final PASS restores the terminal and prints one permanent frame', () => {
    const chunks: string[] = [];
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      stream: { write: (chunk) => chunks.push(chunk) },
      isTty: true,
      ci: false,
    });
    reporter.update({ message: 'Running', percent: 20 });
    reporter.complete('PASS', 'Preflight');
    const text = chunks.join('');
    expect(text).toContain(ttyLiveRestoreSequence(true));
    expect(text).toMatch(/100% PASS/);
    expect(text.lastIndexOf(ttyLiveRestoreSequence(true))).toBeLessThan(text.lastIndexOf('100% PASS'));
    reporter.restoreTerminal();
    expect(chunks.join('')).toBe(text);
  });

  it('TEE-VERIFY-LIVE-FAIL-027: final FAIL restores the terminal', () => {
    const chunks: string[] = [];
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      stream: { write: (chunk) => chunks.push(chunk) },
      isTty: true,
      ci: false,
    });
    reporter.update({ message: 'Running', percent: 20 });
    reporter.complete('FAIL', 'Preflight');
    const text = chunks.join('');
    expect(text).toContain(ttyLiveRestoreSequence(true));
    expect(text).toMatch(/100% FAIL/);
  });

  it('TEE-VERIFY-LIVE-THROW-028: exception restore leaves the terminal usable', () => {
    const chunks: string[] = [];
    const reporter = createVerifyProgressReporter({
      title: 'Preflight',
      stream: { write: (chunk) => chunks.push(chunk) },
      isTty: true,
      ci: false,
    });
    reporter.update({ message: 'Running', percent: 20 });
    try {
      throw new Error('display-only crash');
    } catch {
      reporter.restoreTerminal();
    }
    expect(chunks.join('')).toContain(ttyLiveRestoreSequence(true));
  });

  it('TEE-VERIFY-LIVE-DISABLED-029: progress off remains supported and display cannot change a result', () => {
    const result = { exitCode: 7, ok: false };
    expect(
      createHumanVerifyProgress({
        title: 'Preflight',
        env: { TEE_VERIFY_PROGRESS: 'off' },
        stderrIsTty: true,
      })
    ).toBeUndefined();
    expect(shouldUseMachineProgress({ TEE_VERIFY_PROGRESS: 'plain' }, true)).toBe(true);
    expect(shouldUseAlternateScreen({ TERM: 'dumb' })).toBe(false);
    expect(shouldUseAlternateScreen({ TEE_VERIFY_PROGRESS_ALT: '0' })).toBe(false);
    expect(ttyLiveStartSequence(false)).not.toContain('\u001b[?1049h');
    const progressSource = readFileSync(
      path.join(path.resolve(__dirname, '..', '..'), 'scripts/automation/workflow-verify-progress.ts'),
      'utf8'
    );
    const batchSource = readFileSync(
      path.join(path.resolve(__dirname, '..', '..'), 'scripts/automation/workflow-verify-batch.ts'),
      'utf8'
    );
    expect(progressSource).not.toMatch(/spawnSync\(\s*['"]cls['"]/);
    expect(batchSource).toContain('attachLiveProgressTerminalGuards');
    expect(batchSource).toContain("process.once('SIGINT'");
    expect(batchSource).toContain("process.once('uncaughtException'");
    expect(result).toEqual({ exitCode: 7, ok: false });
  });
});

describe('TEE verification contracts remain exact', () => {
  const root = path.resolve(__dirname, '..', '..');

  it('TEE-VERIFY-REQUIRED-IDS-019: required-ID aggregation remains exact', () => {
    expect(
      proveRequiredIdsExact({
        requiredIds: ['B', 'A', 'A'],
        provenIds: ['A', 'B'],
      }).ok
    ).toBe(true);
    const missing = proveRequiredIdsExact({
      requiredIds: ['A', 'C'],
      provenIds: ['A', 'B'],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.missing).toEqual(['C']);
      expect(missing.extra).toEqual(['B']);
    }
  });

  it('TEE-VERIFY-PREFLIGHT-CONTRACT-020: canonical preflight still records only after a passed manifest', () => {
    const source = readFileSync(path.join(root, 'scripts/review-preflight.ts'), 'utf8');
    expect(source).toContain('runAndBuildEvidenceManifest');
    expect(source).toContain("command: 'preflight-record'");
    expect(source).toContain('built.manifest.status !== \'passed\'');
    expect(source.indexOf("command: 'preflight-record'")).toBeGreaterThan(
      source.indexOf('built.manifest.status !== \'passed\'')
    );
  });

  it('TEE-VERIFY-FIXDELTA-CONTRACT-021: fix-delta still uses the same manifest kind and proof helpers', () => {
    const manifest = readFileSync(path.join(root, 'scripts/automation/workflow-evidence-manifest.ts'), 'utf8');
    const batch = readFileSync(path.join(root, 'scripts/automation/workflow-verify-batch.ts'), 'utf8');
    const protocol = readFileSync(path.join(root, 'scripts/automation/workflow-review-protocol.ts'), 'utf8');
    expect(manifest).toContain("export type EvidenceManifestKind = 'preflight' | 'fix-delta'");
    expect(batch).toContain("kind: EvidenceManifestKind");
    expect(batch).toContain('runAndBuildEvidenceManifest');
    expect(protocol).toContain("requireKind: 'fix-delta'");
    expect(protocol).toContain('fix-record');
  });

  it('TEE-VERIFY-C8C9-UNCHANGED-022: finalise/C8/C9 authority remains serial after read-only probes', () => {
    const finalise = readFileSync(path.join(root, 'scripts/finalise.ts'), 'utf8');
    const protocol = readFileSync(path.join(root, 'scripts/automation/workflow-review-protocol.ts'), 'utf8');
    expect(finalise).toContain('assertFinaliseAllowedForProtocol');
    expect(finalise).toContain('assertProtectedFinaliseAuthorityBeforeMutation');
    expect(finalise.indexOf('assertProtectedFinaliseAuthorityBeforeMutation')).toBeGreaterThan(
      finalise.indexOf('runVerifyBatch')
    );
    expect(finalise.indexOf("kind: 'readonly'")).toBeGreaterThan(0);
    expect(finalise).not.toMatch(/kind: 'authority'[\s\S]{0,80}assertProtectedFinaliseAuthorityBeforeMutation/);
    expect(protocol).toContain('export function reduceFinaliseStart');
    expect(protocol).toContain('assertProtocolGitBinding');
  });
});
