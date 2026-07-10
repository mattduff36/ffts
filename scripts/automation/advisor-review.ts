import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type {
  AutomationMemory,
  AutomationMemorySuggestion,
  AutomationMonthlyMetrics,
  AutomationReviewPrompt,
  AutomationRunLog,
  AutomationStepLog,
} from './types';

interface AdvisorReviewOptions {
  advisorDirectory: string;
  scriptName: string;
  logs: AutomationRunLog[];
  generatedAt: string;
  monthKey: string;
  memory?: AutomationMemory;
  previousReviewText?: string;
  previousPromptText?: string;
  previousMetrics?: AutomationMonthlyMetrics;
  previousSuggestions?: AutomationMemorySuggestion[];
  deterministicSummaryLines?: string[];
}

interface AdvisorPackageOptions {
  scriptName: string;
  logs: AutomationRunLog[];
  generatedAt: string;
  monthKey: string;
  memory?: AutomationMemory;
  previousReviewText?: string;
  previousPromptText?: string;
  previousMetrics?: AutomationMonthlyMetrics;
  previousSuggestions?: AutomationMemorySuggestion[];
  deterministicSummaryLines?: string[];
}

interface AutomationAdvisorPackage {
  reviewMarkdown: string;
  promptMarkdown: string;
  metrics: AutomationMonthlyMetrics;
  suggestions: AutomationMemorySuggestion[];
  prompt: AutomationReviewPrompt;
}

interface FinaliseMetrics {
  reviewedLogs: AutomationRunLog[];
  modeCounts: Record<string, number>;
  failedRuns: AutomationRunLog[];
  slowestSteps: AutomationStepLog[];
  averageDurationMs: number;
  durationTrend: string;
  fullTestRuns: number;
  buildSteps: AutomationStepLog[];
  migrationRuns: number;
  dbValidateRuns: number;
  commitCommands: AutomationStepLog[];
  pushCommands: AutomationStepLog[];
}

interface FixErrorsMetrics {
  reviewedLogs: AutomationRunLog[];
  totalFetched: number;
  totalFiltered: number;
  totalGrouped: number;
  fetchLimitHitCount: number;
  highFilteredRuns: number;
  repeatedPatterns: Array<{ key: string; runs: number; occurrences: number }>;
  repeatedSourceFiles: Array<{ file: string; count: number }>;
  fixLogStatusCounts: Record<string, number>;
  noSourcePatternCount: number;
}

const REVIEW_LIMIT = 50;
const FINALISE_MODES = ['standard', 'full', 'push', 'full + push', 'dry-run'];

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getReviewedLogs(logs: AutomationRunLog[], monthKey: string): AutomationRunLog[] {
  const monthlyLogs = logs.filter((log) => log.startedAt.startsWith(monthKey));
  const selectedLogs = monthlyLogs.length > 0 ? monthlyLogs : logs;
  return selectedLogs
    .slice()
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, REVIEW_LIMIT);
}

