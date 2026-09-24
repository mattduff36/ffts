import { defineWorkspace } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

export default defineWorkspace([
  // Node environment for integration tests
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      environment: 'node',
      sequence: {
        groupOrder: 0,
      },
      include: [
        'tests/integration/**/*.test.ts',
        'tests/unit/**/*.test.ts',
        'tests/regression/**/*.test.ts',
      ],
      testTimeout: 120_000,
      hookTimeout: 60_000,
      // ProjectConfig omits this key; Vitest 3 still honours it for git-fixture worker teardown.
      // @ts-expect-error TS2353
      teardownTimeout: 60_000,
    },
  },
  // Happy DOM environment for UI component tests
  {
    plugins: [react()],
    test: {
      name: 'ui',
      environment: 'happy-dom',
      sequence: {
        groupOrder: 0,
      },
      environmentOptions: {
        happyDOM: {
          url: process.env.TESTSUITE_BASE_URL || 'http://127.0.0.1:4000',
        },
      },
      include: ['tests/ui/**/*.test.tsx'],
      exclude: ['tests/ui/scheduling-plant-browser.test.tsx'],
      globals: true,
      setupFiles: ['./tests/ui/setup.ts'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
    },
  },
  // Resource-heavy browser evidence runs after the ordinary projects so its
  // nested Playwright workers cannot starve Vitest's worker heartbeat.
  {
    extends: './vitest.config.ts',
    test: {
      name: 'browser-evidence',
      environment: 'node',
      sequence: {
        groupOrder: 1,
      },
      include: ['tests/ui/scheduling-plant-browser.test.tsx'],
      testTimeout: 240_000,
    },
  },
]);
