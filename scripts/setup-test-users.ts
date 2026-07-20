/**
 * setup-test-users.ts
 *
 * Provisions dedicated TEST accounts for the testsuite.
 * Uses Supabase service role key — never commits credentials.
 *
 * Usage:
 *   Local:      npx tsx scripts/setup-test-users.ts
 *   Production: npx tsx scripts/setup-test-users.ts --confirm-production=FFTS_TESTSUITE
 *
 * NON-DESTRUCTIVE: Only creates/updates testsuite-specific accounts.
 * Does NOT touch any existing user accounts.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.TESTSUITE_SETUP_PASSWORD;
const PRODUCTION_CONFIRMATION = '--confirm-production=FFTS_TESTSUITE';

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

const targetUrl = new URL(SUPABASE_URL);
const targetHost = targetUrl.hostname.toLowerCase();
const isLocalTarget =
  targetHost === 'localhost' ||
  targetHost === '127.0.0.1' ||
  targetHost === '::1' ||
  targetHost.endsWith('.local');
const isForbiddenTarget = targetHost.includes('avsworklog') || targetHost.includes('squires');

if (isForbiddenTarget) {
  console.error(`Refusing testsuite setup for forbidden non-FFTS target: ${targetHost}`);
  process.exit(1);
}

if (!isLocalTarget && !process.argv.includes(PRODUCTION_CONFIRMATION)) {
  console.error(`Refusing remote testsuite setup for ${targetHost}.`);
  console.error(`Review the fictional accounts below, then rerun with ${PRODUCTION_CONFIRMATION}:`);
  console.error('  testsuite-admin@ffts.test (TS-ADM)');
  console.error('  testsuite-manager@ffts.test (TS-MGR)');
  console.error('  testsuite-employee@ffts.test (TS-EMP)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_USERS = [
  {
    key: 'admin',
    email: 'testsuite-admin@ffts.test',
    fullName: 'Testsuite Admin',
    employeeId: 'TS-ADM',
    superAdmin: true,
    roleMatcher: { is_manager_admin: true, is_super_admin: false, name: 'admin' },
    roleFallback: { is_manager_admin: true },
  },
  {
    key: 'manager',
    email: 'testsuite-manager@ffts.test',
    fullName: 'Testsuite Manager',
    employeeId: 'TS-MGR',
    superAdmin: false,
    roleMatcher: { is_manager_admin: true, name: 'manager' },
    roleFallback: { is_manager_admin: true },
  },
  {
    key: 'employee',
    email: 'testsuite-employee@ffts.test',
    fullName: 'Testsuite Employee',
    employeeId: 'TS-EMP',
    superAdmin: false,
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

  // Upsert profile — ensure must_change_password is false for test users
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      full_name: userDef.fullName,
      employee_id: userDef.employeeId,
      role_id: roleId,
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
        .select('id, employee_id, role_id, super_admin, is_placeholder, must_change_password')
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
    profile.super_admin !== userDef.superAdmin ||
    profile.is_placeholder !== true ||
    profile.must_change_password !== false
  ) {
    throw new Error(`Profile verification failed for ${userDef.email}: ${profileVerifyError?.message || 'stored profile does not match testsuite contract'}`);
  }

  return { email: userDef.email, password: TESTSUITE_PASSWORD, userId, role: userDef.key };
}

async function main() {
  console.log(`Setting up testsuite users on ${targetHost}...`);
  console.log('Only the three hidden @ffts.test identities will be created or updated.\n');

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