function getMetadataNumber(step: AutomationStepLog | undefined, key: string): number {
  const value = step?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getMetadataArray(step: AutomationStepLog | undefined, key: string): unknown[] {
  const value = step?.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function incrementCount(map: Map<string, number>, key: string, value = 1): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function getModeLabel(log: AutomationRunLog): string {
  if (log.args.includes('--dry-run')) return 'dry-run';
  return FINALISE_MODES.includes(log.mode) ? log.mode : 'standard';
}

function getDurationTrend(logs: AutomationRunLog[]): string {
  const chronologicalLogs = logs.slice().sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  if (chronologicalLogs.length < 4) return 'Not enough runs to calculate a meaningful trend.';

  const midpoint = Math.floor(chronologicalLogs.length / 2);
  const earlierAverage = average(chronologicalLogs.slice(0, midpoint).map((log) => log.durationMs));
  const recentAverage = average(chronologicalLogs.slice(midpoint).map((log) => log.durationMs));
  const difference = recentAverage - earlierAverage;

  if (Math.abs(difference) < 5000) {
    return `Stable: recent average ${formatDuration(recentAverage)} vs earlier ${formatDuration(earlierAverage)}.`;
  }

  const direction = difference > 0 ? 'Slower' : 'Faster';
  return `${direction}: recent average ${formatDuration(recentAverage)} vs earlier ${formatDuration(earlierAverage)}.`;
}

function collectFinaliseMetrics(logs: AutomationRunLog[], monthKey: string): FinaliseMetrics {
  const reviewedLogs = getReviewedLogs(logs, monthKey);
  const modeCounts = Object.fromEntries(FINALISE_MODES.map((mode) => [mode, 0]));
  for (const log of reviewedLogs) {
    modeCounts[getModeLabel(log)] = (modeCounts[getModeLabel(log)] ?? 0) + 1;
  }

  const steps = reviewedLogs.flatMap((log) => log.steps);
  return {
    reviewedLogs,
    modeCounts,
    failedRuns: reviewedLogs.filter((log) => log.status === 'failed'),
    slowestSteps: steps.slice().sort((left, right) => right.durationMs - left.durationMs).slice(0, 5),
    averageDurationMs: average(reviewedLogs.map((log) => log.durationMs)),
    durationTrend: getDurationTrend(reviewedLogs),
    fullTestRuns: reviewedLogs.filter((log) => ['full', 'full + push'].includes(getModeLabel(log))).length,
    buildSteps: steps.filter((step) => step.command === 'npm run build' || step.name.toLowerCase().includes('build')),
    migrationRuns: steps.filter((step) => {
      if (step.name !== 'Run pending local migrations') return false;
      return getMetadataArray(step, 'migrationFiles').length > 0;
    }).length,
    dbValidateRuns: steps.filter((step) => step.command === 'npm run db:validate').length,
    commitCommands: steps.filter((step) => step.command?.startsWith('git commit')),
    pushCommands: steps.filter((step) => step.command?.startsWith('git push')),
  };
}

function getPatternKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const pattern = value as { errorType?: unknown; component?: unknown; normalizedMessage?: unknown; occurrences?: unknown };
  const errorType = typeof pattern.errorType === 'string' ? pattern.errorType : 'Unknown';
  const component = typeof pattern.component === 'string' ? pattern.component : 'Unknown';
  const message = typeof pattern.normalizedMessage === 'string' ? pattern.normalizedMessage : 'Unknown';
  return `${errorType} in ${component}: ${message}`;
}

function getPatternOccurrences(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const occurrences = (value as { occurrences?: unknown }).occurrences;
  return typeof occurrences === 'number' ? occurrences : 0;
}

function getPatternSourceFiles(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const sourceFiles = (value as { sourceFiles?: unknown }).sourceFiles;
  return Array.isArray(sourceFiles) ? sourceFiles.filter((file): file is string => typeof file === 'string') : [];
}

function collectFixErrorsMetrics(logs: AutomationRunLog[], monthKey: string): FixErrorsMetrics {
  const reviewedLogs = getReviewedLogs(logs, monthKey);
  const patternRuns = new Map<string, number>();
  const patternOccurrences = new Map<string, number>();
  const sourceFiles = new Map<string, number>();
  const fixLogStatusCounts: Record<string, number> = {};
  let totalFetched = 0;
  let totalFiltered = 0;
  let totalGrouped = 0;
  let fetchLimitHitCount = 0;
  let highFilteredRuns = 0;
  let noSourcePatternCount = 0;

  for (const log of reviewedLogs) {
    const reportStep = log.steps.find((step) => step.name === 'Write error analysis report')
      ?? log.steps.find((step) => step.name === 'Group errors into patterns');
    const fixLogStep = log.steps.find((step) => step.name === 'Summarise historical error fix log')
      ?? log.steps.find((step) => step.name === 'Update historical error fix log');
    const fetched = getMetadataNumber(reportStep, 'totalFetched');
    const afterFiltering = getMetadataNumber(reportStep, 'afterFiltering');
    const patternsFound = getMetadataNumber(reportStep, 'patternsFound');
    totalFetched += fetched;
    totalFiltered += Math.max(fetched - afterFiltering, 0);
    totalGrouped += patternsFound;
    if (fetched >= 200) fetchLimitHitCount += 1;
    if (fetched > 0 && (fetched - afterFiltering) / fetched > 0.75) highFilteredRuns += 1;
    noSourcePatternCount += getMetadataNumber(reportStep, 'patternsWithoutSourceFiles');

    for (const pattern of getMetadataArray(reportStep, 'topPatterns')) {
      const key = getPatternKey(pattern);
      if (!key) continue;
      incrementCount(patternRuns, key);
      incrementCount(patternOccurrences, key, getPatternOccurrences(pattern));
      for (const file of getPatternSourceFiles(pattern)) incrementCount(sourceFiles, file);
    }

    const statusCounts = fixLogStep?.metadata?.statusCounts;
    if (statusCounts && typeof statusCounts === 'object') {
      for (const [status, count] of Object.entries(statusCounts)) {
        if (typeof count === 'number') fixLogStatusCounts[status] = (fixLogStatusCounts[status] ?? 0) + count;
      }
    }
  }

  return {
    reviewedLogs,
    totalFetched,
    totalFiltered,
    totalGrouped,
    fetchLimitHitCount,
    highFilteredRuns,
    repeatedPatterns: Array.from(patternRuns.entries())
      .map(([key, runs]) => ({ key, runs, occurrences: patternOccurrences.get(key) ?? 0 }))
      .filter((pattern) => pattern.runs > 1 || pattern.occurrences > 1)
      .sort((left, right) => right.occurrences - left.occurrences)
      .slice(0, 10),
    repeatedSourceFiles: Array.from(sourceFiles.entries())
      .map(([file, count]) => ({ file, count }))
      .filter((entry) => entry.count > 1)
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
    fixLogStatusCounts,
    noSourcePatternCount,
  };
}

function renderList(items: string[], emptyText: string): string[] {
  if (items.length === 0) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80);
}

