import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export const RELEASE_VERSION_FILES = [
  'lib/config/release-version.json',
  'lib/config/release-history.json',
  'docs_private/release-log.md',
] as const;

interface ReleaseVersionState {
  mmyy: string;
  major: number;
  minor: number;
  lastProcessedSha: string;
}

interface ReleaseHistoryEntry {
  version?: string;
}

function formatVersion(state: Pick<ReleaseVersionState, 'mmyy' | 'major' | 'minor'>): string {
  return `${state.mmyy}.${state.major}.${state.minor}`;
}

export function assertReleaseMetadataTracking(repoRoot: string): void {
  const releaseLogPath = path.join(repoRoot, 'docs_private', 'release-log.md');
  if (!existsSync(releaseLogPath)) {
    throw new Error('Release metadata preflight failed: docs_private/release-log.md is missing.');
  }

  for (const relativePath of RELEASE_VERSION_FILES) {
    const result = spawnSync('git', ['check-ignore', '--quiet', '--', relativePath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      throw new Error(`Release metadata preflight failed: ${relativePath} is ignored by Git.`);
    }
    if (result.status !== 1) {
      const detail = result.stderr?.trim() || `git check-ignore exited with status ${result.status}`;
      throw new Error(`Release metadata preflight failed for ${relativePath}: ${detail}`);
    }
  }
}

export function assertReleaseMetadataConsistency(repoRoot: string): string {
  const versionPath = path.join(repoRoot, 'lib', 'config', 'release-version.json');
  const historyPath = path.join(repoRoot, 'lib', 'config', 'release-history.json');
  const releaseLogPath = path.join(repoRoot, 'docs_private', 'release-log.md');
  const state = JSON.parse(readFileSync(versionPath, 'utf8')) as ReleaseVersionState;
  const history = JSON.parse(readFileSync(historyPath, 'utf8')) as ReleaseHistoryEntry[];
  const releaseLog = readFileSync(releaseLogPath, 'utf8');
  const version = formatVersion(state);

  if (history[0]?.version !== version) {
    throw new Error(
      `Release metadata is inconsistent: release-history.json starts with ${history[0]?.version || 'no version'}, expected ${version}.`
    );
  }
  if (!releaseLog.includes(`## ${version}`)) {
    throw new Error(`Release metadata is inconsistent: release-log.md has no ${version} entry.`);
  }

  return version;
}

export function formatReleaseRecoveryMessage(params: {
  productCommitSha: string;
  releaseBeforeSha: string;
  releaseAfterSha: string;
  cause: unknown;
}): string {
  const cause = params.cause instanceof Error ? params.cause.message : String(params.cause);
  return [
    `Release version step failed after local product commit ${params.productCommitSha}.`,
    'The product commit remains local and no push was attempted.',
    `Cause: ${cause}`,
    'After correcting the cause, recover with:',
    `npm run version:bump -- ${params.releaseBeforeSha} ${params.releaseAfterSha}`,
    `git add ${RELEASE_VERSION_FILES.join(' ')}`,
    'git commit -m "chore(release): complete recovered version bump [skip version]"',
    'Then rerun finalise with the originally requested push mode.',
  ].join('\n');
}

