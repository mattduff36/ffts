import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  envDir: false,
  test: {
    projects: [{ extends: true, test: { name: 'launch' } }],
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup-isolated.ts'],
    include: [
      'tests/integration/db/launch-function-permissions.test.ts',
      'tests/unit/development-target.test.ts',
      'tests/unit/supabase-middleware-cookie-refresh.test.ts',
      'tests/unit/development-pg-options.test.ts',
      'tests/unit/database-health-pg-options.test.ts',
      'tests/integration/api/development-target-route.test.ts',
      'tests/integration/api/scheduling-project-jobs-route.test.ts',
      'tests/integration/api/debug-sample-data-route.test.ts',
      'tests/unit/sample-data-registry.test.ts',
      'tests/unit/sample-data-concurrency.test.ts',
      'tests/unit/fleet-inventory-sample-fixture.test.ts',
      'tests/unit/scheduling-sample-fixture.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './') } },
});
