import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHiddenSystemTestAccountIds } from '@/lib/server/system-test-accounts';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import { hasRoleFullAccess } from '@/lib/utils/role-access';
import {
  getModuleEnforcedMinimumAccessLevel,
  getUsablePermissionAccessLevel,
  isPermissionLevelAllowedForModule,
  moduleRequiresFullAccessRole,
} from '@/lib/config/permission-access-rules';
import {
  ALL_MODULES,
  createEmptyModulePermissionRecord,
  MODULE_CSS_VAR,
  MODULE_DESCRIPTIONS,
  MODULE_DISPLAY_NAMES,
  MODULE_SHORT_NAMES,
  type ModuleName,
  type PermissionAccessLevel,
  type PermissionModuleMatrixColumn,
  type PermissionTierRole,
  type UserPermissionAssignableRole,
  type TeamPermissionMatrixRow,
  type UserPermissionTeamDefaultRow,
  type UserPermissionMatrixRow,
} from '@/types/roles';

type SupabaseAdminClient = SupabaseClient;

type RoleRow = {
  id: string;
  name: string;
  display_name: string;
  role_class: 'admin' | 'manager' | 'employee';
  hierarchy_rank: number | null;
  is_super_admin: boolean;
  is_manager_admin: boolean;
};

type PermissionModuleRow = {
  module_name: ModuleName;
  minimum_role_id: string;
  requires_sensitive_pin?: boolean | null;
  sort_order: number;
};

type TeamPermissionRow = {
  team_id: string;
  module_name: ModuleName;
  enabled: boolean;
};

type TeamRow = {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
};

type UserModulePermissionRow = {
  user_id: string;
  module_name: ModuleName;
  access_level: number;
};

const UNIVERSAL_PERMISSION_MODULES = new Set<ModuleName>(['reminders']);
const UNIVERSAL_PERMISSION_ACCESS_LEVEL: PermissionAccessLevel = 5;

type ProfilePermissionRow = {
  id: string;
  full_name: string | null;
  phone_number?: string | null;
  employee_id: string | null;
  team_id: string | null;
  line_manager_id?: string | null;
  role_id: string | null;
  is_placeholder?: boolean | null;
  role?: RoleRow | RoleRow[] | null;
  team?: { id?: string | null; name?: string | null } | Array<{ id?: string | null; name?: string | null }> | null;
};

export class InvalidPermissionLevelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPermissionLevelError';
  }
}

export function buildTeamPermissionRecord(
  modules: Array<Pick<PermissionModuleMatrixColumn, 'module_name'>>,
  enabledMap?: Map<ModuleName, boolean>
): Record<ModuleName, boolean> {
  const permissionRecord = createEmptyModulePermissionRecord();

  modules.forEach((module) => {
    permissionRecord[module.module_name] = enabledMap?.get(module.module_name) ?? false;
  });

  return permissionRecord;
}

export function normalizePermissionAccessLevel(value: number | null | undefined): PermissionAccessLevel {
  if (value === 5) return 5;
  if (value === 4) return 4;
  if (value === 3) return 3;
  if (value === 2) return 2;
  if (value === 1) return 1;
  return 0;
}

export function createEmptyModuleLevelRecord(): Record<ModuleName, PermissionAccessLevel> {
  return ALL_MODULES.reduce((acc, moduleName) => {
    acc[moduleName] = 0;
    return acc;
  }, {} as Record<ModuleName, PermissionAccessLevel>);
}

function applyUniversalModuleLevels(
  levels: Record<ModuleName, PermissionAccessLevel>
): Record<ModuleName, PermissionAccessLevel> {
  UNIVERSAL_PERMISSION_MODULES.forEach((moduleName) => {
    levels[moduleName] = UNIVERSAL_PERMISSION_ACCESS_LEVEL;
  });

  return levels;
}

export function getAccessLevelForRole(
  role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin' | 'hierarchy_rank'> | null | undefined
): PermissionAccessLevel {
  if (!role) return 0;
  if (isFullAccessRole(role)) return 5;
  return normalizePermissionAccessLevel(role.hierarchy_rank || 0);
}

export function buildUserPermissionLevelRecord(
  modules: Array<Pick<PermissionModuleMatrixColumn, 'module_name'>>,
  levelMap?: Map<ModuleName, number>
): Record<ModuleName, PermissionAccessLevel> {
  const permissionRecord = createEmptyModuleLevelRecord();

  modules.forEach((module) => {
    permissionRecord[module.module_name] = normalizePermissionAccessLevel(levelMap?.get(module.module_name));
  });

  return applyUniversalModuleLevels(permissionRecord);
}

export function isFullAccessRole(role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin'>): boolean {
  return hasRoleFullAccess(role);
}

