import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Readable, Writable } from 'stream';
import { describe, expect, it } from 'vitest';
import { renderAutomationAdvisorReview } from '@/scripts/automation/advisor-review';
import { redactSensitiveText } from '@/scripts/automation/logger';
import { runMonthlyAutomationFollowUp, writeMonthlyAutomationPendingFollowUp } from '@/scripts/automation/monthly-follow-up';
import { updateAutomationMemory } from '@/scripts/automation/memory';
import { reviewAutomationRun } from '@/scripts/automation/self-review';
import type { AutomationMemory, AutomationMemorySuggestion, AutomationRunLog } from '@/scripts/automation/types';

function createRunLog(overrides: Partial<AutomationRunLog> = {}): AutomationRunLog {
  return {
    id: overrides.id ?? 'run-1',
    scriptName: overrides.scriptName ?? 'test-script',
    mode: overrides.mode ?? 'test',
    args: overrides.args ?? [],
    startedAt: overrides.startedAt ?? '2026-05-01T00:00:00.000Z',
    endedAt: overrides.endedAt ?? '2026-05-01T00:00:01.000Z',
    durationMs: overrides.durationMs ?? 1000,
    status: overrides.status ?? 'passed',
    metadata: {
      branch: 'feature/test',
      commit: 'abc123',
      dirtyFileCount: 0,
      nodeVersion: 'v20.0.0',
      npmVersion: '10.0.0',
      platform: 'test',
    },
    expectedArtifacts: [],
    artifacts: overrides.artifacts ?? [],
    steps: overrides.steps ?? [
      {
        name: 'sample step',
        status: overrides.status ?? 'passed',
        startedAt: '2026-05-01T00:00:00.000Z',
        endedAt: '2026-05-01T00:00:01.000Z',
        durationMs: 1000,
      },
    ],
    error: overrides.error,
  };
}

function createMemorySuggestion(overrides: Partial<AutomationMemorySuggestion> = {}): AutomationMemorySuggestion {
  return {
    id: overrides.id ?? 'finalise-record-commit-outcome-metadata',
    scriptName: overrides.scriptName ?? 'finalise',
    title: overrides.title ?? 'Record explicit commit created/skipped metadata',
    reason: overrides.reason ?? 'Future reviews cannot distinguish healthy commit skips from commit failures.',
    evidence: overrides.evidence ?? ['No git commit command steps found in reviewed logs.'],
    createdMonth: overrides.createdMonth ?? '2026-06',
    lastSeenMonth: overrides.lastSeenMonth ?? '2026-06',
    status: overrides.status ?? 'pending',
    statusReason: overrides.statusReason,
    decisionAt: overrides.decisionAt,
    decisionReason: overrides.decisionReason,
    planPath: overrides.planPath,
    implementedAt: overrides.implementedAt,
    outcome: overrides.outcome,
    source: overrides.source ?? 'advisor',
  };
}

function createOutputSink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function createOutputCapture(): Writable & { getOutput: () => string; isTTY?: boolean } {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      callback();
    },
  }) as Writable & { getOutput: () => string; isTTY?: boolean };
  output.isTTY = false;
  output.getOutput = () => chunks.join('');
  return output;
}

function createInput(lines: string[]): Readable & { isTTY?: boolean } {
  const input = Readable.from(lines) as Readable & { isTTY?: boolean };
  input.isTTY = false;
  return input;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function createFollowUpFixture(suggestions: AutomationMemorySuggestion[]) {
  const root = path.join(tmpdir(), `automation-follow-up-${process.pid}-${Date.now()}-${Math.random()}`);
  const reviewDirectory = path.join(root, 'docs_private', 'automation', 'reviews', suggestions[0]?.scriptName ?? 'finalise', '2026-06');
  const knowledgeDirectory = path.join(root, 'docs_private', 'automation', 'knowledge');
  const reviewPath = path.join(reviewDirectory, 'review.md');
  const suggestionsPath = path.join(reviewDirectory, 'suggestions.json');
  mkdirSync(reviewDirectory, { recursive: true });
  mkdirSync(knowledgeDirectory, { recursive: true });
  writeFileSync(reviewPath, '# Advisor Review\n', 'utf8');
  writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2), 'utf8');

  return {
    root,
    reviewPath,
    suggestionsPath,
    knowledgeDirectory,
  };
}

