/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

type ScriptSupabaseClient = ReturnType<typeof createClient<any>>;

const defaultSuperadminEmail = 'admin@mpdee.co.uk';

function getProjectRef(supabaseUrl: string): string | null {
  return supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1] ?? null;
}

function assertDemoProject(): { supabaseUrl: string; serviceRoleKey: string; email: string; password: string } {
  const appMode = process.env.APP_MODE || process.env.NEXT_PUBLIC_APP_MODE;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const expectedProjectRef = process.env.DEMO_SUPABASE_PROJECT_REF || '';
  const actualProjectRef = getProjectRef(supabaseUrl);
  const isLocalProject = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1');
  const email = (process.env.DEMO_SUPERADMIN_EMAIL || process.env.TEMPLATE_SUPERADMIN_EMAIL || defaultSuperadminEmail)
    .trim()
    .toLowerCase();
  const password = process.env.DEMO_SUPERADMIN_PASSWORD || '';

  if (appMode !== 'demo') {
    throw new Error('demo:bootstrap-superadmin can only run when APP_MODE or NEXT_PUBLIC_APP_MODE is set to demo.');
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  if (!isLocalProject && (!actualProjectRef || actualProjectRef !== expectedProjectRef)) {
    throw new Error('Refusing superadmin bootstrap because DEMO_SUPABASE_PROJECT_REF does not match NEXT_PUBLIC_SUPABASE_URL.');
  }

  if (!email.includes('@')) {
    throw new Error('DEMO_SUPERADMIN_EMAIL or TEMPLATE_SUPERADMIN_EMAIL must be a valid email address.');
  }

  if (password.length < 10) {
    throw new Error('DEMO_SUPERADMIN_PASSWORD must be set to the temporary password for the hidden owner account.');
  }

  return { supabaseUrl, serviceRoleKey, email, password };
}

async function findAuthUserIdByEmail(supabase: ScriptSupabaseClient, email: string): Promise<string | null> {
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

async function ensureSuperadminRole(supabase: ScriptSupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('roles')
    .upsert(
      {
        name: 'superadmin',
        display_name: 'Super Administrator',
        description: 'Hidden owner-only superadmin role for the hosted DigiDocs demo.',
        role_class: 'admin',
        is_super_admin: true,
        is_manager_admin: true,
      },
      { onConflict: 'name' }
    )
    .select('id')
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error('Unable to resolve hidden superadmin role.');
  return data.id;
}

async function main() {
  const { supabaseUrl, serviceRoleKey, email, password } = assertDemoProject();
  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const roleId = await ensureSuperadminRole(supabase);
  const existingUserId = await findAuthUserIdByEmail(supabase, email);
  const authResult = existingUserId
    ? await supabase.auth.admin.updateUserById(existingUserId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: 'DigiDocs Owner Superadmin' },
      })
    : await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'DigiDocs Owner Superadmin' },
      });

  if (authResult.error) throw authResult.error;
  const userId = authResult.data.user?.id || existingUserId;
  if (!userId) throw new Error('Unable to resolve hidden superadmin auth user.');

  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      full_name: 'DigiDocs Owner Superadmin',
      employee_id: 'OWNER-SUPERADMIN',
      role: 'admin',
      role_id: roleId,
      team_id: 'management',
      phone_number: '01632 960001',
      super_admin: true,
      must_change_password: true,
    },
    { onConflict: 'id' }
  );

  if (profileError) throw profileError;
  console.log(`Hidden owner superadmin ready: ${email}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
