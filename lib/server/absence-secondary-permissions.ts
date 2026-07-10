import { createAdminClient } from '@/lib/supabase/admin';
import { getPermissionLevelsForUser } from '@/lib/server/team-permissions';
import { filterHiddenSystemTestAccounts } from '@/lib/utils/system-test-accounts';
import {
  ABSENCE_SECONDARY_PERMISSION_HEADERS,
  ABSENCE_SECONDARY_PERMISSION_KEYS,
  applyAbsenceSecondaryOverrides,
  createNullAbsenceSecondaryOverrideRecord,
  getAbsenceSecondaryDefaultMap,
  type AbsenceSecondaryExceptionMatrixResponse,
  type AbsenceSecondaryPermissionExceptionRecord,
  type AbsenceSecondaryPermissionKey,
  type AbsenceSecondaryPermissionMap,
  type AbsenceSecondaryRoleTier,
} from '@/types/absence-permissions';
import type { PermissionAccessLevel } from '@/types/roles';

interface RoleShape {
  name?: string | null;
  display_name?: string | null;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  is_manager_admin?: boolean | null;
  is_super_admin?: boolean | null;
}

interface ProfileWithRoleRow {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  team_id: string | null;
  role_id: string | null;
  team?: { id?: string | null; name?: string | null } | null;
  role?: RoleShape | null;
}

interface ExceptionRow {
  profile_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  see_bookings_all?: boolean | null;
  see_bookings_team?: boolean | null;
  see_bookings_own?: boolean | null;
  add_edit_bookings_all?: boolean | null;
  add_edit_bookings_team?: boolean | null;
  add_edit_bookings_own?: boolean | null;
  see_allowances_all?: boolean | null;
  see_allowances_team?: boolean | null;
  add_edit_allowances_all?: boolean | null;
  add_edit_allowances_team?: boolean | null;
  see_manage_overview_all?: boolean | null;
  see_manage_overview_team?: boolean | null;
  see_manage_reasons?: boolean | null;
  see_manage_work_shifts_all?: boolean | null;
  see_manage_work_shifts_team?: boolean | null;
  edit_manage_work_shifts_all?: boolean | null;
  edit_manage_work_shifts_team?: boolean | null;
  authorise_bookings_all?: boolean | null;
  authorise_bookings_team?: boolean | null;
  authorise_bookings_own?: boolean | null;
}

export interface AbsenceSecondaryActorPermissions {
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  role_name: string | null;
  role_display_name: string | null;
  role_tier: AbsenceSecondaryRoleTier;
  defaults: AbsenceSecondaryPermissionMap;
  effective: AbsenceSecondaryPermissionMap;
  overrides: Record<AbsenceSecondaryPermissionKey, boolean | null>;
  has_exception_row: boolean;
}

export interface AbsenceSecondaryScopeTarget {
  profile_id: string;
  team_id: string | null;
}

export interface UpsertAbsenceSecondaryExceptionInput {
  profile_id: string;
  updates: Partial<Record<AbsenceSecondaryPermissionKey, boolean | null>>;
  actor_id?: string | null;
}

export interface AbsenceSecondaryActorContextOverride {
  role?: RoleShape | null;
  team_id?: string | null;
  team_name?: string | null;
}

export function resolveAbsenceSecondaryRoleTier(role: RoleShape | null | undefined): AbsenceSecondaryRoleTier {
  if (!role) return 'employee';
  if (role.is_super_admin || role.name === 'admin' || role.role_class === 'admin') return 'admin';
  if (role.role_class === 'manager' || role.is_manager_admin) return 'manager';
  if ((role.name || '').toLowerCase() === 'supervisor') return 'supervisor';
  return 'employee';
}

function resolveAbsenceSecondaryRoleTierFromLevel(level: PermissionAccessLevel): AbsenceSecondaryRoleTier {
  if (level >= 5) return 'admin';
  if (level >= 4) return 'manager';
  if (level >= 3) return 'supervisor';
  return 'employee';
}

function normalizeExceptionOverrides(
  row: AbsenceSecondaryPermissionExceptionRecord | null | undefined
): Record<AbsenceSecondaryPermissionKey, boolean | null> {
  const normalized = createNullAbsenceSecondaryOverrideRecord();
  if (!row) return normalized;

  ABSENCE_SECONDARY_PERMISSION_KEYS.forEach((key) => {
    const value = row[key];
    normalized[key] = typeof value === 'boolean' ? value : null;
  });

  return normalized;
}

