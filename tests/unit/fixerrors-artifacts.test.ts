import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensurePrivateDocsDirectory } from '@/scripts/fixerrors';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('fixerrors artifact bootstrap', () => {
  it('creates docs_private when no prior automation artifact exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ffts-fixerrors-'));
    temporaryDirectories.push(root);

    ensurePrivateDocsDirectory(root);

    expect(existsSync(path.join(root, 'docs_private'))).toBe(true);
  });
});

