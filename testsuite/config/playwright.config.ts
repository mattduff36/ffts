import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';
const STATE_DIR = path.resolve(__dirname, '../.state');

export default defineConfig({
  testDir: path.resolve(__dirname, '../ui'),
  globalSetup: path.resolve(__dirname, '../helpers/preflight.global-setup.ts'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['json', { outputFile: path.resolve(__dirname, '../reports/results.json') }],
    ['list'],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    // --- Setup: log in once per role ---
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // --- Auth tests: need a CLEAN context (no storage state) ---
    {
      name: 'auth-tests',
      dependencies: ['setup'],
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // --- Auth lifecycle: clean context, own issue gate ---
    {
      name: 'auth-lifecycle-tests',
      dependencies: ['setup'],
      testMatch: /auth-lifecycle\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // --- Permissions tests: employee storage state ---
    {
      name: 'permissions-tests',
      dependencies: ['setup'],
      testMatch: /permissions\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(STATE_DIR, 'storage-state-employee.json'),
      },
    },
    // --- Timesheets: manager storage state ---
    {
      name: 'timesheets-tests',
      dependencies: ['setup'],
      testMatch: /timesheets-workflow\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(STATE_DIR, 'storage-state-manager.json'),
      },
    },
    // --- Inspections/messages: employee storage state ---
    {
      name: 'employee-tests',
      dependencies: ['setup'],
      testMatch: /inspections-rams-messages\.spec\.ts|van-inspections\.spec\.ts|plant-inspections\.spec\.ts|hgv-inspections\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(STATE_DIR, 'storage-state-employee.json'),
      },
    },
    // --- All other specs: admin storage state ---
    {
      name: 'admin-tests',
      dependencies: ['setup'],
      testIgnore: [
        /auth\.setup\.ts/,
        /auth\.spec\.ts/,
        /auth-lifecycle\.spec\.ts/,
        /permissions\.spec\.ts/,
        /timesheets-workflow\.spec\.ts/,
        /inspections-rams-messages\.spec\.ts/,
        /van-inspections\.spec\.ts/,
        /plant-inspections\.spec\.ts/,
        /hgv-inspections\.spec\.ts/,
        /responsiveness\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(STATE_DIR, 'storage-state-admin.json'),
      },
    },
    // --- Responsiveness: admin storage state, separate for viewport overrides ---
    {
      name: 'responsive-tests',
      dependencies: ['setup'],
      testMatch: /responsiveness\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(STATE_DIR, 'storage-state-admin.json'),
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