export function getAdjacentTierRole(
  roles: PermissionTierRole[],
  currentRoleId: string,
  direction: 'left' | 'right'
): PermissionTierRole | null {
  const currentIndex = roles.findIndex((role) => role.id === currentRoleId);
  if (currentIndex === -1) {
    return null;
  }

  const nextIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
  return roles[nextIndex] || null;
}

export function resolveModulesForRoleRank(params: {
  role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin' | 'hierarchy_rank'>;
  modules: PermissionModuleMatrixColumn[];
  enabledByModule: Map<ModuleName, boolean>;
}): Set<ModuleName> {
  if (isFullAccessRole(params.role)) {
    return new Set<ModuleName>(ALL_MODULES);
  }

  if (typeof params.role.hierarchy_rank !== 'number') {
    return new Set<ModuleName>();
  }

  const enabledModules = new Set<ModuleName>();
  params.modules.forEach((module) => {
    if (
      (params.enabledByModule.get(module.module_name) ?? false) &&
      params.role.hierarchy_rank! >= module.enforced_minimum_access_level &&
      !module.requires_full_access_role
    ) {
      enabledModules.add(module.module_name);
    }
  });

  return enabledModules;
}

export function resolveModuleLevelForRoleRank(params: {
  role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin' | 'hierarchy_rank'>;
  module: PermissionModuleMatrixColumn;
  enabled: boolean;
}): PermissionAccessLevel {
  const roleLevel = getAccessLevelForRole(params.role);
  if (roleLevel === 5) return 5;
  if (!params.enabled || typeof params.role.hierarchy_rank !== 'number') return 0;
  if (params.module.requires_full_access_role) return 0;
  if (params.role.hierarchy_rank < params.module.enforced_minimum_access_level) return 0;
  return roleLevel;
}

export function isMissingTeamPermissionSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';

  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('permission_modules') ||
    message.includes('team_module_permissions') ||
    message.includes('user_module_permissions') ||
    message.includes('hierarchy_rank') ||
    message.includes('minimum_role_id') ||
    message.includes('does not exist')
  );
}

export async function getPermissionTierRoles(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<PermissionTierRole[]> {
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin')
    .not('hierarchy_rank', 'is', null)
    .order('hierarchy_rank', { ascending: true })
    .order('display_name', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data || []) as RoleRow[])
    .filter((role) => !role.is_super_admin && role.name !== 'admin')
    .map((role) => ({
      id: role.id,
      name: role.name,
      display_name: role.display_name,
      role_class: role.role_class,
      hierarchy_rank: role.hierarchy_rank || 0,
      is_super_admin: role.is_super_admin,
      is_manager_admin: role.is_manager_admin,
    }));
}

