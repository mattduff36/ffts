import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  envDir: false,
  test: {
    projects: [{ extends: true, test: { name: 'account-handover' } }],
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/integration/api/admin-reset-password-route.test.ts',
      'tests/integration/api/admin-user-update-route.test.ts',
      'tests/integration/api/auth-{session,bootstrap,login,logout,change-password,data-token,webauthn-login}-route.test.ts',
      'tests/integration/api/rbac-role-assignment.test.ts',
      'tests/unit/app-auth-{profile,session}.test.ts',
      'tests/unit/supabase-{data-token,server-password-gate}.test.ts',
      'tests/unit/webauthn-credentials.test.ts',
      'tests/unit/password-utils.test.ts',
      'tests/unit/credential-lock.test.ts',
      'tests/integration/api/credential-change-concurrency.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './') } },
});
