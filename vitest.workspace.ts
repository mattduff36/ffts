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
      include: [
        'tests/integration/**/*.test.ts',
        'tests/unit/**/*.test.ts',
        'tests/regression/**/*.test.ts',
      ],
    },
  },
  // Happy DOM environment for UI component tests
  {
    plugins: [react()],
    test: {
      name: 'ui',
      environment: 'happy-dom',
      environmentOptions: {
        happyDOM: {
          url: process.env.TESTSUITE_BASE_URL || 'http://127.0.0.1:4000',
        },
      },
      include: ['tests/ui/**/*.test.tsx'],
      globals: true,
      setupFiles: ['./tests/ui/setup.ts'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
    },
  },
]);