describe('automation logging helpers', () => {
  it('redacts common secrets from command output', () => {
    const output = redactSensitiveText([
      'POSTGRES_URL_NON_POOLING=postgres://user:secret-password@example.com/db',
      'Authorization: Bearer abc.def.ghi',
      'SUPABASE_SERVICE_ROLE_KEY=super-secret',
      'password: plain-text',
    ].join('\n'));

    expect(output).not.toContain('secret-password');
    expect(output).not.toContain('abc.def.ghi');
    expect(output).not.toContain('super-secret');
    expect(output).not.toContain('plain-text');
    expect(output).toContain('[REDACTED]');
  });

  it('creates a monthly review and suggests action for repeated failures', () => {
    const root = path.join(tmpdir(), `automation-review-${process.pid}-${Date.now()}`);
    const runDirectory = path.join(root, 'runs');
    const reviewsDirectory = path.join(root, 'reviews');
    mkdirSync(runDirectory, { recursive: true });

    const logs = [
      createRunLog({ id: 'run-1', status: 'failed', startedAt: '2026-05-03T00:00:00.000Z', error: 'one' }),
      createRunLog({ id: 'run-2', status: 'failed', startedAt: '2026-05-02T00:00:00.000Z', error: 'two' }),
      createRunLog({ id: 'run-3', status: 'failed', startedAt: '2026-05-01T00:00:00.000Z', error: 'three' }),
    ];

    for (const log of logs) {
      writeFileSync(path.join(runDirectory, `${log.id}.json`), JSON.stringify(log), 'utf8');
    }

    try {
      const summary = reviewAutomationRun({
        runDirectory,
        reviewsDirectory,
        latestLog: logs[0],
      });

      expect(summary.recentFailureCount).toBe(3);
      expect(summary.monthlyReviewGenerated).toBe(true);
      expect(summary.monthlyReviewPath).toBeTruthy();
      expect(summary.monthlyPromptPath).toBeTruthy();
      expect(summary.monthlySuggestionsPath).toBeTruthy();
      expect(summary.monthlyReview?.monthKey).toBeTruthy();
      expect(summary.monthlyReview?.suggestionsPath).toBe(summary.monthlySuggestionsPath);
      expect(summary.monthlyReview?.knowledgeDirectory).toBe(path.join(root, 'knowledge'));
      expect(summary.advisorReviewPath).toBeTruthy();
      expect(summary.suggestions.some((suggestion) => suggestion.severity === 'action')).toBe(true);
      expect(existsSync(summary.monthlyPromptPath!)).toBe(true);
      expect(existsSync(path.join(path.dirname(summary.monthlyReviewPath!), 'review-prompt.md'))).toBe(true);
      expect(existsSync(path.join(path.dirname(summary.monthlyReviewPath!), 'metrics.json'))).toBe(true);
      expect(existsSync(path.join(path.dirname(summary.monthlyReviewPath!), 'suggestions.json'))).toBe(true);
      expect(existsSync(path.join(root, 'knowledge', 'test-script-memory.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes advisor suggestions when monthly finalise and fixerrors reviews are generated', () => {
    const root = path.join(tmpdir(), `automation-advisor-suggestions-${process.pid}-${Date.now()}`);
    const reviewsDirectory = path.join(root, 'reviews');
    const finaliseRunDirectory = path.join(root, 'runs', 'finalise');
    const fixerrorsRunDirectory = path.join(root, 'runs', 'fixerrors');
    mkdirSync(finaliseRunDirectory, { recursive: true });
    mkdirSync(fixerrorsRunDirectory, { recursive: true });

    const finaliseLog = createRunLog({
      id: 'finalise-1',
      scriptName: 'finalise',
      mode: 'standard',
      steps: [],
    });
    const fixerrorsLog = createRunLog({
      id: 'fixerrors-1',
      scriptName: 'fixerrors',
      mode: 'analysis',
      steps: [
        {
          name: 'Write error analysis report',
          status: 'passed',
          startedAt: '2026-06-01T00:00:00.000Z',
          endedAt: '2026-06-01T00:00:01.000Z',
          durationMs: 1000,
          metadata: {
            totalFetched: 200,
            filteredOut: 190,
            afterFiltering: 10,
            patternsFound: 2,
            patternsWithoutSourceFiles: 1,
            topPatterns: [{
              errorType: 'Error',
              component: 'Console',
              normalizedMessage: 'Repeated production failure',
              occurrences: 3,
              sourceFiles: ['app/api/example/route.ts'],
            }],
          },
        },
      ],
    });
    writeFileSync(path.join(finaliseRunDirectory, `${finaliseLog.id}.json`), JSON.stringify(finaliseLog), 'utf8');
    writeFileSync(path.join(fixerrorsRunDirectory, `${fixerrorsLog.id}.json`), JSON.stringify(fixerrorsLog), 'utf8');

    try {
      const finaliseSummary = reviewAutomationRun({
        runDirectory: finaliseRunDirectory,
        reviewsDirectory,
        latestLog: finaliseLog,
      });
      const fixerrorsSummary = reviewAutomationRun({
        runDirectory: fixerrorsRunDirectory,
        reviewsDirectory,
        latestLog: fixerrorsLog,
      });

      expect(finaliseSummary.monthlyReview?.suggestions.map((suggestion) => suggestion.id))
        .toContain('finalise-record-commit-outcome-metadata');
      expect(fixerrorsSummary.monthlyReview?.suggestions.map((suggestion) => suggestion.id))
        .toContain('fixerrors-paginate-fetch-limit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders finalise advisor sections with mode and slow step guidance', () => {
    const review = renderAutomationAdvisorReview({
      advisorDirectory: '/tmp/not-used',
      scriptName: 'finalise',
      generatedAt: '2026-05-19T00:00:00.000Z',
      monthKey: '2026-05',
      logs: [
        createRunLog({
          id: 'finalise-1',
          scriptName: 'finalise',
          mode: 'standard',
          startedAt: '2026-05-19T00:00:00.000Z',
          durationMs: 180_000,
          steps: [
            {
              name: 'npm run build',
              status: 'passed',
              startedAt: '2026-05-19T00:00:00.000Z',
              endedAt: '2026-05-19T00:03:00.000Z',
              durationMs: 180_000,
              command: 'npm run build',
            },
          ],
        }),
        createRunLog({
          id: 'finalise-2',
          scriptName: 'finalise',
          mode: 'dry-run',
          args: ['--dry-run'],
          startedAt: '2026-05-19T00:05:00.000Z',
          durationMs: 1000,
          steps: [],
        }),
      ],
    });

    expect(review).toContain('## Executive Summary');
    expect(review).toContain('## Suggested Script Improvements');
    expect(review).toContain('standard: 1 run(s)');
    expect(review).toContain('dry-run: 1 run(s)');
    expect(review).toContain('Builds average 3.0m');
    expect(review).toContain('## Copy/Paste Cursor Prompt');
  });

  it('renders fixerrors advisor sections with fetch and pattern guidance', () => {
    const topPattern = {
      errorType: 'Error',
      component: 'Console',
      normalizedMessage: 'Repeated production failure',
      occurrences: 3,
      sourceFiles: ['app/api/example/route.ts'],
    };
    const review = renderAutomationAdvisorReview({
      advisorDirectory: '/tmp/not-used',
      scriptName: 'fixerrors',
      generatedAt: '2026-05-19T00:00:00.000Z',
      monthKey: '2026-05',
      logs: [
        createRunLog({
          id: 'fixerrors-1',
          scriptName: 'fixerrors',
          mode: 'analysis',
          startedAt: '2026-05-19T00:00:00.000Z',
          steps: [
            {
              name: 'Write error analysis report',
              status: 'passed',
              startedAt: '2026-05-19T00:00:00.000Z',
              endedAt: '2026-05-19T00:00:01.000Z',
              durationMs: 1000,
              metadata: {
                totalFetched: 200,
                filteredOut: 190,
                afterFiltering: 10,
                patternsFound: 2,
                topPatterns: [topPattern],
              },
            },
            {
              name: 'Summarise historical error fix log',
              status: 'passed',
              startedAt: '2026-05-19T00:00:01.000Z',
              endedAt: '2026-05-19T00:00:01.000Z',
              durationMs: 0,
              metadata: {
                totalEntries: 4,
                statusCounts: { untriaged: 2, stale: 1, resolved: 1 },
              },
            },
          ],
        }),
      ],
    });

    expect(review).toContain('Total fetched: 200');
    expect(review).toContain('The 200-log fetch limit was hit');
    expect(review).toContain('filtered more than 75%');
    expect(review).toContain('untriaged');
    expect(review).toContain('## Copy/Paste Cursor Prompt');
  });

  it('preserves human-edited suggestion statuses when memory is updated', () => {
    const existingSuggestion: AutomationMemorySuggestion = {
      id: 'finalise-record-commit-outcome-metadata',
      scriptName: 'finalise',
      title: 'Record explicit commit created/skipped metadata',
      reason: 'Human approved this suggestion.',
      evidence: ['manual review'],
      createdMonth: '2026-05',
      lastSeenMonth: '2026-05',
      status: 'approved',
      statusReason: 'Worth doing',
      decisionAt: '2026-05-02T00:00:00.000Z',
      decisionReason: 'Human approved this suggestion.',
      planPath: 'plans/automation/finalise-2026-05-upgrade-plan.md',
      source: 'advisor',
    };
    const memory: AutomationMemory = {
      version: '1.0.0',
      scriptName: 'finalise',
      updatedAt: '2026-05-01T00:00:00.000Z',
      suggestions: [existingSuggestion],
      prompts: [],
      monthlyMetrics: [],
    };

    const updated = updateAutomationMemory({
      memory,
      metrics: {
        scriptName: 'finalise',
        month: '2026-06',
        generatedAt: '2026-06-01T00:00:00.000Z',
        runCount: 1,
        failureCount: 0,
        averageDurationMs: 1000,
        modeCounts: { standard: 1 },
      },
      prompt: {
        month: '2026-06',
        focusAreas: ['commit metadata'],
        deprioritizedAreas: [],
        prompt: 'Focus on commit metadata.',
      },
      suggestions: [{
        ...existingSuggestion,
        reason: 'Generated again from logs.',
        evidence: ['No git commit command steps found in reviewed logs.'],
        createdMonth: '2026-06',
        lastSeenMonth: '2026-06',
        status: 'pending',
      }],
    });

    expect(updated.suggestions[0].status).toBe('approved');
    expect(updated.suggestions[0].statusReason).toBe('Worth doing');
    expect(updated.suggestions[0].decisionAt).toBe('2026-05-02T00:00:00.000Z');
    expect(updated.suggestions[0].decisionReason).toBe('Human approved this suggestion.');
    expect(updated.suggestions[0].planPath).toBe('plans/automation/finalise-2026-05-upgrade-plan.md');
    expect(updated.suggestions[0].createdMonth).toBe('2026-05');
    expect(updated.suggestions[0].lastSeenMonth).toBe('2026-06');
    expect(updated.suggestions[0].evidence).toContain('manual review');
    expect(updated.suggestions[0].evidence).toContain('No git commit command steps found in reviewed logs.');
  });

  it('persists rejected monthly follow-up suggestions to review artifacts and memory', async () => {
    const suggestion = createMemorySuggestion();
    const fixture = createFollowUpFixture([suggestion]);

    try {
      const result = await runMonthlyAutomationFollowUp({
        scriptName: 'finalise',
        monthKey: '2026-06',
        reviewPath: fixture.reviewPath,
        suggestionsPath: fixture.suggestionsPath,
        suggestions: [suggestion],
        knowledgeDirectory: fixture.knowledgeDirectory,
        repoRoot: fixture.root,
        output: createOutputSink(),
        now: () => new Date('2026-06-02T10:00:00.000Z'),
        decisionProvider: () => ({
          suggestionId: suggestion.id,
          action: 'reject',
          reason: 'Not worth the extra logging.',
        }),
      });

      const persistedSuggestions = readJson<AutomationMemorySuggestion[]>(fixture.suggestionsPath);
      const persistedMemory = readJson<AutomationMemory>(path.join(fixture.knowledgeDirectory, 'finalise-memory.json'));
      const review = readFileSync(fixture.reviewPath, 'utf8');

      expect(result.planPath).toBeUndefined();
      expect(persistedSuggestions[0].status).toBe('rejected');
      expect(persistedSuggestions[0].decisionReason).toBe('Not worth the extra logging.');
      expect(persistedSuggestions[0].decisionAt).toBe('2026-06-02T10:00:00.000Z');
      expect(review).toContain('## User Decisions');
      expect(review).toContain('rejected');
      expect(persistedMemory.suggestions[0].status).toBe('rejected');
      expect(persistedMemory.suggestions[0].decisionReason).toBe('Not worth the extra logging.');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('creates an approved monthly follow-up plan and records plan metadata', async () => {
    const suggestion = createMemorySuggestion();
    const fixture = createFollowUpFixture([suggestion]);

    try {
      const result = await runMonthlyAutomationFollowUp({
        scriptName: 'finalise',
        monthKey: '2026-06',
        reviewPath: fixture.reviewPath,
        suggestionsPath: fixture.suggestionsPath,
        suggestions: [suggestion],
        knowledgeDirectory: fixture.knowledgeDirectory,
        repoRoot: fixture.root,
        output: createOutputSink(),
        now: () => new Date('2026-06-02T10:00:00.000Z'),
        decisionProvider: () => ({
          suggestionId: suggestion.id,
          action: 'approve',
        }),
      });

      const persistedSuggestions = readJson<AutomationMemorySuggestion[]>(fixture.suggestionsPath);
      const persistedMemory = readJson<AutomationMemory>(path.join(fixture.knowledgeDirectory, 'finalise-memory.json'));

      expect(result.planPath).toBe(path.join(fixture.root, 'plans', 'automation', 'finalise-2026-06-upgrade-plan.md'));
      expect(existsSync(result.planPath!)).toBe(true);
      expect(readFileSync(result.planPath!, 'utf8')).toContain('## Implementation Steps');
      expect(readFileSync(result.planPath!, 'utf8')).toContain('Keep this plan file todo metadata aligned');
      expect(persistedSuggestions[0].status).toBe('approved');
      expect(persistedSuggestions[0].planPath).toBe('plans/automation/finalise-2026-06-upgrade-plan.md');
      expect(persistedMemory.suggestions[0].status).toBe('approved');
      expect(persistedMemory.suggestions[0].planPath).toBe('plans/automation/finalise-2026-06-upgrade-plan.md');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('prints a visible monthly follow-up outcome when there are no advisor suggestions', async () => {
    const fixture = createFollowUpFixture([]);
    const output = createOutputCapture();

    try {
      const result = await runMonthlyAutomationFollowUp({
        scriptName: 'finalise',
        monthKey: '2026-06',
        reviewPath: fixture.reviewPath,
        suggestionsPath: fixture.suggestionsPath,
        suggestions: [],
        knowledgeDirectory: fixture.knowledgeDirectory,
        repoRoot: fixture.root,
        output,
        isInteractive: false,
      });
      const renderedOutput = output.getOutput();

      expect(result.decisions).toEqual([]);
      expect(renderedOutput).toContain('Monthly automation advisor review for finalise (2026-06)');
      expect(renderedOutput).toContain('Advisor suggestions: 0');
      expect(renderedOutput).toContain('No monthly automation upgrade suggestions were found.');
      expect(renderedOutput).toContain('docs_private/automation/reviews/finalise/2026-06/review.md');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('writes a pending monthly follow-up artifact for chat resolution', () => {
    const suggestion = createMemorySuggestion();
    const fixture = createFollowUpFixture([suggestion]);
    const output = createOutputCapture();

    try {
      const result = writeMonthlyAutomationPendingFollowUp({
        scriptName: 'finalise',
        monthKey: '2026-06',
        reviewPath: fixture.reviewPath,
        suggestionsPath: fixture.suggestionsPath,
        suggestions: [suggestion],
        knowledgeDirectory: fixture.knowledgeDirectory,
        repoRoot: fixture.root,
        output,
      });
      const renderedOutput = output.getOutput();

      expect(result.pendingPath).toBe(path.join(fixture.root, 'docs_private', 'automation', 'follow-ups', 'finalise', '2026-06', 'pending-follow-up.json'));
      expect(existsSync(result.pendingPath!)).toBe(true);
      expect(renderedOutput).toContain('Pending monthly follow-up artifact:');
      expect(renderedOutput).toContain('Use the chat follow-up flow to approve, decline, or skip each suggestion.');

      const pending = readJson<{ scriptName: string; suggestions: AutomationMemorySuggestion[] }>(result.pendingPath!);
      expect(pending.scriptName).toBe('finalise');
      expect(pending.suggestions[0].id).toBe(suggestion.id);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('forces monthly follow-up prompting outside CI even when streams are not TTYs', async () => {
    const originalCi = process.env.CI;
    delete process.env.CI;
    const suggestion = createMemorySuggestion();
    const fixture = createFollowUpFixture([suggestion]);
    const output = createOutputCapture();

    try {
      const result = await runMonthlyAutomationFollowUp({
        scriptName: 'finalise',
        monthKey: '2026-06',
        reviewPath: fixture.reviewPath,
        suggestionsPath: fixture.suggestionsPath,
        suggestions: [suggestion],
        knowledgeDirectory: fixture.knowledgeDirectory,
        repoRoot: fixture.root,
        input: createInput(['a\n']),
        output,
      });
      const persistedSuggestions = readJson<AutomationMemorySuggestion[]>(fixture.suggestionsPath);

      expect(result.mode).toBe('interactive');
      expect(result.decisions[0]).toMatchObject({ suggestionId: suggestion.id, action: 'approve' });
      expect(persistedSuggestions[0].status).toBe('approved');
      expect(result.planPath).toBe(path.join(fixture.root, 'plans', 'automation', 'finalise-2026-06-upgrade-plan.md'));
      expect(output.getOutput()).toContain('Suggestion 1/1: approve, decline, or skip? [a/d/s]');
    } finally {
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('skips monthly follow-up prompts in non-interactive mode and leaves suggestions pending', async () => {
    const suggestion = createMemorySuggestion();
    const fixture = createFollowUpFixture([suggestion]);
    const output = createOutputCapture();

    try {
      const result = await runMonthlyAutomationFollowUp({
        scriptName: 'finalise',
        monthKey: '2026-06',
        reviewPath: fixture.reviewPath,
        suggestionsPath: fixture.suggestionsPath,
        suggestions: [suggestion],
        knowledgeDirectory: fixture.knowledgeDirectory,
        repoRoot: fixture.root,
        output,
        isInteractive: false,
      });

      const persistedSuggestions = readJson<AutomationMemorySuggestion[]>(fixture.suggestionsPath);
      const review = readFileSync(fixture.reviewPath, 'utf8');
      const renderedOutput = output.getOutput();

      expect(result.mode).toBe('non-interactive');
      expect(result.decisions).toEqual([]);
      expect(result.planPath).toBeUndefined();
      expect(persistedSuggestions[0].status).toBe('pending');
      expect(persistedSuggestions[0].decisionAt).toBeUndefined();
      expect(review).not.toContain('## User Decisions');
      expect(existsSync(path.join(fixture.knowledgeDirectory, 'finalise-memory.json'))).toBe(false);
      expect(renderedOutput).toContain('Non-interactive monthly follow-up mode detected.');
      expect(renderedOutput).toContain('Suggestions remain pending.');
      expect(renderedOutput).toContain('Ready-to-use Cursor prompt:');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('uses previous prompt context in evolved review prompts', () => {
    const review = renderAutomationAdvisorReview({
      advisorDirectory: '/tmp/not-used',
      scriptName: 'finalise',
      generatedAt: '2026-06-01T00:00:00.000Z',
      monthKey: '2026-06',
      previousPromptText: 'Previous prompt focused on build timing.',
      previousMetrics: {
        scriptName: 'finalise',
        month: '2026-05',
        generatedAt: '2026-05-01T00:00:00.000Z',
        runCount: 2,
        failureCount: 1,
        averageDurationMs: 1000,
        modeCounts: { standard: 2 },
      },
      logs: [
        createRunLog({
          id: 'finalise-2',
          scriptName: 'finalise',
          mode: 'standard',
          startedAt: '2026-06-01T00:00:00.000Z',
          steps: [],
        }),
      ],
    });

    expect(review).toContain('## Previous Advice And Outcomes');
    expect(review).toContain('Review the advisor report for finalise');
  });
});
