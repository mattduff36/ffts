import { spawnSync } from 'child_process';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'POSTGRES_URL_NON_POOLING',
  'APP_SESSION_SECRET',
  'APP_SESSION_HASH_SECRET',
] as const;

const SUPERADMIN_EMAIL = (process.env.FOREST_FARM_SUPERADMIN_EMAIL || 'admin@mpdee.co.uk').trim().toLowerCase();
const SUPERADMIN_PASSWORD = process.env.FOREST_FARM_SUPERADMIN_PASSWORD || '';

function getExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function assertProductionEnvironment(): void {
  const appMode = process.env.APP_MODE;
  const publicAppMode = process.env.NEXT_PUBLIC_APP_MODE;

  if (appMode !== 'production' || publicAppMode !== 'production') {
    throw new Error('Set APP_MODE=production and NEXT_PUBLIC_APP_MODE=production before running this script.');
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const demoKeys = [
    'DEMO_SUPABASE_PROJECT_REF',
    'DEMO_RESET_CONFIRM',
    'DEMO_SNAPSHOT_CONFIRM',
    'DEMO_SNAPSHOT_PATH',
    'DEMO_USER_PASSWORD',
    'NEXT_PUBLIC_DEMO_EMAIL_DOMAIN',
  ].filter((key) => Boolean(process.env[key]));

  if (demoKeys.length > 0) {
    throw new Error(`Refusing production bootstrap while demo variables are set: ${demoKeys.join(', ')}`);
  }

  if (!SUPERADMIN_EMAIL.includes('@')) {
    throw new Error('FOREST_FARM_SUPERADMIN_EMAIL must be a valid email address.');
  }

  if (SUPERADMIN_PASSWORD.length < 12) {
    throw new Error('FOREST_FARM_SUPERADMIN_PASSWORD must be set to a temporary password of at least 12 characters.');
  }
}

function run(command: string, args: string[]): void {
  const rendered = [command, ...args].join(' ');
  console.log(`\n==> ${rendered}`);

  const result = spawnSync(getExecutable(command), args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command !== 'git',
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${rendered}`);
  }
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match?.id) return match.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function bootstrapSuperAdmin(): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .upsert(
      {
        name: 'superadmin',
        display_name: 'Super Administrator',
        description: 'Protected SuperAdmin for Forest Farm Tree Services production support.',
        role_class: 'admin',
        is_super_admin: true,
        is_manager_admin: true,
      },
      { onConflict: 'name' }
    )
    .select('id')
    .single();

  if (roleError) throw roleError;
  if (!role?.id) throw new Error('Unable to resolve superadmin role.');

  const existingUserId = await findAuthUserIdByEmail(SUPERADMIN_EMAIL);
  const authResult = existingUserId
    ? await supabase.auth.admin.updateUserById(existingUserId, {
        password: SUPERADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Matt Duffill' },
      })
    : await supabase.auth.admin.createUser({
        email: SUPERADMIN_EMAIL,
        password: SUPERADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Matt Duffill' },
      });

  if (authResult.error) throw authResult.error;

  const userId = authResult.data.user?.id || existingUserId;
  if (!userId) throw new Error('Unable to resolve superadmin auth user.');

  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      full_name: 'Matt Duffill',
      employee_id: 'FFTS-SUPERADMIN',
      role: 'admin',
      role_id: role.id,
      team_id: 'management',
      phone_number: null,
      super_admin: true,
      must_change_password: true,
    },
    { onConflict: 'id' }
  );

  if (profileError) throw profileError;
  console.log(`\nSuperAdmin ready: ${SUPERADMIN_EMAIL}`);
}

async function main(): Promise<void> {
  assertProductionEnvironment();

  run('npm', ['run', 'db:baseline']);
  run('npm', ['run', 'db:validate']);
  run('npm', ['run', 'setup:storage']);
  run('npx', ['tsx', 'scripts/maintenance/setup-rams-storage.ts']);
  run('npx', ['tsx', 'scripts/maintenance/setup-toolbox-talk-storage.ts']);
  run('npx', ['tsx', 'scripts/maintenance/setup-quote-attachments-storage.ts']);
  await bootstrapSuperAdmin();
  run('npm', ['run', 'db:validate']);

  console.log('\nForest Farm production bootstrap complete.');
  console.log('Remove FOREST_FARM_SUPERADMIN_PASSWORD from .env.local after verifying login.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
