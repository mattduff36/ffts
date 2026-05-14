/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { spawn } from 'child_process';

config({ path: resolve(process.cwd(), '.env.local') });

const demoDomain = process.env.NEXT_PUBLIC_DEMO_EMAIL_DOMAIN || 'demo.example.test';
type ScriptSupabaseClient = ReturnType<typeof createClient<any>>;

function assertResetAllowed() {
  const appMode = process.env.APP_MODE || process.env.NEXT_PUBLIC_APP_MODE;
  const confirmed = process.env.DEMO_RESET_CONFIRM === 'RESET_DEMO_DATA';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

  if (appMode !== 'demo') {
    throw new Error('demo:reset can only run when APP_MODE or NEXT_PUBLIC_APP_MODE is set to demo.');
  }

  if (!confirmed) {
    throw new Error('Set DEMO_RESET_CONFIRM=RESET_DEMO_DATA to confirm this destructive demo reset.');
  }

  if (!supabaseUrl.includes('demo') && !supabaseUrl.includes('localhost')) {
    throw new Error('Refusing demo reset because NEXT_PUBLIC_SUPABASE_URL is not clearly a demo/local project.');
  }
}

async function deleteFromTable(
  supabase: ScriptSupabaseClient,
  table: string,
  column: string,
  values: string[]
): Promise<void> {
  if (values.length === 0) return;

  const { error } = await supabase.from(table).delete().in(column, values);
  if (error) {
    console.warn(`Skipped ${table}.${column}: ${error.message}`);
  } else {
    console.log(`Cleared demo rows from ${table}.`);
  }
}

async function runSeed(): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npm', ['run', 'demo:seed'], {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`demo:seed exited with code ${code}`));
    });
  });
}

async function main() {
  assertResetAllowed();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const demoUsers = data.users.filter((user) => user.email?.toLowerCase().endsWith(`@${demoDomain}`));
  const demoUserIds = demoUsers.map((user) => user.id);

  console.log(`Found ${demoUsers.length} demo user(s) for ${demoDomain}.`);

  for (const [table, column] of [
    ['timesheet_entries', 'user_id'],
    ['timesheets', 'user_id'],
    ['van_inspections', 'user_id'],
    ['inspection_photos', 'uploaded_by'],
    ['absences', 'user_id'],
    ['rams_assignments', 'profile_id'],
    ['message_recipients', 'recipient_id'],
    ['actions', 'created_by'],
    ['audit_log', 'user_id'],
    ['user_page_visits', 'user_id'],
    ['profiles', 'id'],
  ] as const) {
    await deleteFromTable(supabase, table, column, demoUserIds);
  }

  for (const user of demoUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) console.warn(`Failed to delete auth user ${user.email}: ${error.message}`);
    else console.log(`Deleted auth user ${user.email}.`);
  }

  await supabase.from('vans').delete().like('reg_number', 'DM24%');
  console.log('Recreating demo data...');
  await runSeed();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