function createSuggestion(params: {
  scriptName: string;
  monthKey: string;
  id: string;
  title: string;
  reason: string;
  evidence: string[];
}): AutomationMemorySuggestion {
  return {
    id: `${params.scriptName}-${slugify(params.id)}`,
    scriptName: params.scriptName,
    title: params.title,
    reason: params.reason,
    evidence: params.evidence,
    createdMonth: params.monthKey,
    lastSeenMonth: params.monthKey,
    status: 'pending',
    source: 'advisor',
  };
}

function createGenericMetrics(params: {
  scriptName: string;
  monthKey: string;
  generatedAt: string;
  logs: AutomationRunLog[];
  modeCounts?: Record<string, number>;
}): AutomationMonthlyMetrics {
  const reviewedLogs = getReviewedLogs(params.logs, params.monthKey);
  const modeCounts = params.modeCounts ?? reviewedLogs.reduce<Record<string, number>>((acc, log) => {
    acc[log.mode] = (acc[log.mode] ?? 0) + 1;
    return acc;
  }, {});

  return {
    scriptName: params.scriptName,
    month: params.monthKey,
    generatedAt: params.generatedAt,
    runCount: reviewedLogs.length,
    failureCount: reviewedLogs.filter((log) => log.status === 'failed').length,
    averageDurationMs: average(reviewedLogs.map((log) => log.durationMs)),
    modeCounts,
  };
}

function buildFinaliseMetrics(options: AdvisorPackageOptions, metrics: FinaliseMetrics): AutomationMonthlyMetrics {
  const buildAverage = average(metrics.buildSteps.map((step) => step.durationMs));
  return {
    ...createGenericMetrics({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      generatedAt: options.generatedAt,
      logs: options.logs,
      modeCounts: metrics.modeCounts,
    }),
    finalise: {
      fullTestRuns: metrics.fullTestRuns,
      buildAverageMs: buildAverage,
      migrationRuns: metrics.migrationRuns,
      dbValidateRuns: metrics.dbValidateRuns,
      commitCommandCount: metrics.commitCommands.length,
      pushCommandCount: metrics.pushCommands.length,
    },
  };
}

function buildFixErrorsMetrics(options: AdvisorPackageOptions, metrics: FixErrorsMetrics): AutomationMonthlyMetrics {
  const untriagedCount = metrics.fixLogStatusCounts.untriaged ?? 0;
  const staleCount = metrics.fixLogStatusCounts.stale ?? 0;
  return {
    ...createGenericMetrics({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      generatedAt: options.generatedAt,
      logs: options.logs,
    }),
    fixerrors: {
      totalFetched: metrics.totalFetched,
      totalFiltered: metrics.totalFiltered,
      totalGrouped: metrics.totalGrouped,
      fetchLimitHitCount: metrics.fetchLimitHitCount,
      highFilteredRuns: metrics.highFilteredRuns,
      untriagedCount,
      staleCount,
      repeatedPatternCount: metrics.repeatedPatterns.length,
      repeatedSourceFileCount: metrics.repeatedSourceFiles.length,
    },
  };
}

