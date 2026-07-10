import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';
import { getPermissionLevelsForUser } from '@/lib/server/team-permissions';

interface RoleRecord {
  id: string;
  name: string;
  role_class: 'admin' | 'manager' | 'employee';
  is_super_admin: boolean;
}

export async function canEffectiveRoleAccessModule(moduleName: ModuleName): Promise<boolean> {
  const accessLevel = await getEffectiveModuleAccessLevel(moduleName);
  return accessLevel > 0;
}

export async function getEffectiveModuleAccessLevel(moduleName: ModuleName): Promise<PermissionAccessLevel> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id || !effectiveRole.role_id) {
    return 0;
  }

  if (hasEffectiveRoleFullAccess(effectiveRole)) {
    return 5;
  }

  const permissionLevels = await getPermissionLevelsForUser(
    effectiveRole.user_id,
    effectiveRole.role_id,
    createAdminClient(),
    effectiveRole.team_id,
    { includeUserOverrides: effectiveRole.is_viewing_as !== true }
  );

  return permissionLevels[moduleName] || 0;
}

export async function canEffectiveRoleUseModuleLevel(
  moduleName: ModuleName,
  minimumLevel: PermissionAccessLevel
): Promise<boolean> {
  const accessLevel = await getEffectiveModuleAccessLevel(moduleName);
  return accessLevel >= minimumLevel;
}

export async function canEffectiveRoleAssignRole(targetRoleId: string): Promise<boolean> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return false;
  }

  if (hasEffectiveRoleFullAccess(effectiveRole)) {
    return true;
  }

  if (!effectiveRole.is_manager_admin) {
    return false;
  }

  const admin = createAdminClient();
  const { data: targetRole } = await admin
    .from('roles')
    .select('role_class, is_super_admin')
    .eq('id', targetRoleId)
    .maybeSingle();

  return targetRole?.role_class === 'employee' && targetRole?.is_super_admin !== true;
}

export async function isEffectiveRoleAdminOrSuper(): Promise<boolean> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return false;
  }

  return hasEffectiveRoleFullAccess(effectiveRole);
}

export async function isEffectiveRoleManagerOrHigher(): Promise<boolean> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return false;
  }

  return (
    hasEffectiveRoleFullAccess(effectiveRole) || effectiveRole.is_manager_admin
  );
}

export async function getAssignableRolesForEffectiveActor(): Promise<RoleRecord[]> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return [];
  }

  const admin = createAdminClient();
  let query = admin
    .from('roles')
    .select('id, name, role_class, is_super_admin')
    .order('is_super_admin', { ascending: false })
    .order('is_manager_admin', { ascending: false })
    .order('display_name', { ascending: true });

  if (!hasEffectiveRoleFullAccess(effectiveRole)) {
    if (effectiveRole.is_manager_admin) {
      query = query.eq('role_class', 'employee').eq('is_super_admin', false);
    } else {
      return [];
    }
  }

  const { data } = await query;
  return (data || []) as RoleRecord[];
}
