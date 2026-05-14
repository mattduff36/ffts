import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTemplateSuperAdminEmail } from '@/lib/config/template-server-config';

const ACTIVE_WINDOW_MINUTES = 5;
const MAX_VISITS_TO_SCAN = 5000;
const RECENT_USERS_LIMIT = 5;

interface ActiveUserSummary {
  userId: string;
  fullName: string;
  lastVisitedAt: string;
  path: string;
  roleDisplayName: string | null;
  teamName: string | null;
}

interface ActiveVisitRow {
  user_id: string;
  path: string;
  visited_at: string;
  profile?:
    | {
        full_name?: string | null;
        role?:
          | {
              display_name?: string | null;
            }
          | {
              display_name?: string | null;
            }[]
          | null;
        team?:
          | {
              name?: string | null;
            }
          | {
              name?: string | null;
            }[]
          | null;
      }
    | {
        full_name?: string | null;
        role?:
          | {
              display_name?: string | null;
            }
          | {
              display_name?: string | null;
            }[]
          | null;
        team?:
          | {
              name?: string | null;
            }
          | {
              name?: string | null;
            }[]
          | null;
      }[]
    | null;
}

function getSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value;
}

function toActiveUserSummary(row: ActiveVisitRow): ActiveUserSummary {
  const profile = getSingle(row.profile);
  const role = getSingle(profile?.role);
  const team = getSingle(profile?.team);

  return {
    userId: row.user_id,
    fullName: profile?.full_name?.trim() || 'Unknown User',
    lastVisitedAt: row.visited_at,
    path: row.path,
    roleDisplayName: role?.display_name || null,
    teamName: team?.name || null,
  };
}

function isSuperAdminProfile(profile: {
  super_admin?: boolean | null;
  role?: { is_super_admin?: boolean | null } | null;
}): boolean {
  return profile.super_admin === true || profile.role?.is_super_admin === true;
}

async function resolveExcludedUserId(admin: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const excludedEmail = getTemplateSuperAdminEmail();
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn('Unable to resolve excluded active-now user:', error.message);
      return null;
    }

    const matchedUser = data.users.find((candidate) => candidate.email === excludedEmail);
    if (matchedUser?.id) {
      return matchedUser.id;
    }

    if (data.users.length < perPage) {
      break;
    }

    page += 1;
  }

  return null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select(`
      super_admin,
      role:roles(
        is_super_admin
      )
    `)
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Unable to verify user' }, { status: 403 });
  }

  const typedProfile = profile as {
    super_admin?: boolean | null;
    role?: { is_super_admin?: boolean | null } | null;
  };

  const excludedEmail = getTemplateSuperAdminEmail();
  const isActualSuperAdmin = isSuperAdminProfile(typedProfile) || user.email === excludedEmail;
  if (!isActualSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: visits, error: visitsError } = await admin
    .from('user_page_visits')
    .select(`
      user_id,
      path,
      visited_at,
      profile:profiles!user_page_visits_user_id_fkey(
        full_name,
        role:roles(display_name),
        team:org_teams!profiles_team_id_fkey(name)
      )
    `)
    .order('visited_at', { ascending: false })
    .limit(MAX_VISITS_TO_SCAN);

  if (visitsError) {
    return NextResponse.json(
      { error: visitsError.message || 'Failed to load active users' },
      { status: 500 }
    );
  }

  const excludedUserIds = new Set<string>();
  if (user.email === excludedEmail) {
    excludedUserIds.add(user.id);
  }

  const resolvedExcludedUserId = await resolveExcludedUserId(admin);
  if (resolvedExcludedUserId) {
    excludedUserIds.add(resolvedExcludedUserId);
  }

  const latestByUserId = new Map<string, ActiveUserSummary>();
  for (const rawVisit of (visits || []) as ActiveVisitRow[]) {
    if (!rawVisit.user_id || !rawVisit.visited_at) continue;
    if (excludedUserIds.has(rawVisit.user_id)) continue;
    if (latestByUserId.has(rawVisit.user_id)) continue;
    latestByUserId.set(rawVisit.user_id, toActiveUserSummary(rawVisit));
  }

  const orderedUsers = Array.from(latestByUserId.values());
  const activeThresholdMs = Date.now() - ACTIVE_WINDOW_MINUTES * 60 * 1000;
  const activeNowUsers = orderedUsers.filter((entry) => {
    const visitTimeMs = new Date(entry.lastVisitedAt).getTime();
    if (Number.isNaN(visitTimeMs)) return false;
    return visitTimeMs >= activeThresholdMs;
  });
  const recentUsers = orderedUsers.slice(0, RECENT_USERS_LIMIT);

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    activeWindowMinutes: ACTIVE_WINDOW_MINUTES,
    activeNowUsers,
    recentUsers,
  });
}
