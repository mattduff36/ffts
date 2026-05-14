/**
 * setup-test-users.ts
 *
 * Provisions dedicated TEST accounts for the testsuite.
 * Uses Supabase service role key — never commits credentials.
 *
 * Usage: npx tsx scripts/setup-test-users.ts
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

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing required env vars:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING');
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', SERVICE_ROLE_KEY ? 'set' : 'MISSING');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_USERS = [
  {
    key: 'default',
    email: 'test@example.com',
    password: 'test123456',
    fullName: 'Default Integration Test User',
    employeeId: 'TS-DEFAULT',
    teamId: 'management',
    superAdmin: false,
    roleMatcher: { is_manager_admin: true, name: 'manager' },
    roleFallback: { is_manager_admin: true },
  },
  {
    key: 'admin',
    email: 'testsuite-admin@example.test',
    fullName: 'Testsuite Admin',
    employeeId: 'TS-ADM',
    teamId: 'management',
    superAdmin: true,
    roleMatcher: { is_manager_admin: true, is_super_admin: false, name: 'admin' },
    roleFallback: { is_manager_admin: true },
  },
  {
    key: 'manager',
    email: 'testsuite-manager@example.test',
    fullName: 'Testsuite Manager',
    employeeId: 'TS-MGR',
    teamId: 'management',
    superAdmin: false,
    roleMatcher: { is_manager_admin: true, name: 'manager' },
    roleFallback: { is_manager_admin: true },
  },
  {
    key: 'employee',
    email: 'testsuite-employee@example.test',
    fullName: 'Testsuite Employee',
    employeeId: 'TS-EMP',
    teamId: 'civils',
    superAdmin: false,
    roleMatcher: { is_manager_admin: false, name: 'employee' },
    roleFallback: { is_manager_admin: false },
  },
];

const PASSWORD = 'TestSuite2026!Secure';

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

async function ensureUser(userDef: typeof TEST_USERS[number]): Promise<{ email: string; password: string; userId: string; role: string }> {
  const roleId = await findRoleId(userDef.roleMatcher, userDef.roleFallback);
  const password = userDef.password || PASSWORD;
  console.log(`  Role for ${userDef.key}: ${roleId}`);

  // Check if user already exists by email
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find(u => u.email === userDef.email);

  let userId: string;

  if (existing) {
    userId = existing.id;
    console.log(`  User ${userDef.email} already exists (${userId}), updating password...`);
    await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
  } else {
    console.log(`  Creating user ${userDef.email}...`);
    const { data: newUser, error } = await supabase.auth.admin.createUser({
      email: userDef.email,
      password,
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
      team_id: userDef.teamId,
      role_id: roleId,
      super_admin: userDef.superAdmin,
      must_change_password: false,
    }, { onConflict: 'id' });

  // Double-check: explicitly set must_change_password to false
  await supabase
    .from('profiles')
    .update({
      must_change_password: false,
      super_admin: userDef.superAdmin,
      team_id: userDef.teamId,
    })
    .eq('id', userId);

  if (profileError) {
    console.warn(`  Warning: profile upsert for ${userDef.email}: ${profileError.message}`);
  }

  return { email: userDef.email, password, userId, role: userDef.key };
}

async function main() {
  console.log('Setting up testsuite test users...\n');

  const results: Record<string, { email: string; password: string; userId: string; role: string }> = {};

  for (const userDef of TEST_USERS) {
    console.log(`[${userDef.key}]`);
    try {
      results[userDef.key] = await ensureUser(userDef);
      console.log(`  Done.\n`);
    } catch (err) {
      console.error(`  FAILED: ${err}\n`);
      process.exit(1);
    }
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
