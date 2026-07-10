import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import {
  RELEASE_HISTORY_PATH,
  RELEASE_LOG_PATH,
  buildReleaseHistoryEntries,
  formatReleaseVersion,
} from '../lib/config/release-version-logic';
import type { ReleaseHistoryEntry, ReleaseVersionState } from '../lib/config/release-version-logic';

const REPO_ROOT = process.cwd();
const RELEASE_LOG_FILE = path.join(REPO_ROOT, RELEASE_LOG_PATH);
const RELEASE_HISTORY_FILE = path.join(REPO_ROOT, RELEASE_HISTORY_PATH);
const RELEASE_VERSION_JSON_PATH = 'lib/config/release-version.json';

function getExecutable(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  return command === 'git' ? command : `${command}.cmd`;
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return command.toLowerCase() !== 'git';
}

function runGit(args: string[]): string {
  const result = spawnSync(getExecutable('git'), args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: shouldUseShell('git'),
  });

  if (result.status !== 0) {
    return '';
  }

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function readReleaseLog(): string {
  if (!existsSync(RELEASE_LOG_FILE)) {
    return '';
  }

  return readFileSync(RELEASE_LOG_FILE, 'utf8');
}

function getVersionAtCommit(sha: string): string | null {
  const raw = runGit(['show', `${sha}:${RELEASE_VERSION_JSON_PATH}`]);
  if (!raw) {
    return null;
  }

  try {
    return formatReleaseVersion(JSON.parse(raw) as ReleaseVersionState);
  } catch {
    return null;
  }
}

function buildGitTimestampLookup(): Record<string, string> {
  const output = runGit([
    'log',
    '--format=%H%x09%aI',
    '--all',
    '--',
    RELEASE_LOG_PATH,
    RELEASE_VERSION_JSON_PATH,
  ]);

  if (!output) {
    return {};
  }

  const lookup: Record<string, string> = {};
  for (const line of output.split(/\r?\n/u)) {
    const [sha, pushedAt] = line.split('\t');
    if (!sha || !pushedAt) {
      continue;
    }

    const version = getVersionAtCommit(sha);
    if (version && !lookup[version]) {
      lookup[version] = pushedAt;
    }
  }

  return lookup;
}

function writeReleaseHistory(entries: ReleaseHistoryEntry[]): void {
  writeFileSync(RELEASE_HISTORY_FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function main(): void {
  const releaseLog = readReleaseLog();
  const entries = buildReleaseHistoryEntries(releaseLog, buildGitTimestampLookup());
  writeReleaseHistory(entries);
  console.log(`Generated ${RELEASE_HISTORY_PATH} with ${entries.length} entries.`);
}

main();
