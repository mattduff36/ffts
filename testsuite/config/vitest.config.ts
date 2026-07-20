import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '../../'),
  test: {
    environment: 'node',
    globals: true,
    globalSetup: [path.resolve(__dirname, '../helpers/preflight.global-setup.ts')],
    setupFiles: [path.resolve(__dirname, '../../tests/setup.ts')],
    include: [
      'testsuite/api/**/*.test.ts',
    ],
    reporters: ['verbose', 'json'],
    outputFile: {
      json: path.resolve(__dirname, '../reports/vitest-results.json'),
    },
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../'),
    },
  },
});
