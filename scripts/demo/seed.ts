/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

type ScriptSupabaseClient = ReturnType<typeof createClient<any>>;

interface DemoUser {
  key: 'admin' | 'manager' | 'employee' | 'contractor';
  email: string;
  fullName: string;
  employeeId: string;
  roleName: string;
  superAdmin: boolean;
}

const demoDomain = process.env.NEXT_PUBLIC_DEMO_EMAIL_DOMAIN || 'demo.example.test';
const password = process.env.DEMO_USER_PASSWORD || 'DemoPass123!';

const users: DemoUser[] = [
  {
    key: 'admin',
    email: `avery.stone@${demoDomain}`,
    fullName: 'Avery Stone',
    employeeId: 'DEMO-ADM',
    roleName: 'admin',
    superAdmin: true,
  },
  {
    key: 'manager',
    email: `morgan.reid@${demoDomain}`,
    fullName: 'Morgan Reid',
    employeeId: 'DEMO-MGR',
    roleName: 'manager',
    superAdmin: false,
  },
  {
    key: 'employee',
    email: `jamie.carter@${demoDomain}`,
    fullName: 'Jamie Carter',
    employeeId: 'DEMO-EMP',
    roleName: 'employee',
    superAdmin: false,
  },
  {
    key: 'contractor',
    email: `taylor.brooks@${demoDomain}`,
    fullName: 'Taylor Brooks',
    employeeId: 'DEMO-CON',
    roleName: 'employee',
    superAdmin: false,
  },
];

const vehicles = [
  { reg_number: 'DM24VAN', vehicle_type: 'Van', status: 'active' },
  { reg_number: 'DM24HGV', vehicle_type: 'HGV', status: 'active' },
  { reg_number: 'DM24PLT', vehicle_type: 'Plant', status: 'active' },
];

function assertDemoMode() {
  const appMode = process.env.APP_MODE || process.env.NEXT_PUBLIC_APP_MODE;
  if (appMode !== 'demo') {
    throw new Error('demo:seed can only run when APP_MODE or NEXT_PUBLIC_APP_MODE is set to demo.');
  }
}

async function findRoleId(supabase: ScriptSupabaseClient, roleName: string): Promise<string | null> {
  const { data } = await supabase
    .from('roles')
    .select('id')
    .or(`name.eq.${roleName},display_name.ilike.${roleName}`)
    .limit(1)
    .maybeSingle();

  return data?.id || null;
}

async function ensureDemoUsers(supabase: ScriptSupabaseClient) {
  const { data: existingUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

  for (const user of users) {
    const existing = existingUsers.users.find((candidate) => candidate.email === user.email);
    const authUser =
      existing ||
      (
        await supabase.auth.admin.createUser({
          email: user.email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: user.fullName,
            employee_id: user.employeeId,
            demo: true,
          },
        })
      ).data.user;

    if (!authUser) throw new Error(`Unable to create demo user ${user.email}`);

    if (existing) {
      await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...existing.user_metadata,
          full_name: user.fullName,
          employee_id: user.employeeId,
          demo: true,
        },
      });
    }

    const roleId = await findRoleId(supabase, user.roleName);
    const { error } = await supabase.from('profiles').upsert(
      {
        id: authUser.id,
        full_name: user.fullName,
        employee_id: user.employeeId,
        role_id: roleId,
        super_admin: user.superAdmin,
        must_change_password: false,
      },
      { onConflict: 'id' }
    );

    if (error) throw error;
    console.log(`Ready: ${user.fullName} (${user.email})`);
  }
}

async function seedVehicles(supabase: ScriptSupabaseClient) {
  const { error } = await supabase.from('vans').upsert(vehicles, { onConflict: 'reg_number' });
  if (error) {
    console.warn(`Vehicle seed skipped: ${error.message}`);
    return;
  }

  console.log(`Ready: ${vehicles.length} demo fleet records`);
}

async function main() {
  assertDemoMode();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await ensureDemoUsers(supabase);
  await seedVehicles(supabase);

  console.log('Demo seed complete. Login personas use password DemoPass123!');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
