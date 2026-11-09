import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { requireDevelopmentTarget } from '../../lib/utils/development-target';

config({ path: resolve(process.cwd(), '.env.development.local') });

const TEST_USER_ROLES = ['admin', 'manager', 'employee'] as const;
const STATE_FILE = resolve(process.cwd(), 'testsuite', '.state', 'test-users.json');

interface TestUserState {
  email: string;
  password: string;
  userId: string;
  role: string;
}

type TestUsersState = Record<(typeof TEST_USER_ROLES)[number], TestUserState>;

function loadState(): TestUsersState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `Testsuite users are not provisioned. Expected ${STATE_FILE}. ` +
      'Run npx tsx scripts/setup-test-users.ts --confirm-development=FFTS_TESTSUITE after reviewing the development target.'
    );
  }

  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as TestUsersState;
  } catch (error) {
    throw new Error(
      `Testsuite state is invalid JSON: ${error instanceof Error ? error.message : 'unknown parse error'}`
    );
  }
}

export async function verifyDevelopmentAppTarget() {
  const target = requireDevelopmentTarget(process.env);
  // Verify the running app before constructing clients or authenticating test users.
  const response = await fetch(`${target.appOrigin}/api/development/target`, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Testsuite requires a verified development app (target identity unavailable).');
  const identity: unknown = await response.json();
  if (!identity || typeof identity !== 'object'
    || !('environment' in identity) || identity.environment !== target.environment
    || !('projectId' in identity) || identity.projectId !== target.projectId
    || !('apiOrigin' in identity) || identity.apiOrigin !== target.apiOrigin
    || !('appOrigin' in identity) || identity.appOrigin !== target.appOrigin
    || !('database' in identity) || !identity.database || typeof identity.database !== 'object'
    || !('host' in identity.database) || identity.database.host !== target.database.host
    || !('port' in identity.database) || identity.database.port !== target.database.port
    || !('name' in identity.database) || identity.database.name !== target.database.name) {
    throw new Error('Testsuite app and tooling development targets do not match.');
  }
  return target;
}

export async function runTestsuitePreflight(): Promise<void> {
  await verifyDevelopmentAppTarget();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const failures: string[] = [];

  if (!url) failures.push('NEXT_PUBLIC_SUPABASE_URL is missing');
  if (!serviceRoleKey) failures.push('SUPABASE_SERVICE_ROLE_KEY is missing');
  if (!anonKey) failures.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');
  if (failures.length > 0 || !url || !serviceRoleKey) {
    throw new Error(`Testsuite preflight failed:\n- ${failures.join('\n- ')}`);
  }

  let state: TestUsersState;
  try {
    state = loadState();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'testsuite state could not be loaded');
    throw new Error(`Testsuite preflight failed:\n- ${failures.join('\n- ')}`);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [
    rolesResult,
    modulesResult,
    errorLogsResult,
    vanCategoriesResult,
    workshopCategoriesResult,
  ] = await Promise.all([
    supabase.from('roles').select('id').limit(1),
    supabase.from('permission_modules').select('module_name').limit(1),
    supabase.from('error_logs').select('id').limit(1),
    supabase.from('van_categories').select('id').limit(1),
    supabase.from('workshop_task_categories').select('id').limit(1),
  ]);

  if (rolesResult.error || !rolesResult.data?.length) {
    failures.push(`roles is unavailable or empty: ${rolesResult.error?.message || 'no rows'}`);
  }
  if (modulesResult.error || !modulesResult.data?.length) {
    failures.push(`permission_modules is unavailable or empty: ${modulesResult.error?.message || 'no rows'}`);
  }
  if (errorLogsResult.error) {
    failures.push(`error_logs is unavailable: ${errorLogsResult.error.message}`);
  }
  if (vanCategoriesResult.error || !vanCategoriesResult.data?.length) {
    failures.push(`van_categories has no fixture prerequisite: ${vanCategoriesResult.error?.message || 'no rows'}`);
  }
  if (workshopCategoriesResult.error || !workshopCategoriesResult.data?.length) {
    failures.push(
      `workshop_task_categories has no fixture prerequisite: ${workshopCategoriesResult.error?.message || 'no rows'}`
    );
  }

  for (const role of TEST_USER_ROLES) {
    const expected = state[role];
    if (!expected?.userId || !expected.email || !expected.password) {
      failures.push(`testsuite state is missing complete "${role}" credentials`);
      continue;
    }

    const [{ data: authData, error: authError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase.auth.admin.getUserById(expected.userId),
        supabase
          .from('profiles')
          .select('id, employee_id, role_id, is_placeholder, must_change_password')
          .eq('id', expected.userId)
          .maybeSingle(),
      ]);

    if (
      authError ||
      !authData.user ||
      authData.user.email?.toLowerCase() !== expected.email.toLowerCase() ||
      !authData.user.email_confirmed_at
    ) {
      failures.push(`${role} auth identity does not match local testsuite state`);
    }
    if (
      profileError ||
      !profile ||
      !profile.role_id ||
      profile.is_placeholder !== true ||
      profile.must_change_password !== false
    ) {
      failures.push(`${role} profile does not satisfy hidden testsuite account requirements`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Testsuite preflight failed:\n- ${failures.join('\n- ')}`);
  }

  console.log(`Testsuite preflight passed for ${new URL(url).hostname}.`);
}