function renderPreviousAdvice(memory?: AutomationMemory, previousSuggestions: AutomationMemorySuggestion[] = []): string[] {
  const suggestions = previousSuggestions.length > 0
    ? previousSuggestions
    : memory?.suggestions.slice(-5) ?? [];

  return renderList(
    suggestions.map((suggestion) => {
      const outcome = suggestion.outcome ? `, outcome=${suggestion.outcome.result}` : '';
      return `${suggestion.id}: ${suggestion.status}${outcome} - ${suggestion.title}`;
    }),
    'No previous suggestions or outcomes found.'
  );
}

function buildPrompt(params: {
  scriptName: string;
  monthKey: string;
  focusAreas: string[];
  deprioritizedAreas: string[];
  previousPromptText?: string;
  previousMetrics?: AutomationMonthlyMetrics;
}): AutomationReviewPrompt {
  const previousContext = params.previousPromptText
    ? 'Use the previous prompt as context, but improve it based on this month\'s evidence.'
    : 'No previous prompt was found, so establish a baseline review prompt.';
  const previousMetricsContext = params.previousMetrics
    ? `Previous month: ${params.previousMetrics.month}, runs=${params.previousMetrics.runCount}, failures=${params.previousMetrics.failureCount}.`
    : 'No previous month metrics were found.';
  const prompt = [
    `Review ${params.scriptName} automation for ${params.monthKey}.`,
    previousContext,
    previousMetricsContext,
    '',
    'Focus on measurable friction, repeated ignored warnings, recurring failures, and whether previous suggestions helped.',
    'Avoid generic advice. Suggest script or process changes only when logs, metrics, or memory provide evidence.',
    'Do not edit scripts automatically. Present suggested changes for human approval first.',
    '',
    'Priority focus areas:',
    ...renderList(params.focusAreas, 'Maintain baseline coverage and watch for emerging friction.'),
    '',
    'Deprioritized areas:',
    ...renderList(params.deprioritizedAreas, 'No areas are explicitly deprioritized yet.'),
  ].join('\n');

  return {
    month: params.monthKey,
    focusAreas: params.focusAreas,
    deprioritizedAreas: params.deprioritizedAreas,
    prompt,
  };
}

function renderCursorPrompt(scriptName: string): string[] {
  return [
    '```text',
    `Review the advisor report for ${scriptName} and the current automation script implementation.`,
    'Do not implement every suggestion automatically.',
    'First, list the suggested changes as approval checkboxes and ask me which ones to apply.',
    'After I approve specific items, implement only those approved changes, keep deterministic checks intact, store logs under docs_private/automation, run focused tests, and do not run a production build, commit, or push.',
    '```',
  ];
}

function renderDeterministicSummary(lines: string[] | undefined): string[] {
  if (!lines || lines.length === 0) return [];
  return [
    '## Deterministic Safety Check Summary',
    '',
    ...lines.map((line) => `- ${line}`),
    '',
  ];
}

function buildFinaliseSuggestions(options: AdvisorPackageOptions, metrics: FinaliseMetrics): AutomationMemorySuggestion[] {
  const buildAverage = average(metrics.buildSteps.map((step) => step.durationMs));
  const fullTestRatio = metrics.reviewedLogs.length > 0 ? metrics.fullTestRuns / metrics.reviewedLogs.length : 0;
  const suggestions: AutomationMemorySuggestion[] = [];

  if (metrics.slowestSteps[0] && metrics.slowestSteps[0].durationMs > 120_000) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'add-timing-summaries',
      title: 'Add targeted timing summaries around slow finalise steps',
      reason: `Slowest step was ${metrics.slowestSteps[0].name} at ${formatDuration(metrics.slowestSteps[0].durationMs)}.`,
      evidence: [`${metrics.slowestSteps[0].name}: ${metrics.slowestSteps[0].durationMs}ms`],
    }));
  }

  if (metrics.reviewedLogs.length >= 3 && fullTestRatio < 0.25) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'nudge-full-tests-for-risky-changes',
      title: 'Suggest full finalise for high-risk changes',
      reason: 'Full test mode is rarely used in reviewed finalise runs.',
      evidence: [`Full runs: ${metrics.fullTestRuns}/${metrics.reviewedLogs.length}`],
    }));
  }

  if (buildAverage > 120_000) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'investigate-build-caching',
      title: 'Investigate build caching or scope improvements',
      reason: `Builds average ${formatDuration(buildAverage)}.`,
      evidence: [`Build average: ${buildAverage}ms`],
    }));
  }

  if (metrics.commitCommands.length === 0) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'record-commit-outcome-metadata',
      title: 'Record explicit commit created/skipped metadata',
      reason: 'Future reviews cannot distinguish healthy commit skips from commit failures.',
      evidence: ['No git commit command steps found in reviewed logs.'],
    }));
  }

  if (metrics.pushCommands.length === 0) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'record-push-outcome-metadata',
      title: 'Record explicit push skipped/pushed metadata',
      reason: 'Future reviews cannot distinguish healthy push skips from push failures.',
      evidence: ['No git push command steps found in reviewed logs.'],
    }));
  }

  return suggestions;
}

