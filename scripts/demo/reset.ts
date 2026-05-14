/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { spawn } from 'child_process';

config({ path: resolve(process.cwd(), '.env.local') });

const demoDomain = process.env.NEXT_PUBLIC_DEMO_EMAIL_DOMAIN || 'demo.example.test';
type ScriptSupabaseClient = ReturnType<typeof createClient<any>>;

function getProjectRef(supabaseUrl: string): string | null {
  return supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1] ?? null;
}

function assertResetAllowed() {
  const appMode = process.env.APP_MODE || process.env.NEXT_PUBLIC_APP_MODE;
  const confirmed = process.env.DEMO_RESET_CONFIRM === 'RESET_DEMO_DATA';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const expectedProjectRef = process.env.DEMO_SUPABASE_PROJECT_REF || '';
  const actualProjectRef = getProjectRef(supabaseUrl);
  const isLocalProject = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1');

  if (appMode !== 'demo') {
    throw new Error('demo:reset can only run when APP_MODE or NEXT_PUBLIC_APP_MODE is set to demo.');
  }

  if (!confirmed) {
    throw new Error('Set DEMO_RESET_CONFIRM=RESET_DEMO_DATA to confirm this destructive demo reset.');
  }

  if (!isLocalProject && (!actualProjectRef || actualProjectRef !== expectedProjectRef)) {
    throw new Error('Refusing demo reset because DEMO_SUPABASE_PROJECT_REF does not match NEXT_PUBLIC_SUPABASE_URL.');
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

  await supabase.from('quotes').delete().like('quote_reference', 'DEMO-%');
  await supabase.from('customers').delete().eq('company_name', 'Demo Civil Engineering Ltd');
  await supabase.from('messages').delete().eq('created_via', 'demo-seed');
  await supabase.from('actions').delete().like('title', 'Demo %');

  for (const [table, column] of [
    ['timesheet_entries', 'user_id'],
    ['timesheets', 'user_id'],
    ['van_inspections', 'user_id'],
    ['inspection_photos', 'uploaded_by'],
    ['absences', 'user_id'],
    ['rams_assignments', 'profile_id'],
    ['message_recipients', 'user_id'],
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
