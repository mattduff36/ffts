import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { writeAutomationReviewPackage } from './advisor-review';
import {
  hasMonthlyReviewArtifact,
  loadAutomationMemory,
  readAutomationReviewHistory,
  saveAutomationMemory,
  updateAutomationMemory,
} from './memory';
import type {
  AutomationReviewArtifacts,
  AutomationReviewSuggestion,
  AutomationReviewSummary,
  AutomationRunLog,
  AutomationStepLog,
} from './types';

const RECENT_RUN_LIMIT = 20;

function readRunLogs(runDirectory: string): AutomationRunLog[] {
  if (!existsSync(runDirectory)) return [];

  return readdirSync(runDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => path.join(runDirectory, fileName))
    .map((filePath) => {
      try {
        return JSON.parse(readFileSync(filePath, 'utf8')) as AutomationRunLog;
      } catch {
        return null;
      }
    })
    .filter((log): log is AutomationRunLog => log !== null)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function getSlowestStep(logs: AutomationRunLog[]): AutomationStepLog | null {
  return logs
    .flatMap((log) => log.steps)
    .sort((left, right) => right.durationMs - left.durationMs)[0] ?? null;
}

function buildSuggestions(logs: AutomationRunLog[], latestLog: AutomationRunLog): AutomationReviewSuggestion[] {
  const recentLogs = logs.slice(0, RECENT_RUN_LIMIT);
  const failures = recentLogs.filter((log) => log.status === 'failed');
  const missingArtifacts = latestLog.artifacts.filter((artifact) => artifact.required && !artifact.exists);
  const slowestStep = getSlowestStep(recentLogs);
  const suggestions: AutomationReviewSuggestion[] = [];

  if (latestLog.status === 'failed') {
    suggestions.push({
      severity: 'action',
      message: 'Latest run failed. Review the failed step output before relying on this automation.',
    });
  }

  if (failures.length >= 3) {
    suggestions.push({
      severity: 'action',
      message: `${failures.length} of the last ${recentLogs.length} runs failed. Look for repeated failure patterns before extending this script.`,
    });
  }

  if (missingArtifacts.length > 0) {
    suggestions.push({
      severity: 'warning',
      message: `Expected artifact(s) missing: ${missingArtifacts.map((artifact) => artifact.path).join(', ')}.`,
    });
  }

  if (slowestStep && slowestStep.durationMs > 120_000) {
    suggestions.push({
      severity: 'info',
      message: `Slowest recent step is "${slowestStep.name}" at ${formatDuration(slowestStep.durationMs)}. Consider caching or narrowing scope if this keeps growing.`,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      severity: 'info',
      message: 'No immediate automation improvements suggested from recent logs.',
    });
  }

  return suggestions;
}

function writeMonthlyReview(
  reviewsDirectory: string,
  scriptName: string,
  logs: AutomationRunLog[],
  summary: AutomationReviewSummary
): AutomationReviewArtifacts | undefined {
  const monthKey = new Date().toISOString().slice(0, 7);
  const reviewDirectory = path.join(reviewsDirectory, scriptName, monthKey);
  const knowledgeDirectory = path.join(path.dirname(reviewsDirectory), 'knowledge');

  if (hasMonthlyReviewArtifact(reviewsDirectory, scriptName, monthKey)) return undefined;

  mkdirSync(reviewDirectory, { recursive: true });
  const memory = loadAutomationMemory(knowledgeDirectory, scriptName);
  const history = readAutomationReviewHistory({
    reviewsDirectory,
    scriptName,
    monthKey,
    memory,
  });
  const recentLogs = logs.slice(0, RECENT_RUN_LIMIT);
  const statusCounts = recentLogs.reduce(
    (acc, log) => {
      acc[log.status] += 1;
      return acc;
    },
    { passed: 0, failed: 0 }
  );
  const modeCounts = recentLogs.reduce<Record<string, number>>((acc, log) => {
    acc[log.mode] = (acc[log.mode] ?? 0) + 1;
    return acc;
  }, {});
  const deterministicSummaryLines = [
    `Runs reviewed: ${recentLogs.length}`,
    `Passed: ${statusCounts.passed}`,
    `Failed: ${statusCounts.failed}`,
    `Average duration: ${formatDuration(summary.averageDurationMs)}`,
    ...summary.suggestions.map((suggestion) => `[${suggestion.severity}] ${suggestion.message}`),
  ];
  const reviewPackage = writeAutomationReviewPackage({
    reviewDirectory,
    scriptName,
    logs,
    generatedAt: summary.generatedAt,
    monthKey,
    memory,
    previousReviewText: history.previousReviewText,
    previousPromptText: history.previousPromptText,
    previousMetrics: history.previousMetrics,
    previousSuggestions: history.previousSuggestions,
    deterministicSummaryLines,
  });

  const lines = [
    `# ${scriptName} Automation Self-Review`,
    '',
    `Generated: ${summary.generatedAt}`,
    `Runs reviewed: ${recentLogs.length}`,
    `Passed: ${statusCounts.passed}`,
    `Failed: ${statusCounts.failed}`,
    `Average duration: ${formatDuration(summary.averageDurationMs)}`,
    '',
    '## Usage',
    '',
    ...Object.entries(modeCounts).map(([mode, count]) => `- ${mode}: ${count} run(s)`),
    '',
    '## Suggestions',
    '',
    ...summary.suggestions.map((suggestion) => `- [${suggestion.severity}] ${suggestion.message}`),
    '',
    '## Monthly Artifacts',
    '',
    `- Review: ${path.relative(process.cwd(), reviewPackage.reviewPath)}`,
    `- Prompt: ${path.relative(process.cwd(), reviewPackage.promptPath)}`,
    `- Metrics: ${path.relative(process.cwd(), reviewPackage.metricsPath)}`,
    `- Suggestions: ${path.relative(process.cwd(), reviewPackage.suggestionsPath)}`,
    '',
    '## Recent Runs',
    '',
    ...recentLogs.slice(0, 10).map((log) => `- ${log.startedAt}: ${log.status} (${formatDuration(log.durationMs)})`),
    '',
  ];

  writeFileSync(path.join(reviewDirectory, 'deterministic-review.md'), lines.join('\n'), 'utf8');
  const nextMemory = updateAutomationMemory({
    memory,
    metrics: reviewPackage.packageData.metrics,
    prompt: {
      ...reviewPackage.packageData.prompt,
      path: reviewPackage.promptPath,
    },
    suggestions: reviewPackage.packageData.suggestions,
  });
  saveAutomationMemory(knowledgeDirectory, nextMemory);

  return {
    monthKey,
    reviewPath: reviewPackage.reviewPath,
    promptPath: reviewPackage.promptPath,
    metricsPath: reviewPackage.metricsPath,
    suggestionsPath: reviewPackage.suggestionsPath,
    suggestions: reviewPackage.packageData.suggestions,
    knowledgeDirectory,
    advisorReviewPath: reviewPackage.reviewPath,
  };
}

export function reviewAutomationRun(params: {
  runDirectory: string;
  reviewsDirectory: string;
  latestLog: AutomationRunLog;
}): AutomationReviewSummary {
  const logs = readRunLogs(params.runDirectory);
  const recentLogs = logs.slice(0, RECENT_RUN_LIMIT);
  const totalDuration = recentLogs.reduce((sum, log) => sum + log.durationMs, 0);
  const slowestStep = getSlowestStep(recentLogs);
  const summary: AutomationReviewSummary = {
    scriptName: params.latestLog.scriptName,
    generatedAt: new Date().toISOString(),
    runCount: logs.length,
    recentRunCount: recentLogs.length,
    recentFailureCount: recentLogs.filter((log) => log.status === 'failed').length,
    averageDurationMs: recentLogs.length > 0 ? Math.round(totalDuration / recentLogs.length) : 0,
    slowestStepName: slowestStep?.name ?? null,
    suggestions: buildSuggestions(logs, params.latestLog),
    monthlyReviewGenerated: false,
  };

  const monthlyReview = writeMonthlyReview(
    params.reviewsDirectory,
    params.latestLog.scriptName,
    logs,
    summary
  );

  return {
    ...summary,
    monthlyReviewPath: monthlyReview?.reviewPath,
    monthlyPromptPath: monthlyReview?.promptPath,
    monthlySuggestionsPath: monthlyReview?.suggestionsPath,
    monthlyReview,
    advisorReviewPath: monthlyReview?.advisorReviewPath,
    monthlyReviewGenerated: Boolean(monthlyReview),
  };
}

export function formatReviewForConsole(summary: AutomationReviewSummary): string {
  const lines = [
    '',
    'Automation self-review',
    `- Recent runs: ${summary.recentRunCount}`,
    `- Recent failures: ${summary.recentFailureCount}`,
    `- Average duration: ${formatDuration(summary.averageDurationMs)}`,
  ];

  for (const suggestion of summary.suggestions.slice(0, 5)) {
    lines.push(`- ${suggestion.severity.toUpperCase()}: ${suggestion.message}`);
  }

  if (summary.monthlyReviewGenerated && summary.monthlyReviewPath) {
    lines.push(`- Monthly review written: ${path.relative(process.cwd(), summary.monthlyReviewPath)}`);
  }
  if (summary.monthlyReviewGenerated && summary.monthlyPromptPath) {
    lines.push(`- Review prompt written: ${path.relative(process.cwd(), summary.monthlyPromptPath)}`);
  }
  if (summary.advisorReviewPath) {
    lines.push(`- Advisor review written: ${path.relative(process.cwd(), summary.advisorReviewPath)}`);
  }

  return lines.join('\n');
}
