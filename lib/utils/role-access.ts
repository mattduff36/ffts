import { CORE_PERMISSION_TIER_RANKS } from '@/lib/utils/permission-tiers';

interface AdminRoleLike {
  name?: string | null;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  hierarchy_rank?: number | null;
  is_super_admin?: boolean | null;
  is_manager_admin?: boolean | null;
}

interface EffectiveAdminRoleLike {
  role_name?: string | null;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  hierarchy_rank?: number | null;
  is_manager_admin?: boolean | null;
  is_super_admin?: boolean | null;
  is_actual_super_admin?: boolean | null;
  is_viewing_as?: boolean | null;
}

function normalizeRoleName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase();
}

export function isAdminRole(role: Pick<AdminRoleLike, 'name' | 'role_class'> | null | undefined): boolean {
  if (!role) {
    return false;
  }

  return role.role_class === 'admin' || normalizeRoleName(role.name) === 'admin';
}

export function hasRoleFullAccess(
  role: Pick<AdminRoleLike, 'name' | 'role_class' | 'is_super_admin'> | null | undefined
): boolean {
  if (!role) {
    return false;
  }

  return Boolean(role.is_super_admin) || isAdminRole(role);
}

export function hasEffectiveRoleFullAccess(
  role: Pick<
    EffectiveAdminRoleLike,
    'role_name' | 'role_class' | 'is_super_admin' | 'is_actual_super_admin' | 'is_viewing_as'
  > | null | undefined
): boolean {
  if (!role) {
    return false;
  }

  return (
    (Boolean(role.is_actual_super_admin) && role.is_viewing_as !== true) ||
    Boolean(role.is_super_admin) ||
    role.role_class === 'admin' ||
    normalizeRoleName(role.role_name) === 'admin'
  );
}

export function isSupervisorOrHigherRole(
  role: (AdminRoleLike & { role_name?: string | null }) | null | undefined
): boolean {
  if (!role) {
    return false;
  }

  const roleName = normalizeRoleName(role.name ?? role.role_name);

  if (Boolean(role.is_super_admin) || role.role_class === 'admin' || roleName === 'admin') {
    return true;
  }

  if (Boolean(role.is_manager_admin) || role.role_class === 'manager' || roleName === 'manager') {
    return true;
  }

  if (typeof role.hierarchy_rank === 'number') {
    return role.hierarchy_rank >= CORE_PERMISSION_TIER_RANKS.supervisor;
  }

  return roleName === 'supervisor';
}

export function isEffectiveSupervisorOrHigherRole(
  role: (EffectiveAdminRoleLike & { name?: string | null }) | null | undefined
): boolean {
  if (!role) {
    return false;
  }

  return (
    (Boolean(role.is_actual_super_admin) && role.is_viewing_as !== true) ||
    isSupervisorOrHigherRole({
      name: role.name,
      role_name: role.role_name,
      role_class: role.role_class,
      hierarchy_rank: role.hierarchy_rank,
      is_manager_admin: role.is_manager_admin,
      is_super_admin: role.is_super_admin,
    })
  );
}
