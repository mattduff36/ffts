import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const PLAYWRIGHT_CLI = path.join(
  process.cwd(),
  'node_modules',
  '@playwright',
  'test',
  'cli.js'
);
const ADMIN_STORAGE_STATE = path.join(
  process.cwd(),
  'testsuite',
  '.state',
  'storage-state-admin.json'
);
const PLANT_CASE_TITLE = 'two distinct plant assets remain on one visit after drag';

function leftoverPlaywrightEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_MODE;
  env.NODE_ENV = 'development';
  env.TESTSUITE_BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';
  return env;
}

function spawnPlaywright(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [PLAYWRIGHT_CLI, 'test', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    timeout: 180_000,
    env: leftoverPlaywrightEnv(),
  });
}

function spawnOutput(result: SpawnSyncReturns<string>): string {
  return [
    result.error ? String(result.error) : '',
    result.stdout ?? '',
    result.stderr ?? '',
  ].join('\n');
}

describe('scheduling plant browser evidence', () => {
  it('SCHED-PLANT-BROWSER-001 drags two distinct plants onto one visit', () => {
    const setup = spawnPlaywright([
      '--config=testsuite/config/playwright.config.ts',
      'testsuite/ui/auth.setup.ts',
      '-g',
      'authenticate as admin',
      '--project=setup',
      '--workers=1',
    ]);
    expect(setup.status, spawnOutput(setup)).toBe(0);
    expect(existsSync(ADMIN_STORAGE_STATE), spawnOutput(setup)).toBe(true);

    const result = spawnPlaywright([
      '--config=testsuite/config/playwright.config.ts',
      'testsuite/ui/scheduling.spec.ts',
      '-g',
      PLANT_CASE_TITLE,
      '--project=admin-tests',
      '--no-deps',
      '--workers=1',
    ]);
    expect(result.status, spawnOutput(result)).toBe(0);
  }, 240_000);
});