function sanitizeExceptionPatch(
  patch: Partial<Record<AbsenceSecondaryPermissionKey, boolean | null>>
): Partial<Record<AbsenceSecondaryPermissionKey, boolean | null>> {
  const sanitized: Partial<Record<AbsenceSecondaryPermissionKey, boolean | null>> = {};

  ABSENCE_SECONDARY_PERMISSION_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) {
      return;
    }
    const value = patch[key];
    if (typeof value === 'boolean' || value === null) {
      sanitized[key] = value;
    }
  });

  return sanitized;
}

export function canActorUseScopedAbsencePermission(params: {
  actorPermissions: Pick<AbsenceSecondaryActorPermissions, 'effective' | 'user_id' | 'team_id'>;
  target: AbsenceSecondaryScopeTarget;
  allKey: AbsenceSecondaryPermissionKey;
  teamKey: AbsenceSecondaryPermissionKey;
  ownKey: AbsenceSecondaryPermissionKey;
}): boolean {
  if (params.actorPermissions.effective[params.allKey]) return true;

  if (
    params.target.profile_id === params.actorPermissions.user_id &&
    params.actorPermissions.effective[params.ownKey]
  ) {
    return true;
  }

  return Boolean(
    params.actorPermissions.team_id &&
      params.target.team_id &&
      params.actorPermissions.team_id === params.target.team_id &&
      params.actorPermissions.effective[params.teamKey]
  );
}

async function fetchProfileWithRole(profileId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select(
      'id, full_name, employee_id, team_id, role_id, team:org_teams!profiles_team_id_fkey(id, name), role:roles(name, display_name, role_class, is_manager_admin, is_super_admin)'
    )
    .eq('id', profileId)
    .single();

  if (error) throw error;
  return data as ProfileWithRoleRow;
}

export async function getActorAbsenceSecondaryPermissions(
  profileId: string,
  contextOverride?: AbsenceSecondaryActorContextOverride
): Promise<AbsenceSecondaryActorPermissions> {
  const [profile, exceptionRow] = await Promise.all([
    fetchProfileWithRole(profileId),
    (createAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data: ExceptionRow | null; error: { message: string } | null }>;
          };
        };
      };
    })
      .from('absence_secondary_permission_exceptions')
      .select(
        'profile_id, see_bookings_all, see_bookings_team, see_bookings_own, add_edit_bookings_all, add_edit_bookings_team, add_edit_bookings_own, see_allowances_all, see_allowances_team, add_edit_allowances_all, add_edit_allowances_team, see_manage_overview_all, see_manage_overview_team, see_manage_reasons, see_manage_work_shifts_all, see_manage_work_shifts_team, edit_manage_work_shifts_all, edit_manage_work_shifts_team, authorise_bookings_all, authorise_bookings_team, authorise_bookings_own'
      )
      .eq('profile_id', profileId)
      .maybeSingle(),
  ]);

  if (exceptionRow.error) throw new Error(exceptionRow.error.message || 'Failed to load absence secondary exceptions');

  const resolvedRole = contextOverride?.role ?? profile.role;
  const resolvedTeamId =
    contextOverride && Object.prototype.hasOwnProperty.call(contextOverride, 'team_id')
      ? (contextOverride.team_id ?? null)
      : (profile.team_id ?? null);
  const resolvedTeamName =
    contextOverride && Object.prototype.hasOwnProperty.call(contextOverride, 'team_name')
      ? (contextOverride.team_name ?? null)
      : (profile.team?.name ?? null);

  const permissionLevels = await getPermissionLevelsForUser(
    profile.id,
    profile.role ? undefined : profile.role_id,
    createAdminClient(),
    resolvedTeamId
  );
  const roleTier =
    permissionLevels.absence > 0
      ? resolveAbsenceSecondaryRoleTierFromLevel(permissionLevels.absence)
      : resolveAbsenceSecondaryRoleTier(resolvedRole);
  const defaults = getAbsenceSecondaryDefaultMap(roleTier);
  const overrides = normalizeExceptionOverrides(exceptionRow.data || undefined);
  const effective = applyAbsenceSecondaryOverrides(defaults, overrides);

  return {
    user_id: profile.id,
    team_id: resolvedTeamId,
    team_name: resolvedTeamName,
    role_name: resolvedRole?.name || null,
    role_display_name: resolvedRole?.display_name || null,
    role_tier: roleTier,
    defaults,
    overrides,
    effective,
    has_exception_row: Boolean(exceptionRow.data?.profile_id),
  };
}

