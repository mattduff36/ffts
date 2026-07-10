import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  RELEASE_HISTORY_PATH,
  RELEASE_LOG_PATH,
  buildReleaseHistoryEntries,
  buildWhatChangedSummary,
  computeNextVersionState,
  formatReleaseLogEntry,
  formatReleaseVersion,
  parseCommitsFromMessages,
  prependReleaseLogEntry,
  selectReleasePrimaryCommitMessage,
  shouldSkipVersionBumpCommit,
  type ReleaseHistoryEntry,
  type ReleaseVersionState,
} from '../lib/config/release-version-logic';
import {
  buildFinaliseReleaseSummaryEvidence,
  buildReleaseDetailFallbackBullets,
  type FinaliseChangedFile,
  type FinaliseReleaseSummaryEvidence,
} from './finalise-summary';

const REPO_ROOT = process.cwd();
const VERSION_JSON_PATH = path.join(REPO_ROOT, 'lib/config/release-version.json');
const RELEASE_LOG_FILE = path.join(REPO_ROOT, RELEASE_LOG_PATH);
const RELEASE_HISTORY_FILE = path.join(REPO_ROOT, RELEASE_HISTORY_PATH);
const ZERO_SHA = '0000000000000000000000000000000000000000';
const CURSOR_RELEASE_SUMMARY_MODEL = process.env.CURSOR_RELEASE_SUMMARY_MODEL || 'auto';

function getExecutable(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return !['git', 'powershell.exe', 'pwsh.exe'].includes(command.toLowerCase());
}

function runGit(args: string[]): string {
  const result = spawnSync(getExecutable('git'), args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: shouldUseShell('git'),
  });

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function readVersionState(): ReleaseVersionState {
  const raw = readFileSync(VERSION_JSON_PATH, 'utf8');
  return JSON.parse(raw) as ReleaseVersionState;
}

function writeVersionState(state: ReleaseVersionState): void {
  writeFileSync(VERSION_JSON_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getCommitMessages(revRange: string): string[] {
  if (!revRange) {
    return [];
  }

  const output = runGit(['log', '--format=%s', revRange]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !shouldSkipVersionBumpCommit(line));
}

function parseGitNumstat(output: string): FinaliseChangedFile[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawAdditions, rawDeletions, ...pathParts] = line.split(/\t/u);
      const filePath = pathParts.join('\t').trim();
      const additions = Number.parseInt(rawAdditions || '0', 10);
      const deletions = Number.parseInt(rawDeletions || '0', 10);

      return {
        path: filePath,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      };
    })
    .filter((entry) => entry.path.length > 0);
}

function getChangedFileStats(beforeSha: string | undefined, afterSha: string): FinaliseChangedFile[] {
  if (!beforeSha) {
    return [];
  }

  const output = beforeSha === ZERO_SHA
    ? runGit(['show', '--numstat', '--format=', afterSha])
    : runGit(['diff', '--numstat', beforeSha, afterSha, '--']);

  return parseGitNumstat(output);
}

function resolveAfterSha(explicitAfter: string | undefined): string {
  if (explicitAfter) {
    return explicitAfter;
  }

  return runGit(['rev-parse', 'HEAD']);
}

function buildRevRange(beforeSha: string | undefined, afterSha: string): string | null {
  if (beforeSha && beforeSha !== '0000000000000000000000000000000000000000') {
    return `${beforeSha}..${afterSha}`;
  }

  if (!beforeSha) {
    return null;
  }

  return null;
}

function ensureReleaseLogDirectory(): void {
  const directory = path.dirname(RELEASE_LOG_FILE);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function readReleaseLog(): string {
  if (!existsSync(RELEASE_LOG_FILE)) {
    return '';
  }

  return readFileSync(RELEASE_LOG_FILE, 'utf8');
}

function writeReleaseLog(content: string): void {
  ensureReleaseLogDirectory();
  writeFileSync(RELEASE_LOG_FILE, content, 'utf8');
}

function readReleaseHistoryTimestampLookup(): Record<string, string | null> {
  if (!existsSync(RELEASE_HISTORY_FILE)) {
    return {};
  }

  const raw = readFileSync(RELEASE_HISTORY_FILE, 'utf8');
  try {
    const entries = JSON.parse(raw) as ReleaseHistoryEntry[];
    return Object.fromEntries(entries.map((entry) => [entry.version, entry.pushedAt]));
  } catch {
    return {};
  }
}

function writeReleaseHistory(releaseLogContent: string): void {
  const entries = buildReleaseHistoryEntries(releaseLogContent, readReleaseHistoryTimestampLookup());
  writeFileSync(RELEASE_HISTORY_FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function normalizeReleaseDetail(value: string): string {
  return value
    .replace(/^[-*\d.)\s]+/u, '')
    .replace(/\s+/gu, ' ')
    .replace(/^["']|["']$/gu, '')
    .trim();
}

function isUsefulReleaseDetail(value: string): boolean {
  const normalized = normalizeReleaseDetail(value);
  if (normalized.length < 24 || normalized.length > 220) return false;

  return ![
    /release time shown/iu,
    /larger app update/iu,
    /smaller improvement release/iu,
    /^covered\b/iu,
    /^updated app\.$/iu,
  ].some((pattern) => pattern.test(normalized));
}

function parseCursorReleaseDetails(output: string): string[] {
  const trimmed = output.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/u);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map(normalizeReleaseDetail)
          .filter(isUsefulReleaseDetail)
          .slice(0, 8);
      }
    } catch {
      // Fall through to line parsing below.
    }
  }

  return trimmed
    .split(/\r?\n/u)
    .map(normalizeReleaseDetail)
    .filter(isUsefulReleaseDetail)
    .slice(0, 8);
}