function buildFinalisePackage(options: AdvisorPackageOptions): AutomationAdvisorPackage {
  const metrics = collectFinaliseMetrics(options.logs, options.monthKey);
  const monthlyMetrics = buildFinaliseMetrics(options, metrics);
  const suggestions = buildFinaliseSuggestions(options, metrics);
  const buildAverage = average(metrics.buildSteps.map((step) => step.durationMs));
  const failingBuilds = metrics.buildSteps.filter((step) => step.status === 'failed').length;
  const fullTestRatio = metrics.reviewedLogs.length > 0 ? metrics.fullTestRuns / metrics.reviewedLogs.length : 0;
  const risks = [
    ...renderList(metrics.failedRuns.map((log) => `${log.startedAt}: ${log.error ?? 'failed run'}`), 'No failed runs found in reviewed logs.'),
    ...(fullTestRatio < 0.25 && metrics.reviewedLogs.length >= 3 ? ['Full tests are rarely used; consider a reminder when changes touch risky areas.'] : []),
    ...(buildAverage > 120_000 ? [`Builds average ${formatDuration(buildAverage)}; investigate cache or scope improvements.`] : []),
    ...(failingBuilds > 0 ? [`${failingBuilds} build step(s) failed.`] : []),
  ];
  const scriptSuggestions = suggestions.map((suggestion) => `${suggestion.title}: ${suggestion.reason}`);
  const processSuggestions = [
    ...(fullTestRatio < 0.25 && metrics.reviewedLogs.length >= 3 ? ['Use `finalise full` before high-risk database, auth, or workflow changes.'] : []),
    ...(metrics.migrationRuns > 0 && metrics.dbValidateRuns === 0 ? ['Check whether schema-risk migrations should be forcing `db:validate`.'] : []),
  ];
  const doNothingReasons = [
    ...(metrics.failedRuns.length === 0 ? ['No failures or interrupted runs were found.'] : []),
    ...(buildAverage > 0 && buildAverage <= 120_000 ? [`Build timing is below the slow-build threshold (${formatDuration(buildAverage)} average).`] : []),
    ...(metrics.fullTestRuns > 0 ? ['Full test mode has been exercised in the reviewed period.'] : []),
  ];
  const focusAreas = Array.from(new Set([
    ...suggestions.map((suggestion) => suggestion.title),
    ...((options.memory?.suggestions ?? [])
      .filter((suggestion) => suggestion.status === 'pending')
      .slice(-3)
      .map((suggestion) => suggestion.title)),
  ]));
  const deprioritizedAreas = [
    ...(metrics.failedRuns.length === 0 ? ['Failure recovery'] : []),
    ...(metrics.pushCommands.length === 0 ? ['Push failures until push mode is used'] : []),
  ];
  const prompt = buildPrompt({
    scriptName: options.scriptName,
    monthKey: options.monthKey,
    focusAreas,
    deprioritizedAreas,
    previousPromptText: options.previousPromptText,
    previousMetrics: options.previousMetrics,
  });

  const reviewMarkdown = [
    `# finalise Advisor Review`,
    '',
    `Generated: ${options.generatedAt}`,
    `Month: ${options.monthKey}`,
    `Runs reviewed: ${metrics.reviewedLogs.length}`,
    '',
    ...renderDeterministicSummary(options.deterministicSummaryLines),
    '## Executive Summary',
    '',
    `The finalise workflow ran ${metrics.reviewedLogs.length} time(s), with ${metrics.failedRuns.length} failed run(s). Average duration was ${formatDuration(metrics.averageDurationMs)}. ${metrics.durationTrend}`,
    '',
    '## What Changed This Month',
    '',
    ...FINALISE_MODES.map((mode) => `- ${mode}: ${metrics.modeCounts[mode] ?? 0} run(s)`),
    `- Full test runs: ${metrics.fullTestRuns}`,
    `- Migration runs: ${metrics.migrationRuns}`,
    `- db:validate runs: ${metrics.dbValidateRuns}`,
    `- Commit commands observed: ${metrics.commitCommands.length}`,
    `- Push commands observed: ${metrics.pushCommands.length}`,
    '',
    '## Risks Or Repeated Friction',
    '',
    ...risks.map((item) => item.startsWith('- ') ? item : `- ${item}`),
    '',
    '## Suggested Script Improvements',
    '',
    ...renderList(scriptSuggestions, 'No script changes are justified by the current finalise logs.'),
    '',
    '## Suggested Codebase/Process Improvements',
    '',
    ...renderList(processSuggestions, 'No codebase or process changes are justified by the current finalise logs.'),
    '',
    '## Do Nothing Reasons',
    '',
    ...renderList(doNothingReasons, 'There is not enough clean evidence to justify doing nothing yet.'),
    '',
    '## Previous Advice And Outcomes',
    '',
    ...renderPreviousAdvice(options.memory, options.previousSuggestions),
    '',
    '## Slowest Steps',
    '',
    ...renderList(metrics.slowestSteps.map((step) => `${step.name}: ${formatDuration(step.durationMs)} (${step.status})`), 'No step timing data found.'),
    '',
    '## Copy/Paste Cursor Prompt',
    '',
    ...renderCursorPrompt('finalise'),
    '',
  ].join('\n');

  return {
    reviewMarkdown,
    promptMarkdown: renderReviewPromptMarkdown(options.scriptName, prompt),
    metrics: monthlyMetrics,
    suggestions,
    prompt,
  };
}

