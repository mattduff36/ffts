import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { isHiddenSystemTestAccountEmail, isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';

type Manager = {
  id: string;
  full_name: string;
  email: string | null;
  role: {
    name: string;
    display_name: string;
  } | null;
};

const PRIORITY_MANAGER_EMAIL =
  process.env.NEXT_PUBLIC_PRIORITY_MANAGER_EMAIL?.trim().toLowerCase() ||
  'admin@mpdee.co.uk';

function getSupabaseAdmin() {
  return createSupabaseAdmin<Database>(
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

function isPriorityManager(manager: Manager): boolean {
  return manager.email?.trim().toLowerCase() === PRIORITY_MANAGER_EMAIL;
}

function compareManagers(a: Manager, b: Manager): number {
  if (isPriorityManager(a)) return -1;
  if (isPriorityManager(b)) return 1;
  return (a.full_name || '').localeCompare(b.full_name || '');
}

export async function GET() {
  try {
    // Use effective role (respects View As mode for super admins)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessApprovals = await canEffectiveRoleAccessModule('approvals');
    if (!canAccessApprovals) {
      return NextResponse.json(
        { error: 'Approvals access required' },
        { status: 403 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Query profiles with roles, then get emails from auth.users
    const { data: profilesData, error } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        full_name,
        employee_id,
        is_placeholder,
        roles!inner(
          name,
          display_name,
          is_manager_admin
        )
      `)
      .eq('roles.is_manager_admin', true)
      .order('full_name');

    if (error) {
      console.error('Error fetching manager/admin profiles:', error);
      return NextResponse.json(
        { error: 'Failed to fetch managers' },
        { status: 500 }
      );
    }

    // Get emails from auth.users for these profiles
    // Fetch each user by ID to avoid pagination limits of listUsers()
    const emailMap = new Map<string, string | null>();
    
    for (const profile of ((profilesData ?? []) as Array<{ id: string; full_name: string; employee_id: string | null; is_placeholder: boolean | null; roles: { name: string; display_name: string; is_manager_admin: boolean } | null }>)) {
      try {
        const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
        if (!userError && user?.email) {
          emailMap.set(profile.id, user.email);
        } else {
          console.error(`Error fetching email for user ${profile.id}:`, userError);
          emailMap.set(profile.id, null);
        }
      } catch (err) {
        console.error(`Exception fetching email for user ${profile.id}:`, err);
        emailMap.set(profile.id, null);
      }
    }

    // Merge profiles with emails
    const data = ((profilesData ?? []) as Array<{ id: string; full_name: string; employee_id: string | null; is_placeholder: boolean | null; roles: { name: string; display_name: string; is_manager_admin: boolean } | null }>).map((profile) => ({
      ...profile,
      email: emailMap.get(profile.id) || null,
    })).filter((profile) => !isHiddenSystemTestAccountEmail(profile.email) && !isHiddenSystemTestAccountProfile(profile));

    const rawManagers = (data ?? []) as Array<{
      id: string;
      full_name: string;
      email: string | null;
      roles: { name: string; display_name: string; is_manager_admin: boolean } | null;
    }>;

    // Transform to a clean payload for the client
    const managers: Manager[] = rawManagers.map((m) => ({
      id: m.id,
      full_name: m.full_name,
      email: m.email,
      role: m.roles
        ? {
            name: m.roles.name,
            display_name: m.roles.display_name,
          }
        : null,
    }));

    // Ensure Priority Manager is first in the response
    managers.sort(compareManagers);

    return NextResponse.json({ managers });
  } catch (error) {
    console.error('Unexpected error fetching managers:', error);

    await logServerError({
      error: error as Error,
      componentName: '/api/timesheets/managers',
      additionalData: {
        endpoint: '/api/timesheets/managers',
      },
    });
    return NextResponse.json(
      { error: 'Failed to fetch managers' },
      { status: 500 }
    );
  }
}
