import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { isHiddenSystemTestAccountEmail } from '@/lib/utils/system-test-accounts';

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
    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    // Fetch ALL auth users by paginating (default page size is 50)
    const supabaseAdmin = getSupabaseAdmin();
    const allUsers: Array<{
      id: string;
      email: string | undefined;
      last_sign_in_at: string | null;
      last_active_at: string | null;
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
        ...data.users.filter((user) => !isHiddenSystemTestAccountEmail(user.email)).map((user) => ({
          id: user.id,
          email: user.email,
          last_sign_in_at: user.last_sign_in_at || null,
        }))
      );

      if (data.users.length < perPage) break;
      page++;
    }

    const lastActiveByUserId = await fetchLastActiveByUserId(authUsers.map((user) => user.id));
    for (const user of authUsers) {
      allUsers.push({
        id: user.id,
        email: user.email,
        last_sign_in_at: user.last_sign_in_at || null,
        last_active_at: lastActiveByUserId.get(user.id) || null,
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

