import {
  getProductReleaseFiles,
  getReleaseDescriptorMatches,
  normalizeReleasePath,
  uniqueReleaseValues,
  type ReleaseImpactInput,
  type ReleaseImpactMatch,
} from '../lib/config/release-module-descriptors';

export interface FinaliseChangeSummary {
  commitMessage: string;
  fileCount: number;
  areas: string[];
}

export interface FinaliseReleaseTaskEvidence {
  area: string;
  subject: string;
  files: string[];
  fileCount: number;
  additions: number;
  deletions: number;
}

export interface FinaliseReleaseSummaryEvidence {
  commitMessages: string[];
  areas: string[];
  tasks: FinaliseReleaseTaskEvidence[];
  fallbackFiles: string[];
}

export interface FinaliseChangedFile {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface FinaliseTimingEntry {
  label: string;
  durationMs: number;
  status?: 'completed' | 'failed' | 'reused' | 'skipped';
}

interface FinaliseTimingSummaryOptions {
  limit?: number;
  slowThresholdMs?: number;
}

const SKIP_VERSION_MARKER = '[skip version]';
const DEFAULT_SLOW_TIMING_THRESHOLD_MS = 30_000;
const DEFAULT_TIMING_SUMMARY_LIMIT = 5;
const CONVENTIONAL_COMMIT_PATTERN =
  /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/iu;

interface ParsedSummaryCommit {
  raw: string;
  scope: string | null;
  subject: string;
}

function joinAreas(areas: string[]): string {
  if (areas.length === 0) return 'repository files';
  if (areas.length === 1) return areas[0];
  if (areas.length === 2) return `${areas[0]} and ${areas[1]}`;
  return `${areas.slice(0, -1).join(', ')}, and ${areas[areas.length - 1]}`;
}

function getFallbackScope(changedFiles: string[]): string {
  const topLevelFolders = uniqueReleaseValues(
    changedFiles
      .map(normalizeReleasePath)
      .map((filePath) => filePath.split('/')[0])
      .filter(Boolean)
  );

  if (topLevelFolders.length === 1) return topLevelFolders[0].replace(/[^a-z0-9-]/giu, '-').toLowerCase();
  return 'repo';
}

function normalizeChangedFiles(changedFiles: Array<string | FinaliseChangedFile>): ReleaseImpactInput[] {
  return changedFiles
    .map((entry) => typeof entry === 'string'
      ? { path: entry }
      : {
        path: entry.path,
        additions: entry.additions,
        deletions: entry.deletions,
      })
    .filter((entry) => Boolean(entry.path));
}

function getSummaryType(matches: ReturnType<typeof getReleaseDescriptorMatches>): 'chore' | 'docs' | 'feat' | 'fix' | 'test' {
  if (matches.length === 0) return 'chore';
  if (matches.some((match) => match.descriptor.type === 'feat' && !match.descriptor.excludeFromProductSummary)) return 'feat';
  return matches[0]?.descriptor.type || 'chore';
}

function removeGenericFallbackMatches(matches: ReturnType<typeof getReleaseDescriptorMatches>): ReturnType<typeof getReleaseDescriptorMatches> {
  const concreteMatches = matches.filter((match) =>
    !['app-screens', 'background-services'].includes(match.descriptor.id)
  );

  return concreteMatches.length > 0 ? concreteMatches : matches;
}

function getSummaryMatches(normalizedInputs: ReleaseImpactInput[]): ReleaseImpactMatch[] {
  const allMatches = getReleaseDescriptorMatches(normalizedInputs);
  const productMatches = removeGenericFallbackMatches(
    allMatches.filter((match) => !match.descriptor.excludeFromProductSummary)
  );

  return productMatches.length > 0 ? productMatches : removeGenericFallbackMatches(allMatches);
}

function parseSummaryCommit(message: string): ParsedSummaryCommit | null {
  const firstLine = message.split(/\r?\n/u)[0]?.trim() ?? '';
  const match = CONVENTIONAL_COMMIT_PATTERN.exec(firstLine);
  if (!match) return null;

  const [, , rawScope, , rawSubject] = match;
  const subject = (rawSubject ?? '').trim();
  if (!subject) return null;

  return {
    raw: firstLine,
    scope: rawScope?.trim().toLowerCase() || null,
    subject,
  };
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function makeFriendlyReleaseText(value: string): string {
  return value
    .replace(/\bAPI routes?\b/giu, 'background services')
    .replace(/\bAPI\b/gu, 'background services')
    .replace(/\bdatabase migrations?\b/giu, 'data storage')
    .replace(/\brepository files?\b/giu, 'general app maintenance')
    .replace(/\s+/gu, ' ')
    .trim();
}

function makePastTenseOpening(value: string): string {
  return value.replace(/^(add|fix|handle|improve|normalize|publish|update)\b/iu, (match) => {
    const replacements: Record<string, string> = {
      add: 'Added',
      fix: 'Fixed',
      handle: 'Handled',
      improve: 'Improved',
      normalize: 'Normalized',
      publish: 'Published',
      update: 'Updated',
    };

    return replacements[match.toLowerCase()] ?? sentenceCase(match);
  });
}

function formatReleaseDetailSubject(value: string): string {
  return ensureSentence(makePastTenseOpening(sentenceCase(makeFriendlyReleaseText(value))));
}

function getFilesForMatch(match: ReleaseImpactMatch, normalizedInputs: ReleaseImpactInput[]): string[] {
  return normalizedInputs
    .filter((input) => match.descriptor.patterns.some((pattern) => pattern.test(input.path)))
    .map((input) => input.path);
}

function getRelatedCommitSubject(match: ReleaseImpactMatch, parsedCommits: ParsedSummaryCommit[]): string {
  const scopes = new Set([
    match.descriptor.scope,
    ...match.descriptor.commitScopeAliases,
  ].map((scope) => scope.toLowerCase()));

  return parsedCommits.find((commit) => commit.scope && scopes.has(commit.scope))?.subject || match.descriptor.subject;
}

function getFileFocusLabels(files: string[]): string[] {
  const normalizedFiles = files.map(normalizeReleasePath);
  const labels = [
    normalizedFiles.some((filePath) => /^app\/api\//iu.test(filePath)) ? 'background routes' : '',
    normalizedFiles.some((filePath) => /^app\/\(dashboard\)\//iu.test(filePath) || /^app\/[^/]+\/page\.tsx$/iu.test(filePath)) ? 'app screens' : '',
    normalizedFiles.some((filePath) => /^components\//iu.test(filePath)) ? 'interface components' : '',
    normalizedFiles.some((filePath) => /^lib\//iu.test(filePath)) ? 'shared logic' : '',
    normalizedFiles.some((filePath) => /^types\//iu.test(filePath)) ? 'shared typing' : '',
    normalizedFiles.some((filePath) => /^scripts\//iu.test(filePath)) ? 'automation scripts' : '',
    normalizedFiles.some((filePath) => /(^tests\/|^testsuite\/|^e2e\/)/iu.test(filePath)) ? 'automated tests' : '',
    normalizedFiles.some((filePath) => /(^supabase\/|migration|schema|database)/iu.test(filePath)) ? 'data storage' : '',
    normalizedFiles.some((filePath) => /^docs\//iu.test(filePath)) ? 'documentation' : '',
  ];

  return uniqueReleaseValues(labels.filter(Boolean));
}

function buildTaskFallbackBullet(task: FinaliseReleaseTaskEvidence): string {
  const subject = formatReleaseDetailSubject(task.subject).replace(/[.!?]$/u, '');
  const focusLabels = getFileFocusLabels(task.files);
  if (focusLabels.length === 0) {
    return ensureSentence(`${subject} across ${task.fileCount} changed ${task.fileCount === 1 ? 'file' : 'files'}`);
  }

  return ensureSentence(`${subject}, with changes to ${joinAreas(focusLabels)}`);
}

export function summarizeFinaliseChanges(changedFiles: Array<string | FinaliseChangedFile>): FinaliseChangeSummary {
  const normalizedInputs = normalizeChangedFiles(changedFiles);
  const productFiles = getProductReleaseFiles(normalizedInputs.map((entry) => entry.path));
  const matches = getSummaryMatches(normalizedInputs);
  const primaryMatch = matches[0] || null;
  const coreAreas = uniqueReleaseValues(matches.map((match) => match.descriptor.versionHistoryArea));

  if (!primaryMatch) {
    const fallbackScope = getFallbackScope(productFiles);
    return {
      commitMessage: `chore(${fallbackScope}): update ${productFiles.length > 0 ? joinAreas(coreAreas) : 'repository files'}`,
      fileCount: productFiles.length,
      areas: coreAreas,
    };
  }

  const commitSubject =
    coreAreas.length <= 1 ? primaryMatch.descriptor.subject : `update ${joinAreas(coreAreas)}`;
  const commitType = getSummaryType(matches);

  return {
    commitMessage: `${commitType}(${primaryMatch.descriptor.scope}): ${commitSubject}`,
    fileCount: productFiles.length,
    areas: coreAreas.length > 0 ? coreAreas : [primaryMatch.descriptor.versionHistoryArea],
  };
}

export function buildFinaliseReleaseSummaryEvidence(
  changedFiles: Array<string | FinaliseChangedFile>,
  commitMessages: string[] = []
): FinaliseReleaseSummaryEvidence {
  const normalizedInputs = normalizeChangedFiles(changedFiles);
  const productFiles = getProductReleaseFiles(normalizedInputs.map((entry) => entry.path));
  const productInputs = normalizedInputs.filter((input) =>
    productFiles.includes(normalizeReleasePath(input.path))
  );
  const matches = getSummaryMatches(productInputs);
  const parsedCommits = commitMessages
    .map(parseSummaryCommit)
    .filter((commit): commit is ParsedSummaryCommit => commit !== null);
  const tasks = matches.map((match) => ({
    area: match.descriptor.versionHistoryArea,
    subject: getRelatedCommitSubject(match, parsedCommits),
    files: getFilesForMatch(match, productInputs),
    fileCount: match.fileCount,
    additions: match.additions,
    deletions: match.deletions,
  }));

  return {
    commitMessages,
    areas: uniqueReleaseValues(matches.map((match) => match.descriptor.versionHistoryArea)),
    tasks,
    fallbackFiles: productFiles,
  };
}

export function buildReleaseDetailFallbackBullets(
  changedFiles: Array<string | FinaliseChangedFile>,
  commitMessages: string[] = []
): string[] {
  const evidence = buildFinaliseReleaseSummaryEvidence(changedFiles, commitMessages);
  const taskBullets = evidence.tasks.map(buildTaskFallbackBullet);
  if (taskBullets.length > 0) {
    return uniqueReleaseValues(taskBullets).slice(0, 8);
  }

  const commitBullets = commitMessages
    .map(parseSummaryCommit)
    .filter((commit): commit is ParsedSummaryCommit => commit !== null)
    .map((commit) => formatReleaseDetailSubject(commit.subject));
  if (commitBullets.length > 0) {
    return uniqueReleaseValues(commitBullets).slice(0, 8);
  }

  if (evidence.fallbackFiles.length > 0) {
    return [
      ensureSentence(`Updated ${evidence.fallbackFiles.length} app ${evidence.fallbackFiles.length === 1 ? 'file' : 'files'}`),
    ];
  }

  return [];
}

export function formatReleaseVersionCommitMessage(primaryCommitMessage: string | null, version: string): string {
  const primarySubject = primaryCommitMessage
    ?.replace(new RegExp(`\\s*${SKIP_VERSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'giu'), ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const subject = primarySubject || `chore(release): publish ${version}`;

  return `${subject} ${SKIP_VERSION_MARKER}\n\nRelease version: ${version}`;
}

export function formatFinaliseDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function getFinaliseTimingSummaryLines(
  entries: FinaliseTimingEntry[],
  options: FinaliseTimingSummaryOptions = {}
): string[] {
  const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_TIMING_THRESHOLD_MS;
  const limit = options.limit ?? DEFAULT_TIMING_SUMMARY_LIMIT;
  const slowEntries = entries
    .filter((entry) => entry.durationMs >= slowThresholdMs)
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, limit);

  if (slowEntries.length === 0) {
    return [`Timing summary: no finalise steps exceeded ${formatFinaliseDuration(slowThresholdMs)}.`];
  }

  return [
    `Timing summary (steps over ${formatFinaliseDuration(slowThresholdMs)}):`,
    ...slowEntries.map((entry) => {
      const status = entry.status && entry.status !== 'completed' ? ` (${entry.status})` : '';
      return `- ${entry.label}: ${formatFinaliseDuration(entry.durationMs)}${status}`;
    }),
  ];
}