function buildFixErrorsSuggestions(options: AdvisorPackageOptions, metrics: FixErrorsMetrics): AutomationMemorySuggestion[] {
  const filteredRatio = metrics.totalFetched > 0 ? metrics.totalFiltered / metrics.totalFetched : 0;
  const suggestions: AutomationMemorySuggestion[] = [];

  if (metrics.fetchLimitHitCount > 0) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'paginate-fetch-limit',
      title: 'Paginate error log fetching or make the limit configurable',
      reason: 'The 200-log fetch limit was reached in reviewed logs.',
      evidence: [`Fetch limit hit count: ${metrics.fetchLimitHitCount}`],
    }));
  }

  if (filteredRatio > 0.75) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'summarise-filtered-out-errors',
      title: 'Add a monthly filtered-out error summary',
      reason: 'A high ratio of fetched errors were filtered out as localhost/admin.',
      evidence: [`Filtered ratio: ${(filteredRatio * 100).toFixed(1)}%`],
    }));
  }

  if (metrics.noSourcePatternCount > 0) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'improve-source-extraction',
      title: 'Improve source extraction when stack traces lack source files',
      reason: 'Some patterns had no source files, making Cursor fixes harder.',
      evidence: [`Patterns without source files: ${metrics.noSourcePatternCount}`],
    }));
  }

  if (metrics.repeatedPatterns.length > 0) {
    suggestions.push(createSuggestion({
      scriptName: options.scriptName,
      monthKey: options.monthKey,
      id: 'surface-repeated-pattern-deltas',
      title: 'Surface repeated production patterns as deltas',
      reason: 'Recurring production errors should stand out as likely regression-test candidates.',
      evidence: metrics.repeatedPatterns.slice(0, 3).map((pattern) => pattern.key),
    }));
  }

  return suggestions;
}

