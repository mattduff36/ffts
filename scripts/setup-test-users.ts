/**
 * setup-test-users.ts
 *
 * Provisions dedicated TEST accounts for the testsuite.
 * Uses Supabase service role key — never commits credentials.
 *
 * Usage:
 *   npx tsx scripts/setup-test-users.ts --confirm-development=FFTS_TESTSUITE
 *
 * Development only: creates/updates dedicated testsuite accounts.
 * Hosted accounts are protected regardless of legacy production confirmations.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

import { requireDevelopmentTarget } from '../lib/utils/development-target';

config({ path: resolve(process.cwd(), '.env.development.local') });
const developmentTarget = requireDevelopmentTarget(process.env);
if (!process.argv.includes('--confirm-development=FFTS_TESTSUITE')) {
  throw new Error('Development confirmation required: --confirm-development=FFTS_TESTSUITE');
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.TESTSUITE_SETUP_PASSWORD;


if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PASSWORD) {
  console.error('Missing required env vars:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING');
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', SERVICE_ROLE_KEY ? 'set' : 'MISSING');
  console.error('  TESTSUITE_SETUP_PASSWORD:', PASSWORD ? 'set' : 'MISSING');
  process.exit(1);
}

if (
  PASSWORD.length < 12 ||
  !/[A-Z]/u.test(PASSWORD) ||
  !/[a-z]/u.test(PASSWORD) ||
  !/[0-9]/u.test(PASSWORD)
) {
  console.error(
    'TESTSUITE_SETUP_PASSWORD must be at least 12 characters and include uppercase, lowercase, and a number.'
  );
  process.exit(1);
}
const TESTSUITE_PASSWORD = PASSWORD;
const TESTSUITE_OPERATIONAL_TEAM_ID = process.env.TESTSUITE_TEAM_ID?.trim() || 'civils';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_USERS = [
  {
    key: 'admin',
    email: 'testsuite-admin@ffts.test',
    fullName: 'Testsuite Admin',
    employeeId: 'TS-ADM',
    superAdmin: false,
    teamId: null,
    roleMatcher: { is_manager_admin: true, is_super_admin: false, name: 'admin' },
    roleFallback: { is_manager_admin: true },
  },
  {
    key: 'manager',
    email: 'testsuite-manager@ffts.test',
    fullName: 'Testsuite Manager',
    employeeId: 'TS-MGR',
    superAdmin: false,
    teamId: TESTSUITE_OPERATIONAL_TEAM_ID,
    roleMatcher: { is_manager_admin: true, name: 'manager' },
    roleFallback: { is_manager_admin: true },
  },
  {
    key: 'employee',
    email: 'testsuite-employee@ffts.test',
    fullName: 'Testsuite Employee',
    employeeId: 'TS-EMP',
    superAdmin: false,
    teamId: TESTSUITE_OPERATIONAL_TEAM_ID,
    roleMatcher: { is_manager_admin: false, name: 'employee' },
    roleFallback: { is_manager_admin: false },
  },
];

async function findRoleId(matcher: Record<string, unknown>, fallback: Record<string, unknown>): Promise<string> {
  // Try exact match first
  let query = supabase.from('roles').select('id');
  for (const [k, v] of Object.entries(matcher)) {
    query = query.eq(k, v);
  }
  const { data: exact } = await query.limit(1).single();
  if (exact) return exact.id;

  // Fallback to broader match
  let fallbackQuery = supabase.from('roles').select('id');
  for (const [k, v] of Object.entries(fallback)) {
    fallbackQuery = fallbackQuery.eq(k, v);
  }
  const { data: broad } = await fallbackQuery.limit(1).single();
  if (broad) return broad.id;

  throw new Error(`No role found matching ${JSON.stringify(matcher)} or ${JSON.stringify(fallback)}`);
}

async function findAuthUserByEmail(email: string) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to list auth users: ${error.message}`);
    }

    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
}

async function assertOperationalTeamExists(): Promise<void> {
  const { data, error } = await supabase
    .from('org_teams')
    .select('id, active')
    .eq('id', TESTSUITE_OPERATIONAL_TEAM_ID)
    .single();

  if (error || !data?.active) {
    throw new Error(
      `Testsuite operational team "${TESTSUITE_OPERATIONAL_TEAM_ID}" is missing or inactive: ${error?.message || 'inactive team'}`
    );
  }
}

async function ensureUser(userDef: typeof TEST_USERS[number]): Promise<{ email: string; password: string; userId: string; role: string }> {
  const roleId = await findRoleId(userDef.roleMatcher, userDef.roleFallback);
  console.log(`  Role for ${userDef.key}: ${roleId}`);

  const existing = await findAuthUserByEmail(userDef.email);

  let userId: string;

  if (existing) {
    userId = existing.id;
    console.log(`  User ${userDef.email} already exists, updating testsuite credentials...`);
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: TESTSUITE_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: userDef.fullName,
        role_id: roleId,
        employee_id: userDef.employeeId,
      },
    });
    if (error) throw new Error(`Failed to update ${userDef.email}: ${error.message}`);
  } else {
    console.log(`  Creating user ${userDef.email}...`);
    const { data: newUser, error } = await supabase.auth.admin.createUser({
      email: userDef.email,
      password: TESTSUITE_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: userDef.fullName,
        role_id: roleId,
        employee_id: userDef.employeeId,
      },
    });

    if (error) throw new Error(`Failed to create ${userDef.email}: ${error.message}`);
    userId = newUser.user.id;
  }

  // Wait for trigger to create profile
  await new Promise(r => setTimeout(r, 1000));

  // Upsert profile — ensure the operational test roles have a real development team.
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      full_name: userDef.fullName,
      employee_id: userDef.employeeId,
      role_id: roleId,
      team_id: userDef.teamId,
      super_admin: userDef.superAdmin,
      is_placeholder: true,
      must_change_password: false,
    }, { onConflict: 'id' });

  if (profileError) {
    throw new Error(`Profile upsert failed for ${userDef.email}: ${profileError.message}`);
  }

  const [{ data: verifiedAuth, error: authVerifyError }, { data: profile, error: profileVerifyError }] =
    await Promise.all([
      supabase.auth.admin.getUserById(userId),
      supabase
        .from('profiles')
        .select('id, employee_id, role_id, team_id, super_admin, is_placeholder, must_change_password')
        .eq('id', userId)
        .single(),
    ]);

  if (authVerifyError || !verifiedAuth.user?.email_confirmed_at) {
    throw new Error(`Auth verification failed for ${userDef.email}: ${authVerifyError?.message || 'email is not confirmed'}`);
  }
  if (
    profileVerifyError ||
    !profile ||
    profile.employee_id !== userDef.employeeId ||
    profile.role_id !== roleId ||
    profile.team_id !== userDef.teamId ||
    profile.super_admin !== userDef.superAdmin ||
    profile.is_placeholder !== true ||
    profile.must_change_password !== false
  ) {
    throw new Error(`Profile verification failed for ${userDef.email}: ${profileVerifyError?.message || 'stored profile does not match testsuite contract'}`);
  }

  return { email: userDef.email, password: TESTSUITE_PASSWORD, userId, role: userDef.key };
}

async function main() {
  console.log(`Setting up testsuite users on ${developmentTarget.apiOrigin}...`);
  console.log('Only the three hidden @ffts.test identities will be created or updated.');
  console.log(`Manager and employee use development team "${TESTSUITE_OPERATIONAL_TEAM_ID}".\n`);
  await assertOperationalTeamExists();

  const results: Record<string, { email: string; password: string; userId: string; role: string }> = {};

  try {
    for (const userDef of TEST_USERS) {
      console.log(`[${userDef.key}]`);
      results[userDef.key] = await ensureUser(userDef);
      console.log(`  Done.\n`);
    }
  } catch (err) {
    console.error(`  FAILED: ${err}\n`);
    console.error('Local testsuite state was not written because provisioning did not complete.');
    process.exit(1);
  }

  // Write state file
  const stateDir = resolve(process.cwd(), 'testsuite', '.state');
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  const stateFile = resolve(stateDir, 'test-users.json');
  writeFileSync(stateFile, JSON.stringify(results, null, 2));
  console.log(`Test user credentials written to ${stateFile}`);
  console.log('(This file is .gitignored and should never be committed.)\n');
  console.log('Test users ready. Run: npm run testsuite');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
