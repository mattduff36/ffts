import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

// Helper to create admin client with service role key
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

interface AuthUserActivityRow {
  user_id: string;
  last_active_at: string | null;
}

interface AdminProfileSummary {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  employee_id: string | null;
  created_at: string | null;
  role_id: string | null;
  line_manager_id: string | null;
  secondary_manager_id: string | null;
  team_id: string | null;
  is_placeholder: boolean | null;
  role?: {
    name: string | null;
    display_name: string | null;
    role_class: 'admin' | 'manager' | 'employee' | null;
    is_super_admin: boolean | null;
    is_manager_admin: boolean | null;
  } | null;
}

async function fetchLastActiveByUserId(userIds: string[]): Promise<Map<string, string | null>> {
  const activityMap = new Map<string, string | null>();

  if (userIds.length === 0 || !process.env.POSTGRES_URL_NON_POOLING) {
    return activityMap;
  }

  const databaseUrl = new URL(process.env.POSTGRES_URL_NON_POOLING);
  const client = new pg.Client({
    host: databaseUrl.hostname,
    port: Number.parseInt(databaseUrl.port || '5432', 10),
    database: databaseUrl.pathname.slice(1),
    user: databaseUrl.username,
    password: databaseUrl.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    try {
      await client.connect();
      const { rows } = await client.query<AuthUserActivityRow>(
        `
          SELECT
            user_id::text AS user_id,
            MAX(updated_at)::text AS last_active_at
          FROM auth.sessions
          WHERE user_id = ANY($1::uuid[])
          GROUP BY user_id
        `,
        [userIds]
      );

      rows.forEach((row) => {
        activityMap.set(row.user_id, row.last_active_at);
      });
    } catch (error) {
      console.warn('Unable to fetch auth session activity for admin users list:', error);
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  return activityMap;
}

export async function GET() {
  try {
    const canAccessUserAdmin = await canEffectiveRoleAccessModule('admin-users');
    if (!canAccessUserAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: admin-users access required' },
        { status: 403 }
      );
    }

    // Fetch ALL auth users by paginating (default page size is 50)
    const supabaseAdmin = getSupabaseAdmin();
    const allUsers: Array<{
      id: string;
      email: string | undefined;
      last_sign_in_at: string | null;
      last_active_at: string | null;
      profile?: AdminProfileSummary | null;
    }> = [];
    let page = 1;
    const perPage = 1000;
    const authUsers: Array<{ id: string; email?: string; last_sign_in_at?: string | null }> = [];

    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });

      if (error) {
        console.error('Error fetching auth users (page ' + page + '):', error);
        return NextResponse.json(
          { error: 'Failed to fetch users' },
          { status: 500 }
        );
      }

      authUsers.push(
        ...data.users.map((user) => ({
          id: user.id,
          email: user.email,
          last_sign_in_at: user.last_sign_in_at || null,
        }))
      );

      if (data.users.length < perPage) break;
      page++;
    }

    const lastActiveByUserId = await fetchLastActiveByUserId(authUsers.map((user) => user.id));
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        full_name,
        phone_number,
        employee_id,
        created_at,
        role_id,
        line_manager_id,
        secondary_manager_id,
        team_id,
        is_placeholder,
        role:roles(
          name,
          display_name,
          role_class,
          is_super_admin,
          is_manager_admin
        )
      `)
      .in('id', authUsers.map((user) => user.id));

    if (profilesError) {
      console.warn('Unable to fetch profile summaries for admin users list:', profilesError);
    }

    const profileById = new Map<string, AdminProfileSummary>(
      ((profiles || []) as unknown as AdminProfileSummary[]).map((profile) => [profile.id, profile])
    );

    for (const user of authUsers) {
      allUsers.push({
        id: user.id,
        email: user.email,
        last_sign_in_at: user.last_sign_in_at || null,
        last_active_at: lastActiveByUserId.get(user.id) || null,
        profile: profileById.get(user.id) || null,
      });
    }

    const usersWithEmails = allUsers;

    return NextResponse.json({ users: usersWithEmails });
  } catch (error) {
    console.error('Error in list-with-emails:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