function buildFixErrorsPackage(options: AdvisorPackageOptions): AutomationAdvisorPackage {
  const metrics = collectFixErrorsMetrics(options.logs, options.monthKey);
  const monthlyMetrics = buildFixErrorsMetrics(options, metrics);
  const suggestions = buildFixErrorsSuggestions(options, metrics);
  const filteredRatio = metrics.totalFetched > 0 ? metrics.totalFiltered / metrics.totalFetched : 0;
  const untriagedCount = metrics.fixLogStatusCounts.untriaged ?? 0;
  const staleCount = metrics.fixLogStatusCounts.stale ?? 0;
  const risks = [
    ...(metrics.fetchLimitHitCount > 0 ? [`The 200-log fetch limit was hit ${metrics.fetchLimitHitCount} time(s); increase or paginate before trusting monthly totals.`] : []),
    ...(metrics.highFilteredRuns > 0 ? [`${metrics.highFilteredRuns} run(s) filtered more than 75% of fetched errors; review localhost/admin filtering periodically.`] : []),
    ...(metrics.repeatedPatterns.length > 0 ? [`${metrics.repeatedPatterns.length} repeated pattern(s) appeared across reviewed logs.`] : []),
    ...(untriagedCount > 0 ? [`Fix log contains ${untriagedCount} untriaged entr${untriagedCount === 1 ? 'y' : 'ies'}.`] : []),
    ...(staleCount > 0 ? [`Fix log contains ${staleCount} stale entr${staleCount === 1 ? 'y' : 'ies'}.`] : []),
  ];
  const scriptSuggestions = suggestions.map((suggestion) => `${suggestion.title}: ${suggestion.reason}`);
  const processSuggestions = [
    ...(metrics.repeatedSourceFiles.length > 0 ? ['Add focused regression tests around source files that recur in production errors.'] : []),
    ...(metrics.repeatedPatterns.length > 0 ? ['Treat repeated production patterns as test backlog candidates, not only one-off fixes.'] : []),
  ];
  const doNothingReasons = [
    ...(metrics.fetchLimitHitCount === 0 ? ['The 200-log fetch limit was not hit in reviewed logs.'] : []),
    ...(metrics.repeatedPatterns.length === 0 ? ['No repeated high-frequency patterns were visible in logged metadata.'] : []),
    ...(untriagedCount === 0 ? ['No untriaged fix-log entries were reported in logged metadata.'] : []),
  ];
  const focusAreas = Array.from(new Set([
    ...suggestions.map((suggestion) => suggestion.title),
    ...((options.memory?.suggestions ?? [])
      .filter((suggestion) => suggestion.status === 'pending')
      .slice(-3)
      .map((suggestion) => suggestion.title)),
  ]));
  const deprioritizedAreas = [
    ...(metrics.fetchLimitHitCount === 0 ? ['Fetch-limit changes until the limit is hit'] : []),
    ...(metrics.repeatedPatterns.length === 0 ? ['Repeated-pattern test work until recurrence is visible'] : []),
  ];
  const prompt = buildPrompt({
    scriptName: options.scriptName,
    monthKey: options.monthKey,
    focusAreas,
    deprioritizedAreas,
    previousPromptText: options.previousPromptText,
    previousMetrics: options.previousMetrics,
  });

  const reviewMarkdown = [
    `# fixerrors Advisor Review`,
    '',
    `Generated: ${options.generatedAt}`,
    `Month: ${options.monthKey}`,
    `Runs reviewed: ${metrics.reviewedLogs.length}`,
    '',
    ...renderDeterministicSummary(options.deterministicSummaryLines),
    '## Executive Summary',
    '',
    `fixerrors fetched ${metrics.totalFetched} error log row(s), filtered ${metrics.totalFiltered}, and grouped ${metrics.totalGrouped} pattern(s). Filtered ratio: ${(filteredRatio * 100).toFixed(1)}%.`,
    '',
    '## What Changed This Month',
    '',
    `- Total fetched: ${metrics.totalFetched}`,
    `- Total filtered: ${metrics.totalFiltered}`,
    `- Total grouped patterns: ${metrics.totalGrouped}`,
    `- Fetch limit hit count: ${metrics.fetchLimitHitCount}`,
    `- Fix-log statuses: ${Object.entries(metrics.fixLogStatusCounts).map(([status, count]) => `${status}=${count}`).join(', ') || 'none captured'}`,
    '',
    '## Risks Or Repeated Friction',
    '',
    ...renderList(risks, 'No repeated friction was found in the reviewed fixerrors logs.'),
    '',
    '## Suggested Script Improvements',
    '',
    ...renderList(scriptSuggestions, 'No fixerrors script changes are justified by the current logs.'),
    '',
    '## Suggested Codebase/Process Improvements',
    '',
    ...renderList(processSuggestions, 'No codebase or process changes are justified by the current fixerrors logs.'),
    '',
    '## Do Nothing Reasons',
    '',
    ...renderList(doNothingReasons, 'There is not enough clean evidence to justify doing nothing yet.'),
    '',
    '## Previous Advice And Outcomes',
    '',
    ...renderPreviousAdvice(options.memory, options.previousSuggestions),
    '',
    '## Repeated Error Patterns',
    '',
    ...renderList(metrics.repeatedPatterns.map((pattern) => `${pattern.key} (${pattern.occurrences} occurrence(s), ${pattern.runs} run(s))`), 'No repeated high-frequency patterns captured.'),
    '',
    '## Repeated Source Files',
    '',
    ...renderList(metrics.repeatedSourceFiles.map((entry) => `${entry.file}: ${entry.count} occurrence(s)`), 'No repeated source files captured.'),
    '',
    '## Copy/Paste Cursor Prompt',
    '',
    ...renderCursorPrompt('fixerrors'),
    '',
  ].join('\n');

  return {
    reviewMarkdown,
    promptMarkdown: renderReviewPromptMarkdown(options.scriptName, prompt),
    metrics: monthlyMetrics,
    suggestions,
    prompt,
  };
}