export async function ensureTeamPermissionRows(
  teamId: string,
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<void> {
  const [{ data: modules, error: modulesError }, { data: existingRows, error: existingError }] =
    await Promise.all([
      supabaseAdmin.from('permission_modules').select('module_name'),
      supabaseAdmin.from('team_module_permissions').select('module_name').eq('team_id', teamId),
    ]);

  if (modulesError) {
    throw modulesError;
  }
  if (existingError) {
    throw existingError;
  }

  const existing = new Set(
    ((existingRows || []) as Array<{ module_name: ModuleName }>).map((row) => row.module_name)
  );
  const missingRows = ((modules || []) as Array<{ module_name: ModuleName }>)
    .filter((row) => !existing.has(row.module_name))
    .map((row) => ({
      team_id: teamId,
      module_name: row.module_name,
      enabled: false,
    }));

  if (!missingRows.length) {
    return;
  }

  const { error } = await supabaseAdmin
    .from('team_module_permissions')
    .upsert(missingRows, { onConflict: 'team_id,module_name' });

  if (error) {
    throw error;
  }
}

export async function getPermissionModules(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<PermissionModuleMatrixColumn[]> {
  const roles = await getPermissionTierRoles(supabaseAdmin);
  return getPermissionModulesForRoles(roles, supabaseAdmin);
}

async function getPermissionModulesForRoles(
  roles: PermissionTierRole[],
  supabaseAdmin: SupabaseAdminClient
): Promise<PermissionModuleMatrixColumn[]> {
  const modulesResult = await supabaseAdmin
    .from('permission_modules')
    .select('module_name, minimum_role_id, requires_sensitive_pin, sort_order')
    .order('sort_order', { ascending: true });

  if (modulesResult.error) {
    throw modulesResult.error;
  }

  const rolesById = new Map(roles.map((role) => [role.id, role]));

  return ((modulesResult.data || []) as PermissionModuleRow[])
    .filter((row) => ALL_MODULES.includes(row.module_name))
    .map((row) => {
      const role = rolesById.get(row.minimum_role_id);
      if (!role) {
        throw new Error(`Permission module ${row.module_name} points to an unknown tier role.`);
      }

      const enforcedMinimum = getModuleEnforcedMinimumAccessLevel(row.module_name, role.hierarchy_rank);

      return {
        module_name: row.module_name,
        display_name: MODULE_DISPLAY_NAMES[row.module_name],
        short_name: MODULE_SHORT_NAMES[row.module_name],
        description: MODULE_DESCRIPTIONS[row.module_name],
        color_var: MODULE_CSS_VAR[row.module_name],
        minimum_role_id: row.minimum_role_id,
        minimum_role_name: role.display_name,
        minimum_hierarchy_rank: role.hierarchy_rank,
        enforced_minimum_access_level: enforcedMinimum,
        requires_full_access_role: moduleRequiresFullAccessRole(row.module_name),
        requires_sensitive_pin: row.requires_sensitive_pin === true,
        sort_order: row.sort_order,
      };
    });
}

export async function getTeamPermissionMatrix(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<{
  roles: PermissionTierRole[];
  modules: PermissionModuleMatrixColumn[];
  teams: TeamPermissionMatrixRow[];
}> {
  const [roles, teamsResult, permissionsResult] = await Promise.all([
    getPermissionTierRoles(supabaseAdmin),
    supabaseAdmin
      .from('org_teams')
      .select('id, name, code, active')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled'),
  ]);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);

  if (teamsResult.error) {
    throw teamsResult.error;
  }
  if (permissionsResult.error) {
    throw permissionsResult.error;
  }

  const permissionRows = (permissionsResult.data || []) as TeamPermissionRow[];
  const enabledByTeam = new Map<string, Map<ModuleName, boolean>>();

  permissionRows.forEach((row) => {
    if (!enabledByTeam.has(row.team_id)) {
      enabledByTeam.set(row.team_id, new Map<ModuleName, boolean>());
    }
    enabledByTeam.get(row.team_id)!.set(row.module_name, !!row.enabled);
  });

  const teams = ((teamsResult.data || []) as TeamRow[])
    .filter((team) => team.active)
    .map((team) => {
      const enabledMap = enabledByTeam.get(team.id) || new Map<ModuleName, boolean>();

      return {
        id: team.id,
        name: team.name,
        code: team.code,
        active: team.active,
        permissions: buildTeamPermissionRecord(modules, enabledMap),
      };
    });

  return { roles, modules, teams };
}

function getProfileRole(
  profile: Pick<ProfilePermissionRow, 'role'> & { role_id?: string | null },
  rolesById?: Map<string, RoleRow>
): RoleRow | null {
  if (Array.isArray(profile.role)) {
    return profile.role[0] || null;
  }
  if (profile.role) {
    return profile.role;
  }
  return profile.role_id && rolesById ? rolesById.get(profile.role_id) || null : null;
}

function getProfileTeamName(profile: Pick<ProfilePermissionRow, 'team'>): string | null {
  if (Array.isArray(profile.team)) {
    return profile.team[0]?.name || null;
  }
  return profile.team?.name || null;
}

function isDeletedProfile(profile: Pick<ProfilePermissionRow, 'full_name'>): boolean {
  return Boolean(profile.full_name?.includes('(Deleted User)'));
}

function buildUserOverrideMap(permissionRows: UserModulePermissionRow[]): Map<string, Map<ModuleName, PermissionAccessLevel>> {
  const levelsByUser = new Map<string, Map<ModuleName, PermissionAccessLevel>>();

  permissionRows.forEach((row) => {
    if (!levelsByUser.has(row.user_id)) {
      levelsByUser.set(row.user_id, new Map<ModuleName, PermissionAccessLevel>());
    }

    levelsByUser.get(row.user_id)!.set(row.module_name, normalizePermissionAccessLevel(row.access_level));
  });

  return levelsByUser;
}

async function fetchUserModulePermissionRows(
  supabaseAdmin: SupabaseAdminClient,
  params: {
    userIds?: string[];
    moduleNames?: ModuleName[];
  } = {}
): Promise<UserModulePermissionRow[]> {
  if (params.userIds && params.userIds.length === 0) {
    return [];
  }
  if (params.moduleNames && params.moduleNames.length === 0) {
    return [];
  }

  const pageSize = 1000;
  const rows: UserModulePermissionRow[] = [];
  let from = 0;

  while (true) {
    let query = supabaseAdmin
      .from('user_module_permissions')
      .select('user_id, module_name, access_level')
      .order('user_id', { ascending: true })
      .order('module_name', { ascending: true })
      .range(from, from + pageSize - 1);

    if (params.userIds) {
      query = query.in('user_id', params.userIds);
    }
    if (params.moduleNames) {
      query = query.in('module_name', params.moduleNames);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const pageRows = (data || []) as UserModulePermissionRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

function getInheritedLevelsForProfile(params: {
  profile: Pick<ProfilePermissionRow, 'team_id' | 'role' | 'role_id'>;
  role: RoleRow | null;
  modules: PermissionModuleMatrixColumn[];
  enabledByTeam: Map<string, Map<ModuleName, boolean>>;
}): Record<ModuleName, PermissionAccessLevel> {
  const levels = createEmptyModuleLevelRecord();
  if (!params.role) return applyUniversalModuleLevels(levels);

  if (isFullAccessRole(params.role)) {
    return ALL_MODULES.reduce((acc, moduleName) => {
      acc[moduleName] = 5;
      return acc;
    }, {} as Record<ModuleName, PermissionAccessLevel>);
  }

  params.modules.forEach((module) => {
    const enabled = params.profile.team_id
      ? params.enabledByTeam.get(params.profile.team_id)?.get(module.module_name) ?? false
      : false;
    levels[module.module_name] = resolveModuleLevelForRoleRank({
      role: params.role!,
      module,
      enabled,
    });
  });

  return applyUniversalModuleLevels(levels);
}

function getEffectiveLevelsForProfile(params: {
  profile: Pick<ProfilePermissionRow, 'id' | 'team_id' | 'role' | 'role_id'>;
  role: RoleRow | null;
  modules: PermissionModuleMatrixColumn[];
  inheritedLevels: Record<ModuleName, PermissionAccessLevel>;
  overrideLevels?: Map<ModuleName, PermissionAccessLevel>;
}): Record<ModuleName, PermissionAccessLevel> {
  if (params.role && isFullAccessRole(params.role)) {
    return ALL_MODULES.reduce((acc, moduleName) => {
      acc[moduleName] = 5;
      return acc;
    }, {} as Record<ModuleName, PermissionAccessLevel>);
  }

  const levels = { ...params.inheritedLevels };
  params.modules.forEach((module) => {
    const override = params.overrideLevels?.get(module.module_name);
    if (override !== undefined) {
      levels[module.module_name] = getUsablePermissionAccessLevel(module, override, {
        hasFullAccessRole: false,
      });
    }
  });

  return applyUniversalModuleLevels(levels);
}

export async function getUserPermissionMatrix(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<{
  roles: PermissionTierRole[];
  modules: PermissionModuleMatrixColumn[];
  teams: UserPermissionTeamDefaultRow[];
  assignableRoles: UserPermissionAssignableRole[];
  users: UserPermissionMatrixRow[];
}> {
  const [roles, assignableRolesResult, teamsResult, profilesResult, teamPermissionsResult] = await Promise.all([
    getPermissionTierRoles(supabaseAdmin),
    supabaseAdmin
      .from('roles')
      .select('id, name, display_name, role_class, is_super_admin, is_manager_admin')
      .order('is_super_admin', { ascending: false })
      .order('is_manager_admin', { ascending: false })
      .order('display_name', { ascending: true }),
    supabaseAdmin
      .from('org_teams')
      .select('id, name, code, active')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('profiles')
      .select(
        'id, full_name, phone_number, employee_id, team_id, line_manager_id, role_id, is_placeholder, team:org_teams!profiles_team_id_fkey(id, name), role:roles(id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin)'
      )
      .order('full_name', { ascending: true }),
    supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled'),
  ]);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);

  if (assignableRolesResult.error) throw assignableRolesResult.error;
  if (teamsResult.error) throw teamsResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (teamPermissionsResult.error) throw teamPermissionsResult.error;

  const typedProfiles = (profilesResult.data || []) as unknown as ProfilePermissionRow[];
  const hiddenIds = await getHiddenSystemTestAccountIds(supabaseAdmin as Parameters<typeof getHiddenSystemTestAccountIds>[0]);
  const visibleProfiles = typedProfiles.filter(
    (profile) => !hiddenIds.has(profile.id) && !isHiddenSystemTestAccountProfile(profile) && !isDeletedProfile(profile)
  );
  const userPermissionRows = await fetchUserModulePermissionRows(supabaseAdmin, {
    userIds: visibleProfiles.map((profile) => profile.id),
  });
  const levelsByUser = buildUserOverrideMap(userPermissionRows);
  const permissionRows = (teamPermissionsResult.data || []) as TeamPermissionRow[];
  const enabledByTeam = new Map<string, Map<ModuleName, boolean>>();
  permissionRows.forEach((row) => {
    if (!enabledByTeam.has(row.team_id)) {
      enabledByTeam.set(row.team_id, new Map<ModuleName, boolean>());
    }
    enabledByTeam.get(row.team_id)!.set(row.module_name, row.enabled);
  });
  const activeTeams = ((teamsResult.data || []) as TeamRow[]).filter((team) => team.active);
  const assignableRoles = ((assignableRolesResult.data || []) as Array<{
    id: string;
    name: string;
    display_name: string;
    role_class: RoleRow['role_class'];
  }>).map((role) => ({
    id: role.id,
    name: role.name,
    display_name: role.display_name,
    role_class: role.role_class,
  }));
  const teams = activeTeams.map((team) => ({
    id: team.id,
    name: team.name,
    permissions: buildTeamPermissionRecord(modules, enabledByTeam.get(team.id)),
  }));

  const users = visibleProfiles.map((profile) => {
    const role = getProfileRole(profile);
    const inheritedPermissions = getInheritedLevelsForProfile({
      profile,
      role,
      modules,
      enabledByTeam,
    });
    const permissions = getEffectiveLevelsForProfile({
      profile,
      role,
      modules,
      inheritedLevels: inheritedPermissions,
      overrideLevels: levelsByUser.get(profile.id),
    });

    return {
      id: profile.id,
      full_name: profile.full_name,
      email: null,
      phone_number: profile.phone_number || null,
      employee_id: profile.employee_id,
      team_id: profile.team_id,
      line_manager_id: profile.line_manager_id || null,
      team_name: getProfileTeamName(profile),
      role_id: profile.role_id,
      role_name: role?.name || null,
      role_display_name: role?.display_name || null,
      role_class: role?.role_class || null,
      role_hierarchy_rank: role?.hierarchy_rank || null,
      is_super_admin: role?.is_super_admin === true,
      is_manager_admin: role?.is_manager_admin === true,
      is_locked_admin: role ? isFullAccessRole(role) : false,
      permissions,
      inherited_permissions: inheritedPermissions,
    } satisfies UserPermissionMatrixRow;
  });

  return { roles, modules, teams, assignableRoles, users };
}

export async function updateTeamModulePermissions(
  supabaseAdmin: SupabaseAdminClient,
  teamId: string,
  permissions: Array<{ module_name: ModuleName; enabled: boolean }>
): Promise<void> {
  if (!permissions.length) {
    return;
  }

  const rows = permissions.map((permission) => ({
    team_id: teamId,
    module_name: permission.module_name,
    enabled: permission.enabled,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('team_module_permissions')
    .upsert(rows, { onConflict: 'team_id,module_name' });

  if (error) {
    throw error;
  }
}

export async function updateTeamModulePermissionDefaults(
  supabaseAdmin: SupabaseAdminClient,
  updates: Array<{ team_id: string; module_name: ModuleName; enabled: boolean }>,
  actorUserId?: string | null
): Promise<void> {
  if (!updates.length) {
    return;
  }

  const modules = await getPermissionModules(supabaseAdmin);
  const modulesByName = new Map(modules.map((module) => [module.module_name, module]));
  const teamIds = Array.from(new Set(updates.map((update) => update.team_id)));
  const moduleNames = Array.from(new Set(updates.map((update) => update.module_name)));

  const { data: existingDefaults, error: defaultsError } = await supabaseAdmin
    .from('team_module_permissions')
    .select('team_id, module_name, enabled')
    .in('team_id', teamIds)
    .in('module_name', moduleNames);

  if (defaultsError) {
    throw defaultsError;
  }

  const existingByKey = new Map<string, TeamPermissionRow>();
  ((existingDefaults || []) as TeamPermissionRow[]).forEach((row) => {
    existingByKey.set(`${row.team_id}:${row.module_name}`, row);
  });

  const defaultRows = updates.map((update) => ({
    team_id: update.team_id,
    module_name: update.module_name,
    enabled: update.enabled,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertDefaultsError } = await supabaseAdmin
    .from('team_module_permissions')
    .upsert(defaultRows, { onConflict: 'team_id,module_name' });

  if (upsertDefaultsError) {
    throw upsertDefaultsError;
  }

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, team_id, role:roles(id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin)')
    .in('team_id', teamIds);

  if (profilesError) {
    throw profilesError;
  }

  const candidateProfiles = ((profiles || []) as unknown as ProfilePermissionRow[]).filter((profile) => {
    const role = getProfileRole(profile);
    return role ? !isFullAccessRole(role) : true;
  });
  const candidateUserIds = candidateProfiles.map((profile) => profile.id);

  const userPermissionRows = await fetchUserModulePermissionRows(supabaseAdmin, {
    userIds: candidateUserIds,
    moduleNames,
  });

  const userPermissionByKey = new Map<string, UserModulePermissionRow>();
  userPermissionRows.forEach((row) => {
    userPermissionByKey.set(`${row.user_id}:${row.module_name}`, row);
  });

  const cascadeRows: Array<{
    user_id: string;
    module_name: ModuleName;
    access_level: PermissionAccessLevel;
    updated_by: string | null;
    updated_at: string;
  }> = [];

  updates.forEach((update) => {
    const existingDefault = existingByKey.get(`${update.team_id}:${update.module_name}`);
    const oldEnabled = existingDefault?.enabled ?? false;
    const nextEnabled = update.enabled;
    const permissionModule = modulesByName.get(update.module_name);
    if (!permissionModule) return;

    candidateProfiles
      .filter((profile) => profile.team_id === update.team_id)
      .forEach((profile) => {
        const role = getProfileRole(profile);
        if (!role) return;

        const oldDefault = resolveModuleLevelForRoleRank({
          role,
          module: permissionModule,
          enabled: oldEnabled,
        });
        const nextLevel = resolveModuleLevelForRoleRank({
          role,
          module: permissionModule,
          enabled: nextEnabled,
        });
        const existingUserLevel = userPermissionByKey.get(`${profile.id}:${update.module_name}`);
        const currentLevel = existingUserLevel
          ? normalizePermissionAccessLevel(existingUserLevel.access_level)
          : oldDefault;

        if (currentLevel !== oldDefault) return;

        cascadeRows.push({
          user_id: profile.id,
          module_name: update.module_name,
          access_level: nextLevel,
          updated_by: actorUserId || null,
          updated_at: new Date().toISOString(),
        });
      });
  });

  if (!cascadeRows.length) {
    return;
  }

  const { error: cascadeError } = await supabaseAdmin
    .from('user_module_permissions')
    .upsert(cascadeRows, { onConflict: 'user_id,module_name' });

  if (cascadeError) {
    throw cascadeError;
  }
}

export async function updateUserModulePermissionLevels(
  supabaseAdmin: SupabaseAdminClient,
  updates: Array<{ user_id: string; module_name: ModuleName; access_level: PermissionAccessLevel }>,
  actorUserId?: string | null
): Promise<void> {
  if (!updates.length) {
    return;
  }

  const targetUserIds = Array.from(new Set(updates.map((update) => update.user_id)));
  const { data: targetProfiles, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('id, role:roles(id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin)')
    .in('id', targetUserIds);

  if (targetError) {
    throw targetError;
  }

  const profilesById = new Map(
    ((targetProfiles || []) as unknown as ProfilePermissionRow[]).map((profile) => [profile.id, profile])
  );
  const lockedAdminIds = new Set(
    Array.from(profilesById.values())
      .filter((profile) => {
        const role = getProfileRole(profile);
        return role ? isFullAccessRole(role) : false;
      })
      .map((profile) => profile.id)
  );

  const invalidTargetId = targetUserIds.find((userId) => !profilesById.has(userId));
  if (invalidTargetId) {
    throw new Error(`User ${invalidTargetId} was not found.`);
  }

  if (updates.some((update) => lockedAdminIds.has(update.user_id))) {
    throw new Error('Admin users always have Level 5 access. Change their job role before editing module levels.');
  }

  const modules = await getPermissionModules(supabaseAdmin);
  const modulesByName = new Map(modules.map((module) => [module.module_name, module]));
  updates.forEach((update) => {
    const permissionModule = modulesByName.get(update.module_name);
    if (!permissionModule) {
      throw new InvalidPermissionLevelError(`Module ${update.module_name} is not configured for the permission matrix.`);
    }

    const profile = profilesById.get(update.user_id);
    const role = profile ? getProfileRole(profile) : null;
    if (!isPermissionLevelAllowedForModule(permissionModule, update.access_level, {
      hasFullAccessRole: role ? isFullAccessRole(role) : false,
    })) {
      const reason = permissionModule.requires_full_access_role
        ? 'it requires an Admin/Super Admin job role'
        : `use Level ${permissionModule.enforced_minimum_access_level} or higher`;
      throw new InvalidPermissionLevelError(
        `${permissionModule.display_name} cannot be set to Level ${update.access_level}; ${reason}.`
      );
    }
  });

  const rows = updates.map((update) => ({
    user_id: update.user_id,
    module_name: update.module_name,
    access_level: normalizePermissionAccessLevel(update.access_level),
    updated_by: actorUserId || null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('user_module_permissions')
    .upsert(rows, { onConflict: 'user_id,module_name' });

  if (error) {
    throw error;
  }
}

export async function shiftPermissionModuleTier(
  supabaseAdmin: SupabaseAdminClient,
  moduleName: ModuleName,
  direction: 'left' | 'right'
): Promise<PermissionModuleMatrixColumn> {
  const roles = await getPermissionTierRoles(supabaseAdmin);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);

  const targetModule = modules.find((entry) => entry.module_name === moduleName);
  if (!targetModule) {
    throw new Error(`Module ${moduleName} is not configured for the permission matrix.`);
  }

  const nextRole = getAdjacentTierRole(roles, targetModule.minimum_role_id, direction);
  if (!roles.find((role) => role.id === targetModule.minimum_role_id)) {
    throw new Error(`Module ${moduleName} is assigned to an unknown tier role.`);
  }
  if (!nextRole) {
    throw new Error(`Module ${moduleName} cannot move ${direction} any further.`);
  }

  const { error } = await supabaseAdmin
    .from('permission_modules')
    .update({
      minimum_role_id: nextRole.id,
      updated_at: new Date().toISOString(),
    })
    .eq('module_name', moduleName);

  if (error) {
    throw error;
  }

  return {
    ...targetModule,
    minimum_role_id: nextRole.id,
    minimum_role_name: nextRole.display_name,
    minimum_hierarchy_rank: nextRole.hierarchy_rank,
    enforced_minimum_access_level: getModuleEnforcedMinimumAccessLevel(moduleName, nextRole.hierarchy_rank),
  };
}

export async function updatePermissionModuleSensitivePinRequirement(
  supabaseAdmin: SupabaseAdminClient,
  moduleName: ModuleName,
  requiresSensitivePin: boolean
): Promise<PermissionModuleMatrixColumn> {
  const roles = await getPermissionTierRoles(supabaseAdmin);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);
  const targetModule = modules.find((entry) => entry.module_name === moduleName);

  if (!targetModule) {
    throw new Error(`Module ${moduleName} is not configured for the permission matrix.`);
  }

  const { error } = await supabaseAdmin
    .from('permission_modules')
    .update({
      requires_sensitive_pin: requiresSensitivePin,
      updated_at: new Date().toISOString(),
    })
    .eq('module_name', moduleName);

  if (error) {
    throw error;
  }

  return {
    ...targetModule,
    requires_sensitive_pin: requiresSensitivePin,
  };
}

export async function getPermissionLevelsForUser(
  userId: string,
  effectiveRoleId?: string | null,
  supabaseAdmin: SupabaseAdminClient = createAdminClient(),
  effectiveTeamId?: string | null,
  options?: { includeUserOverrides?: boolean }
): Promise<Record<ModuleName, PermissionAccessLevel>> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, team_id, role_id')
    .eq('id', userId)
    .single();

  if (error) {
    throw error;
  }

  const profile = data as {
    team_id?: string | null;
    role_id?: string | null;
  } | null;

  const resolvedRoleId = effectiveRoleId || profile?.role_id || null;

  if (!resolvedRoleId) {
    return applyUniversalModuleLevels(createEmptyModuleLevelRecord());
  }

  const { data: roleData, error: roleError } = await supabaseAdmin
    .from('roles')
    .select('id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin')
    .eq('id', resolvedRoleId)
    .single();

  if (roleError) {
    throw roleError;
  }

  const role = roleData as RoleRow | null;

  if (!role) {
    return applyUniversalModuleLevels(createEmptyModuleLevelRecord());
  }

  const teamId = effectiveTeamId || profile?.team_id || null;

  const includeUserOverrides = options?.includeUserOverrides !== false;

  const [modules, teamPermissionsResult, userPermissionsResult] = await Promise.all([
    getPermissionModules(supabaseAdmin),
    supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled')
      .eq('team_id', teamId || ''),
    includeUserOverrides
      ? supabaseAdmin
        .from('user_module_permissions')
        .select('module_name, access_level')
        .eq('user_id', userId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (teamPermissionsResult.error) {
    throw teamPermissionsResult.error;
  }
  if (userPermissionsResult.error) {
    throw userPermissionsResult.error;
  }

  const enabledByTeam = new Map<string, Map<ModuleName, boolean>>();
  ((teamPermissionsResult.data || []) as TeamPermissionRow[]).forEach((row) => {
    if (!enabledByTeam.has(row.team_id)) {
      enabledByTeam.set(row.team_id, new Map<ModuleName, boolean>());
    }
    enabledByTeam.get(row.team_id)!.set(row.module_name, row.enabled);
  });

  const inheritedLevels = getInheritedLevelsForProfile({
    profile: { team_id: teamId, role_id: resolvedRoleId, role },
    modules,
    role,
    enabledByTeam,
  });
  const overrides = new Map<ModuleName, PermissionAccessLevel>();
  ((userPermissionsResult.data || []) as Array<{ module_name: ModuleName; access_level: number }>).forEach(
    (row) => {
      overrides.set(row.module_name, normalizePermissionAccessLevel(row.access_level));
    }
  );

  return getEffectiveLevelsForProfile({
    profile: { id: userId, team_id: teamId, role_id: resolvedRoleId, role },
    role,
    modules,
    inheritedLevels,
    overrideLevels: overrides,
  });
}

export async function getPermissionSetForUser(
  userId: string,
  effectiveRoleId?: string | null,
  supabaseAdmin: SupabaseAdminClient = createAdminClient(),
  effectiveTeamId?: string | null,
  options?: { includeUserOverrides?: boolean }
): Promise<Set<ModuleName>> {
  const levels = await getPermissionLevelsForUser(userId, effectiveRoleId, supabaseAdmin, effectiveTeamId, options);
  return new Set<ModuleName>(
    ALL_MODULES.filter((moduleName) => (levels[moduleName] || 0) > 0)
  );
}

export async function getPermissionMapForUser(
  userId: string,
  effectiveRoleId?: string | null,
  supabaseAdmin: SupabaseAdminClient = createAdminClient(),
  effectiveTeamId?: string | null,
  options?: { includeUserOverrides?: boolean }
): Promise<Record<ModuleName, boolean>> {
  const permissionSet = await getPermissionSetForUser(
    userId,
    effectiveRoleId,
    supabaseAdmin,
    effectiveTeamId,
    options
  );
  const permissionMap = createEmptyModulePermissionRecord();

  permissionSet.forEach((moduleName) => {
    permissionMap[moduleName] = true;
  });

  return permissionMap;
}

export async function getUsersWithModuleAccess(
  moduleName: ModuleName,
  userIds?: string[],
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<Set<string>> {
  if (userIds && userIds.length === 0) {
    return new Set<string>();
  }

  const profilesQuery = supabaseAdmin.from('profiles').select('id, team_id, role_id, employee_id, full_name, is_placeholder');
  const scopedProfilesQuery = userIds?.length ? profilesQuery.in('id', userIds) : profilesQuery;

  const { data: profiles, error: profilesError } = await scopedProfilesQuery;

  if (profilesError) {
    throw profilesError;
  }

  const typedProfiles = (profiles || []) as Array<{
    id: string;
    team_id: string | null;
    role_id: string | null;
    employee_id?: string | null;
    full_name: string | null;
    is_placeholder?: boolean | null;
  }>;

  const hiddenIds = await getHiddenSystemTestAccountIds(supabaseAdmin as Parameters<typeof getHiddenSystemTestAccountIds>[0]);
  const visibleProfiles = typedProfiles.filter(
    (profile) => !hiddenIds.has(profile.id) && !isHiddenSystemTestAccountProfile(profile) && !isDeletedProfile(profile)
  );

  if (UNIVERSAL_PERMISSION_MODULES.has(moduleName)) {
    return new Set<string>(visibleProfiles.map((profile) => profile.id));
  }

  if (visibleProfiles.length === 0) {
    return new Set<string>();
  }

  const [{ data: roles, error: rolesError }, modules] = await Promise.all([
    supabaseAdmin
      .from('roles')
      .select('id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin'),
    getPermissionModules(supabaseAdmin),
  ]);

  if (rolesError) {
    throw rolesError;
  }

  const targetModule = modules.find((module) => module.module_name === moduleName);
  if (!targetModule) {
    return new Set<string>();
  }

  const teamIds = Array.from(
    new Set(visibleProfiles.map((profile) => profile.team_id).filter((teamId): teamId is string => Boolean(teamId)))
  );

  const enabledByTeam = new Map<string, Map<ModuleName, boolean>>();
  const visibleUserIds = visibleProfiles.map((profile) => profile.id);
  const { data: userPermissionRows, error: userPermissionError } = await supabaseAdmin
    .from('user_module_permissions')
    .select('user_id, module_name, access_level')
    .in('user_id', visibleUserIds)
    .eq('module_name', moduleName);

  if (userPermissionError) {
    throw userPermissionError;
  }

  const accessLevelByUser = new Map(
    ((userPermissionRows || []) as UserModulePermissionRow[]).map((row) => [
      row.user_id,
      normalizePermissionAccessLevel(row.access_level),
    ])
  );

  if (teamIds.length > 0) {
    const { data: teamPermissions, error: teamPermissionsError } = await supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled')
      .in('team_id', teamIds);

    if (teamPermissionsError) {
      throw teamPermissionsError;
    }

    ((teamPermissions || []) as TeamPermissionRow[]).forEach((row) => {
      if (!enabledByTeam.has(row.team_id)) {
        enabledByTeam.set(row.team_id, new Map<ModuleName, boolean>());
      }

      enabledByTeam.get(row.team_id)!.set(row.module_name, !!row.enabled);
    });
  }

  const rolesById = new Map(((roles || []) as RoleRow[]).map((role) => [role.id, role]));
  const allowedUsers = new Set<string>();

  visibleProfiles.forEach((profile) => {
    if (!profile.role_id) {
      return;
    }

    const role = rolesById.get(profile.role_id);
    if (!role) {
      return;
    }

    if (isFullAccessRole(role)) {
      allowedUsers.add(profile.id);
      return;
    }

    const overrideLevel = accessLevelByUser.get(profile.id);
    if (overrideLevel !== undefined) {
      const usableOverrideLevel = getUsablePermissionAccessLevel(targetModule, overrideLevel, {
        hasFullAccessRole: false,
      });
      if (usableOverrideLevel > 0) {
        allowedUsers.add(profile.id);
      }
      return;
    }

    if (typeof role.hierarchy_rank !== 'number' || !profile.team_id) {
      return;
    }

    if (
      (enabledByTeam.get(profile.team_id)?.get(moduleName) ?? false) &&
      resolveModuleLevelForRoleRank({ role, module: targetModule, enabled: true }) > 0
    ) {
      allowedUsers.add(profile.id);
    }
  });

  return allowedUsers;
}
