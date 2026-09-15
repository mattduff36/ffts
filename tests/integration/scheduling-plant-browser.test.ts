import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

describe('scheduling plant browser evidence', () => {
  it('SCHED-PLANT-BROWSER-001 drags two distinct plants onto one visit', () => {
    const result = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        '--config=testsuite/config/playwright.config.ts',
        'testsuite/ui/scheduling.spec.ts',
        '-g',
        'two distinct plant assets remain on one visit after drag',
        '--project=admin-tests',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: true,
        timeout: 240_000,
        env: {
          ...process.env,
          CI: process.env.CI ?? '1',
        },
      }
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
  }, 240_000);
});
