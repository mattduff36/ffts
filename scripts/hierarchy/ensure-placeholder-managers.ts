import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const PLACEHOLDER_MANAGERS = [
  {
    key: 'example-manager',
    full_name: 'Example Manager',
    email: 'placeholder+example-manager@example.local',
  },
  {
    key: 'example-user-five',
    full_name: 'Example User Five',
    email: 'placeholder+example-user-five@ffts.local',
  },
] as const;

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function getPlaceholderEmployeeId(key: string): string {
  return `PLACEHOLDER-${key.replace(/[^a-z0-9]+/gi, '-').toUpperCase()}`;
}

async function findUserByEmail(email: string) {
  const supabaseAdmin = getSupabaseAdmin();
  let page = 1;

  while (page < 20) {
    const result = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (result.error) {
      throw result.error;
    }

    const match = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      return match;
    }

    if (result.data.users.length < 200) {
      return null;
    }

    page += 1;
  }

  return null;
}

async function getManagerRoleId() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id')
    .eq('name', 'manager')
    .single();

  if (error || !data) {
    throw error || new Error('Manager role not found');
  }

  return data.id as string;
}

async function ensurePlaceholderUser(definition: typeof PLACEHOLDER_MANAGERS[number]) {
  const supabaseAdmin = getSupabaseAdmin();
  const existingUser = await findUserByEmail(definition.email);

  if (existingUser) {
    return existingUser.id;
  }

  const createResult = await supabaseAdmin.auth.admin.createUser({
    email: definition.email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: {
      full_name: definition.full_name,
      account_status: 'placeholder_manager',
      is_placeholder: true,
      placeholder_key: definition.key,
    },
  });

  if (createResult.error || !createResult.data.user) {
    throw createResult.error || new Error(`Failed to create placeholder user: ${definition.full_name}`);
  }

  return createResult.data.user.id;
}

async function main() {
  const supabaseAdmin = getSupabaseAdmin();
  const managerRoleId = await getManagerRoleId();

  for (const placeholder of PLACEHOLDER_MANAGERS) {
    const userId = await ensurePlaceholderUser(placeholder);
    const employeeId = getPlaceholderEmployeeId(placeholder.key);

    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: userId,
          full_name: placeholder.full_name,
          employee_id: employeeId,
          role_id: managerRoleId,
          must_change_password: false,
          is_placeholder: true,
          placeholder_key: placeholder.key,
        },
        { onConflict: 'id' }
      );

    if (error) {
      throw error;
    }

    await supabaseAdmin.auth.admin.updateUserById(userId, {
      banned_until: '2099-12-31T00:00:00.000Z',
      user_metadata: {
        full_name: placeholder.full_name,
        account_status: 'placeholder_manager',
        is_placeholder: true,
        placeholder_key: placeholder.key,
      },
    } as unknown as Parameters<typeof supabaseAdmin.auth.admin.updateUserById>[1]);

    console.log(`Ready: ${placeholder.full_name}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
