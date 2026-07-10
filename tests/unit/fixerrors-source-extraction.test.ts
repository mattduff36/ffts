import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  extractSourceFilesForError,
  groupIntoPatterns,
  type ErrorLogEntry,
} from '@/scripts/fixerrors';

function createFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fixerrors-source-'));

  for (const [file, content] of Object.entries(files)) {
    const absolutePath = join(root, file);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf-8');
  }

  return root;
}

function makeError(overrides: Partial<ErrorLogEntry>): ErrorLogEntry {
  return {
    id: 'error-1',
    timestamp: '2026-06-07T12:00:00.000Z',
    error_message: 'Console Error: Example error',
    error_stack: null,
    error_type: 'Error',
    user_id: null,
    user_email: 'user@example.com',
    page_url: 'https://forest-farm.example.test/example',
    user_agent: 'vitest',
    component_name: 'Console Error',
    additional_data: null,
    ...overrides,
  };
}

describe('fixerrors source extraction', () => {
  it('infers App Router source files from minified Next app chunk URLs', () => {
    const root = createFixture({
      'app/(dashboard)/van-inspections/new/page.tsx': 'export default function Page() { return null; }\n',
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: [
          'Console Error: Silent draft save failed: Error: Draft not found',
          '@/https://forest-farm.example.test/_next/static/chunks/app/(dashboard)/van-inspections/new/page-67ff4a7213f5a4ef.js:1:21980',
        ].join('\n'),
        error_stack: '@https://forest-farm.example.test/_next/static/chunks/8496-ed158f365cb9a503.js:1:15981',
      }), root);

      expect(refs).toContainEqual({ file: 'app/(dashboard)/van-inspections/new/page.tsx' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('matches console labels to the most relevant source file for the affected route', () => {
    const root = createFixture({
      'app/(dashboard)/plant-inspections/new/page.tsx': [
        'function savePlant() {',
        "  console.error('Error saving inspection:', new Error('Load failed'));",
        '}',
      ].join('\n'),
      'app/(dashboard)/van-inspections/new/page.tsx': [
        'function saveVan() {',
        "  console.error('Error saving inspection:', new Error('Load failed'));",
        '}',
      ].join('\n'),
    });

    try {
      const refs = extractSourceFilesForError(makeError({
        error_message: 'Console Error: Error saving inspection: Error: TypeError: Load failed',
        page_url: 'https://forest-farm.example.test/plant-inspections/new',
      }), root);

      expect(refs).toEqual([
        {
          file: 'app/(dashboard)/plant-inspections/new/page.tsx',
          line: 2,
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the affected App Router page when no stack source is available', () => {
    const root = createFixture({
      'app/(dashboard)/fleet/page.tsx': 'export default function FleetPage() { return null; }\n',
    });

    try {
      const patterns = groupIntoPatterns([
        makeError({
          error_message: 'Console Error: Error fetching retired plant assets: Error: TypeError: Failed to fetch',
          page_url: 'https://forest-farm.example.test/fleet',
        }),
      ], root);

      expect(patterns[0].sourceFiles).toContainEqual({ file: 'app/(dashboard)/fleet/page.tsx' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
