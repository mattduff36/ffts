/**
 * Server-side "View As" helpers for API route handlers.
 *
 * Usage in a route handler:
 *
 *   const effectiveRole = await getEffectiveRole();
 *   if (!effectiveRole.is_manager_admin) {
 *     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 *   }
 */

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { VIEW_AS_ROLE_COOKIE_NAME, VIEW_AS_TEAM_COOKIE_NAME } from '@/lib/utils/view-as-cookie';

export interface EffectiveRoleInfo {
  /** The effective role id (may differ from actual if viewing-as) */
  role_id: string | null;
  role_name: string | null;
  display_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_manager_admin: boolean;
  is_super_admin: boolean;
  /** True when the caller is a real super admin and is actively viewing as another role */
  is_viewing_as: boolean;
  /** Always reflects the real user's super admin status */
  is_actual_super_admin: boolean;
  /** The authenticated user's id */
  user_id: string | null;
  /** Effective team id (may differ from actual if viewing-as) */
  team_id: string | null;
  /** Effective team name for UI/debugging */
  team_name: string | null;
}

/**
 * Determine the effective role for the current request.
 *
 * 1. Authenticate the caller via the standard Supabase session.
 * 2. Fetch the caller's *actual* profile and role.
 * 3. If the caller is an actual super admin AND the `avs_view_as_role_id` cookie
 *    is set, fetch the override role and return it as the effective role.
 * 4. Otherwise, return the caller's actual role.
 */
export async function getEffectiveRole(): Promise<EffectiveRoleInfo> {
  const none: EffectiveRoleInfo = {
    role_id: null,
    role_name: null,
    display_name: null,
    role_class: null,
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    user_id: null,
    team_id: null,
    team_name: null,
  };

  try {
    const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
    if (!current) {
      return none;
    }

    const userId = current.profile.id;
    const userEmail = current.profile.email;

    // Fetch actual profile + role using admin client to bypass RLS
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select(`
        id,
        super_admin,
        role_id,
        team_id,
        role:roles(
          id,
          name,
          display_name,
          role_class,
          is_manager_admin,
          is_super_admin
        )
      `)
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return none;
    }
    const typedProfile = profile as unknown as {
      super_admin: boolean | null;
      team_id: string | null;
      role: {
        id: string;
        name: string;
        display_name: string;
        role_class: 'admin' | 'manager' | 'employee' | null;
        is_manager_admin: boolean;
        is_super_admin: boolean;
      } | null;
    };

    const actualRole = typedProfile.role;
    const actualTeamId = typedProfile.team_id ?? null;
    let actualTeam: { id: string; name: string } | null = null;

    if (actualTeamId) {
      const { data: teamRow, error: teamError } = await admin
        .from('org_teams')
        .select('id, name')
        .eq('id', actualTeamId)
        .maybeSingle();

      if (!teamError && teamRow) {
        actualTeam = teamRow as { id: string; name: string };
      }
    }

    const isActualSuperAdmin =
      typedProfile.super_admin === true ||
      actualRole?.is_super_admin === true ||
      userEmail === 'admin@mpdee.co.uk';

    // Build baseline result from actual role
    const result: EffectiveRoleInfo = {
      role_id: actualRole?.id ?? null,
      role_name: actualRole?.name ?? null,
      display_name: actualRole?.display_name ?? null,
      role_class: actualRole?.role_class ?? null,
      is_manager_admin: actualRole?.is_manager_admin ?? false,
      is_super_admin: isActualSuperAdmin,
      is_viewing_as: false,
      is_actual_super_admin: isActualSuperAdmin,
      user_id: userId,
      team_id: actualTeamId ?? actualTeam?.id ?? null,
      team_name: actualTeam?.name ?? null,
    };

    // Only super admins may override
    if (!isActualSuperAdmin) return result;

    const cookieStore = await cookies();
    const viewAsRoleId = cookieStore.get(VIEW_AS_ROLE_COOKIE_NAME)?.value;
    const viewAsTeamId = cookieStore.get(VIEW_AS_TEAM_COOKIE_NAME)?.value;

    let effectiveRole = actualRole;
    let effectiveTeamId = result.team_id;
    let effectiveTeamName = result.team_name;
    let isViewingAs = false;

    if (viewAsRoleId) {
      const { data: overrideRole, error: overrideError } = await admin
        .from('roles')
        .select('id, name, display_name, role_class, is_manager_admin, is_super_admin')
        .eq('id', viewAsRoleId)
        .single();

      if (!overrideError && overrideRole) {
        effectiveRole = overrideRole as {
          id: string;
          name: string;
          display_name: string;
          role_class: 'admin' | 'manager' | 'employee' | null;
          is_manager_admin: boolean;
          is_super_admin: boolean;
        };
        isViewingAs = true;
      }
    }

    if (viewAsTeamId) {
      const { data: overrideTeam, error: overrideTeamError } = await admin
        .from('org_teams')
        .select('id, name')
        .eq('id', viewAsTeamId)
        .maybeSingle();

      if (!overrideTeamError && overrideTeam) {
        effectiveTeamId = overrideTeam.id;
        effectiveTeamName = overrideTeam.name;
        isViewingAs = true;
      }
    }

    const resolved = {
      role_id: effectiveRole?.id ?? null,
      role_name: effectiveRole?.name ?? null,
      display_name: effectiveRole?.display_name ?? null,
      role_class: effectiveRole?.role_class ?? null,
      is_manager_admin: effectiveRole?.is_manager_admin ?? false,
      is_super_admin: effectiveRole?.is_super_admin ?? false,
      is_viewing_as: isViewingAs,
      is_actual_super_admin: true,
      user_id: userId,
      team_id: effectiveTeamId,
      team_name: effectiveTeamName,
    };
    return resolved;
  } catch (error) {
    console.error('[getEffectiveRole] Error:', error);
    return none;
  }
}