export async function getAbsenceSecondaryExceptionMatrix(): Promise<AbsenceSecondaryExceptionMatrixResponse> {
  const admin = createAdminClient();
  const { data: exceptionsData, error: exceptionsError } = await (admin as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        order: (column: string, options?: { ascending?: boolean }) => Promise<{
          data: ExceptionRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  })
    .from('absence_secondary_permission_exceptions')
    .select(
      'profile_id, see_bookings_all, see_bookings_team, see_bookings_own, add_edit_bookings_all, add_edit_bookings_team, add_edit_bookings_own, see_allowances_all, see_allowances_team, add_edit_allowances_all, add_edit_allowances_team, see_manage_overview_all, see_manage_overview_team, see_manage_reasons, see_manage_work_shifts_all, see_manage_work_shifts_team, edit_manage_work_shifts_all, edit_manage_work_shifts_team, authorise_bookings_all, authorise_bookings_team, authorise_bookings_own, created_at, updated_at'
    )
    .order('updated_at', { ascending: false });

  if (exceptionsError) throw new Error(exceptionsError.message || 'Failed to load absence exceptions');

  const exceptionRows = exceptionsData || [];
  if (exceptionRows.length === 0) {
    return {
      headers: ABSENCE_SECONDARY_PERMISSION_HEADERS,
      rows: [],
    };
  }

  const profileIds = exceptionRows.map((row) => row.profile_id);
  const { data: profilesData, error: profilesError } = await admin
    .from('profiles')
    .select(
      'id, full_name, employee_id, team_id, role_id, team:org_teams!profiles_team_id_fkey(id, name), role:roles(name, display_name, role_class, is_manager_admin, is_super_admin)'
    )
    .in('id', profileIds);

  if (profilesError) throw profilesError;

  const profileById = new Map<string, ProfileWithRoleRow>();
  filterHiddenSystemTestAccounts((profilesData || []) as unknown as ProfileWithRoleRow[]).forEach((profile) => {
    profileById.set(profile.id, profile);
  });

  const rows = exceptionRows
    .map((row) => {
      const profile = profileById.get(row.profile_id);
      if (!profile) return null;

      const roleTier = resolveAbsenceSecondaryRoleTier(profile.role);
      const defaults = getAbsenceSecondaryDefaultMap(roleTier);
      const overrides = normalizeExceptionOverrides(row);
      const effective = applyAbsenceSecondaryOverrides(defaults, overrides);

      return {
        profile_id: profile.id,
        full_name: profile.full_name || 'Unknown user',
        employee_id: profile.employee_id || null,
        role_name: profile.role?.name || null,
        role_display_name: profile.role?.display_name || null,
        role_tier: roleTier,
        team_id: profile.team_id || null,
        team_name: profile.team?.name || null,
        has_exception_row: true,
        defaults,
        effective,
        overrides,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return {
    headers: ABSENCE_SECONDARY_PERMISSION_HEADERS,
    rows,
  };
}

export async function addAbsenceSecondaryExceptionRow(profileId: string, actorId?: string | null): Promise<void> {
  const admin = createAdminClient();
  const payload: Record<string, unknown> = {
    profile_id: profileId,
    updated_by: actorId || null,
  };
  if (actorId) {
    payload.created_by = actorId;
  }

  const { error } = await (admin as unknown as {
    from: (table: string) => {
      upsert: (
        values: Record<string, unknown>,
        options?: { onConflict?: string }
      ) => Promise<{ error: { message: string } | null }>;
    };
  })
    .from('absence_secondary_permission_exceptions')
    .upsert(payload, { onConflict: 'profile_id' });

  if (error) {
    throw new Error(error.message || 'Failed to create absence exception row');
  }
}

export async function upsertAbsenceSecondaryException(input: UpsertAbsenceSecondaryExceptionInput): Promise<void> {
  const sanitized = sanitizeExceptionPatch(input.updates);
  const hasValues = Object.keys(sanitized).length > 0;
  if (!hasValues) return;

  const payload: Record<string, unknown> = {
    profile_id: input.profile_id,
    ...sanitized,
    updated_by: input.actor_id || null,
  };
  if (input.actor_id) {
    payload.created_by = input.actor_id;
  }

  const admin = createAdminClient();
  const { error } = await (admin as unknown as {
    from: (table: string) => {
      upsert: (
        values: Record<string, unknown>,
        options?: { onConflict?: string }
      ) => Promise<{ error: { message: string } | null }>;
    };
  })
    .from('absence_secondary_permission_exceptions')
    .upsert(payload, { onConflict: 'profile_id' });

  if (error) throw new Error(error.message || 'Failed to update absence exception row');
}

export async function deleteAbsenceSecondaryExceptionRow(profileId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await (admin as unknown as {
    from: (table: string) => {
      delete: () => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  })
    .from('absence_secondary_permission_exceptions')
    .delete()
    .eq('profile_id', profileId);

  if (error) throw new Error(error.message || 'Failed to delete absence exception row');
}

