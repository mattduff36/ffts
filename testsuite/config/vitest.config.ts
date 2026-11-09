import { defineConfig } from 'vitest/config';
import path from 'path';
import { config } from 'dotenv';
import { requireDevelopmentTarget } from '../../lib/utils/development-target';

config({ path: path.resolve(process.cwd(), '.env.development.local') });
process.env.TESTSUITE_BASE_URL = requireDevelopmentTarget(process.env).appOrigin;
// Invoking this dedicated suite is the explicit integration opt-in, after target validation.
process.env.FFTS_INTEGRATION_TESTS = 'development';
for (const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[key]) throw new Error(`Development testsuite credential is missing: ${key}`);
}

export default defineConfig({
  envDir: false,
  root: path.resolve(__dirname, '../../'),
  test: {
    projects: [{ extends: true, test: { name: 'testsuite-api' } }],
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
