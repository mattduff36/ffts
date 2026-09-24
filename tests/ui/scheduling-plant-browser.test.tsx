import { spawn } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

const PLAYWRIGHT_CLI = path.join(
  process.cwd(),
  'node_modules',
  '@playwright',
  'test',
  'cli.js'
);
const PLANT_CASE_TITLE = 'two distinct plant assets remain on one visit after drag';
const PLAYWRIGHT_TIMEOUT_MS = 180_000;

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

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function terminateProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || !child.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const killer = spawn(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      { shell: false, stdio: 'ignore', windowsHide: true }
    );
    killer.once('error', () => {
      child.kill();
      resolve();
    });
    killer.once('close', () => resolve());
  });
}

function spawnPlaywright(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', ...args], {
      cwd: process.cwd(),
      shell: false,
      env: leftoverPlaywrightEnv(),
    });
    let stdout = '';
    let stderr = '';
    let spawnError: Error | undefined;
    let timedOut = false;
    let cleanupPromise = Promise.resolve();
    const timeout = setTimeout(() => {
      timedOut = true;
      cleanupPromise = terminateProcessTree(child);
    }, PLAYWRIGHT_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', async (status) => {
      clearTimeout(timeout);
      await cleanupPromise;
      resolve({
        status,
        stdout,
        stderr,
        error: timedOut
          ? new Error(`Playwright exceeded ${PLAYWRIGHT_TIMEOUT_MS}ms and was terminated`)
          : spawnError,
      });
    });
  });
}

function spawnOutput(result: SpawnResult): string {
  return [
    result.error ? String(result.error) : '',
    result.stdout,
    result.stderr,
  ].join('\n');
}

describe('scheduling plant browser evidence', () => {
  it('SCHED-PLANT-BROWSER-001 drags two distinct plants onto one visit', async () => {
    const result = await spawnPlaywright([
      '--config=testsuite/config/playwright.config.ts',
      'testsuite/ui/scheduling.spec.ts',
      '-g',
      PLANT_CASE_TITLE,
      '--project=admin-tests',
      '--workers=1',
    ]);
    expect(result.error, spawnOutput(result)).toBeUndefined();
    expect(result.status, spawnOutput(result)).toBe(0);
  }, 240_000);
});
