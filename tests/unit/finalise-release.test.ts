import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertReleaseMetadataConsistency,
  assertReleaseMetadataTracking,
  formatReleaseRecoveryMessage,
} from '@/scripts/finalise-release';

const temporaryDirectories: string[] = [];

function createReleaseFixture(gitignore: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'ffts-finalise-release-'));
  temporaryDirectories.push(root);
  mkdirSync(path.join(root, 'lib', 'config'), { recursive: true });
  mkdirSync(path.join(root, 'docs_private'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), gitignore, 'utf8');
  writeFileSync(
    path.join(root, 'lib', 'config', 'release-version.json'),
    JSON.stringify({ mmyy: '0726', major: 4, minor: 0, lastProcessedSha: 'abc' }),
    'utf8'
  );
  writeFileSync(
    path.join(root, 'lib', 'config', 'release-history.json'),
    JSON.stringify([{ version: '0726.4.0' }]),
    'utf8'
  );
  writeFileSync(
    path.join(root, 'docs_private', 'release-log.md'),
    '# Production release log\n\n## 0726.4.0\n',
    'utf8'
  );
  const gitInit = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  if (gitInit.status !== 0) throw new Error(gitInit.stderr);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('finalise release metadata safety', () => {
  it('rejects an ignored release log before finalise commits product changes', () => {
    const root = createReleaseFixture('/docs_private/\n');
    expect(() => assertReleaseMetadataTracking(root)).toThrow(/release-log\.md is ignored/u);
  });

  it('accepts the tracked release-log exception and verifies matching metadata', () => {
    const root = createReleaseFixture('/docs_private/*\n!/docs_private/release-log.md\n');
    expect(() => assertReleaseMetadataTracking(root)).not.toThrow();
    expect(assertReleaseMetadataConsistency(root)).toBe('0726.4.0');
  });

  it('prints fail-closed recovery instructions after a product commit', () => {
    const message = formatReleaseRecoveryMessage({
      productCommitSha: 'product-sha',
      releaseBeforeSha: 'before-sha',
      releaseAfterSha: 'after-sha',
      cause: new Error('metadata mismatch'),
    });

    expect(message).toContain('product-sha');
    expect(message).toContain('no push was attempted');
    expect(message).toContain('npm run version:bump -- before-sha after-sha');
    expect(message).toContain('metadata mismatch');
  });
});

