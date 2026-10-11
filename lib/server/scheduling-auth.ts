import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule, getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';

export interface SchedulingAccessResult {
  allowed: boolean;
  status: 200 | 401 | 403;
  error?: string;
  userId?: string;
  accessLevel?: number;
  isManagerOrAdmin?: boolean;
  roleName?: string | null;
  roleClass?: 'admin' | 'manager' | 'employee' | null;
  teamId?: string | null;
  teamName?: string | null;
}

export async function requireSchedulingAccess(): Promise<SchedulingAccessResult> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return { allowed: false, status: 401, error: 'Unauthorized' };
  }

  if (!(await canEffectiveRoleAccessModule('scheduling'))) {
    return { allowed: false, status: 403, error: 'Scheduling access required' };
  }

  const accessLevel = await getEffectiveModuleAccessLevel('scheduling');
  return {
    allowed: true,
    status: 200,
    userId: effectiveRole.user_id,
    accessLevel,
    isManagerOrAdmin: accessLevel >= 4,
    roleName: effectiveRole.role_name,
    roleClass: effectiveRole.role_class,
    teamId: effectiveRole.team_id,
    teamName: effectiveRole.team_name,
  };
}

export async function requireSchedulingManagerAccess(): Promise<SchedulingAccessResult> {
  const access = await requireSchedulingAccess();
  if (!access.allowed) return access;
  if (!access.isManagerOrAdmin) {
    return { allowed: false, status: 403, error: 'Manager or admin access required' };
  }
  return access;
}

const SELF_ACCESS_UNAVAILABLE = 'Scheduling self-service is unavailable';

interface SchedulingAuthUser {
  banned_until?: string | null;
  deleted_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function denySchedulingSelfAccess(
  status: 401 | 403,
  error: string
): SchedulingAccessResult {
  return { allowed: false, status, error };
}

function isAuthUserBannedOrDeleted(user: SchedulingAuthUser): boolean {
  if (user.deleted_at) return true;

  const metadata = user.user_metadata;
  if (metadata?.deleted_at || metadata?.account_status === 'deleted') return true;

  if (!user.banned_until) return false;
  const bannedUntil = Date.parse(user.banned_until);
  return Number.isNaN(bannedUntil) || bannedUntil > Date.now();
}

export async function requireSchedulingSelfAccess(): Promise<SchedulingAccessResult> {
  try {
    const current = await getCurrentAuthenticatedProfile();
    const profileId = current?.profile?.id;
    if (!profileId) {
      return denySchedulingSelfAccess(401, 'Unauthorized');
    }

    const admin = createAdminClient();
    const profileResult = await admin
      .from('profiles')
      .select('id, is_placeholder')
      .eq('id', profileId)
      .maybeSingle();

    if (profileResult.error || !profileResult.data || profileResult.data.is_placeholder === true) {
      return denySchedulingSelfAccess(403, SELF_ACCESS_UNAVAILABLE);
    }

    const authResult = await admin.auth.admin.getUserById(profileId);
    const authUser = authResult.data?.user as SchedulingAuthUser | undefined;
    if (authResult.error || !authUser || isAuthUserBannedOrDeleted(authUser)) {
      return denySchedulingSelfAccess(403, SELF_ACCESS_UNAVAILABLE);
    }

    const matrixAllowed = await canEffectiveRoleAccessModule('scheduling');
    if (!matrixAllowed) {
      return denySchedulingSelfAccess(403, 'Scheduling access required');
    }

    return {
      allowed: true,
      status: 200,
      userId: profileId,
    };
  } catch {
    return denySchedulingSelfAccess(403, SELF_ACCESS_UNAVAILABLE);
  }
}
