import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  outputDir: '../reports/scheduling-local/results',
  use: { channel: 'msedge', baseURL: 'http://127.0.0.1:4017', viewport: { width: 1440, height: 900 } },
});