function renderReviewPromptMarkdown(scriptName: string, prompt: AutomationReviewPrompt): string {
  return [
    `# ${scriptName} Evolved Review Prompt`,
    '',
    `Month: ${prompt.month}`,
    '',
    '## Focus Areas',
    '',
    ...renderList(prompt.focusAreas, 'Maintain baseline review coverage.'),
    '',
    '## Deprioritized Areas',
    '',
    ...renderList(prompt.deprioritizedAreas, 'No areas deprioritized.'),
    '',
    '## Prompt',
    '',
    '```text',
    prompt.prompt,
    '```',
    '',
  ].join('\n');
}

export function createAutomationAdvisorPackage(options: AdvisorPackageOptions): AutomationAdvisorPackage {
  if (options.scriptName === 'finalise') return buildFinalisePackage(options);
  if (options.scriptName === 'fixerrors') return buildFixErrorsPackage(options);

  const monthlyMetrics = createGenericMetrics({
    scriptName: options.scriptName,
    monthKey: options.monthKey,
    generatedAt: options.generatedAt,
    logs: options.logs,
  });
  const prompt = buildPrompt({
    scriptName: options.scriptName,
    monthKey: options.monthKey,
    focusAreas: [],
    deprioritizedAreas: [],
    previousPromptText: options.previousPromptText,
    previousMetrics: options.previousMetrics,
  });

  return {
    reviewMarkdown: [
      `# ${options.scriptName} Advisor Review`,
      '',
      `Generated: ${options.generatedAt}`,
      `Month: ${options.monthKey}`,
      `Runs reviewed: ${monthlyMetrics.runCount}`,
      '',
      ...renderDeterministicSummary(options.deterministicSummaryLines),
      '## Executive Summary',
      '',
      'No script-specific advisor is configured yet. The deterministic review still applies.',
      '',
      '## Copy/Paste Cursor Prompt',
      '',
      ...renderCursorPrompt(options.scriptName),
      '',
    ].join('\n'),
    promptMarkdown: renderReviewPromptMarkdown(options.scriptName, prompt),
    metrics: monthlyMetrics,
    suggestions: [],
    prompt,
  };
}

export function renderAutomationAdvisorReview(options: AdvisorReviewOptions): string {
  return createAutomationAdvisorPackage(options).reviewMarkdown;
}

export function writeAutomationAdvisorReview(options: AdvisorReviewOptions): string {
  const reviewDirectory = path.join(options.advisorDirectory, options.scriptName);
  const reviewPath = path.join(reviewDirectory, `${options.monthKey}.md`);
  mkdirSync(reviewDirectory, { recursive: true });
  writeFileSync(reviewPath, createAutomationAdvisorPackage(options).reviewMarkdown, 'utf8');
  return reviewPath;
}

export function writeAutomationReviewPackage(params: AdvisorPackageOptions & { reviewDirectory: string }): {
  reviewPath: string;
  promptPath: string;
  metricsPath: string;
  suggestionsPath: string;
  packageData: AutomationAdvisorPackage;
} {
  const packageData = createAutomationAdvisorPackage(params);
  mkdirSync(params.reviewDirectory, { recursive: true });

  const reviewPath = path.join(params.reviewDirectory, 'review.md');
  const promptPath = path.join(params.reviewDirectory, 'review-prompt.md');
  const metricsPath = path.join(params.reviewDirectory, 'metrics.json');
  const suggestionsPath = path.join(params.reviewDirectory, 'suggestions.json');

  writeFileSync(reviewPath, packageData.reviewMarkdown, 'utf8');
  writeFileSync(promptPath, packageData.promptMarkdown, 'utf8');
  writeFileSync(metricsPath, JSON.stringify(packageData.metrics, null, 2), 'utf8');
  writeFileSync(suggestionsPath, JSON.stringify(packageData.suggestions, null, 2), 'utf8');

  return {
    reviewPath,
    promptPath,
    metricsPath,
    suggestionsPath,
    packageData,
  };
}