async function getCursorReleaseDetails(evidence: FinaliseReleaseSummaryEvidence): Promise<string[] | null> {
  if (!process.env.CURSOR_API_KEY) {
    return null;
  }

  try {
    const { Agent } = await import('@cursor/sdk');
    const prompt = [
      'You write Forest Farm app version-history bullet points for end users.',
      'Use only the JSON evidence below. Do not inspect or change files.',
      'Return only a JSON array of 1 to 8 strings.',
      'Rules: one bullet per meaningful task; be specific about the work done; avoid generic release metadata; no Markdown; each bullet must be one plain-English sentence.',
      '',
      JSON.stringify(evidence, null, 2),
    ].join('\n');
    const result = await Agent.prompt(prompt, {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: CURSOR_RELEASE_SUMMARY_MODEL },
      local: { cwd: REPO_ROOT },
    });
    const status = typeof result.status === 'string' ? result.status : '';
    const output = typeof result.result === 'string' ? result.result : '';
    if (status === 'error' || !output) {
      return null;
    }

    const details = parseCursorReleaseDetails(output);
    return details.length > 0 ? details : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Cursor release summary unavailable; using deterministic fallback. ${message}`);
    return null;
  }
}

async function buildReleaseDetails(
  changedFileStats: FinaliseChangedFile[],
  commitMessages: string[]
): Promise<string[]> {
  const fallbackDetails = buildReleaseDetailFallbackBullets(changedFileStats, commitMessages);
  const evidence = buildFinaliseReleaseSummaryEvidence(changedFileStats, commitMessages);
  const cursorDetails = await getCursorReleaseDetails(evidence);

  if (cursorDetails) {
    return cursorDetails;
  }

  if (fallbackDetails.length > 0) {
    console.log('Using deterministic release detail fallback.');
  }

  return fallbackDetails;
}

async function main(): Promise<void> {
  const beforeSha = process.argv[2];
  const afterSha = resolveAfterSha(process.argv[3]);
  const afterResolved = afterSha;
  const revRange = buildRevRange(beforeSha, afterResolved);

  const commitMessages = revRange ? getCommitMessages(revRange) : [];
  const commits = parseCommitsFromMessages(commitMessages);
  const changedFileStats = getChangedFileStats(beforeSha, afterResolved);
  const current = readVersionState();
  const { next, bumpKind } = computeNextVersionState(current, commits, new Date());

  if (bumpKind === 'none') {
    console.log(`No release version bump required (still ${formatReleaseVersion(current)}).`);
    return;
  }

  const nextState: ReleaseVersionState = {
    ...next,
    lastProcessedSha: afterResolved,
  };

  const versionLabel = formatReleaseVersion(nextState);
  const primaryCommitMessage = selectReleasePrimaryCommitMessage(commits, bumpKind, nextState);
  const pushedAt = new Date().toISOString();

  if (!primaryCommitMessage) {
    throw new Error('Version bump required but no eligible commit message was found.');
  }

  const logEntry = formatReleaseLogEntry({
    version: versionLabel,
    primaryCommitMessage,
    whatChanged: buildWhatChangedSummary(commits),
    releaseDetails: await buildReleaseDetails(changedFileStats, commitMessages),
    commitMessages: commits.map((commit) => commit.raw),
    pushedAt,
  });

  const releaseLogContent = prependReleaseLogEntry(readReleaseLog(), logEntry);
  writeVersionState(nextState);
  writeReleaseLog(releaseLogContent);
  writeReleaseHistory(releaseLogContent);

  console.log(`Release version bumped: ${formatReleaseVersion(current)} -> ${versionLabel} (${bumpKind})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
