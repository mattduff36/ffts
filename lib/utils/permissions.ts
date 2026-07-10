import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ModuleName, UserPermissions } from '@/types/roles';
import { getPermissionMapForUser, getPermissionSetForUser, getUsersWithModuleAccess } from '@/lib/server/team-permissions';

export type ProfileWithRole = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  employee_id: string | null;
  role_id: string | null;
  must_change_password: boolean | null;
  is_super_admin: boolean | null;
  created_at: string;
  updated_at: string;
  role: {
    name: string;
    display_name: string;
    role_class: 'admin' | 'manager' | 'employee';
    hierarchy_rank?: number | null;
    is_manager_admin: boolean;
    is_super_admin: boolean;
  } | null;
};

type ProfileWithRoleRow = Omit<ProfileWithRole, 'role' | 'is_super_admin' | 'email'> & {
  super_admin: boolean | null;
  role:
    | {
        name: string;
        display_name: string;
        role_class: 'admin' | 'manager' | 'employee';
        hierarchy_rank?: number | null;
        is_manager_admin: boolean;
        is_super_admin: boolean;
      }
    | Array<{
        name: string;
        display_name: string;
        role_class: 'admin' | 'manager' | 'employee';
        hierarchy_rank?: number | null;
        is_manager_admin: boolean;
        is_super_admin: boolean;
      }>
    | null;
};

/**
 * Fetch a profile with role information included
 * Use this in API routes instead of direct profile fetch
 */
export async function getProfileWithRole(userId: string): Promise<ProfileWithRole | null> {
  const admin = createAdminClient();

  try {
    const { data, error } = await admin
      .from('profiles')
      .select(`
        id,
        full_name,
        phone_number,
        employee_id,
        role_id,
        must_change_password,
        super_admin,
        created_at,
        updated_at,
        role:roles(
          name,
          display_name,
          role_class,
          hierarchy_rank,
          is_manager_admin,
          is_super_admin
        )
      `)
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile with role:', error);
      console.error('User ID:', userId);
      return null;
    }

    const typedData = data as ProfileWithRoleRow | null;
    if (!typedData) {
      return null;
    }

    const role = Array.isArray(typedData.role) ? typedData.role[0] || null : typedData.role;
    return {
      ...typedData,
      email: null,
      is_super_admin: typedData.super_admin,
      role,
    };
  } catch (error) {
    console.error('Error fetching profile with role:', error);
    return null;
  }
}

/**
 * Check if a user has permission to access a specific module
 */
export async function userHasPermission(
  userId: string,
  module: ModuleName
): Promise<boolean> {
  try {
    const permissionSet = await getPermissionSetForUser(userId, null, createAdminClient());
    return permissionSet.has(module);
  } catch (error) {
    console.error('Error checking permission:', error);
    return false;
  }
}

/**
 * Get all permissions for a user
 */
export async function getUserPermissions(
  userId: string
): Promise<UserPermissions> {
  try {
    const permissions = await getPermissionMapForUser(userId, null, createAdminClient());
    return permissions;
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return {};
  }
}

/**
 * Check if a user is a manager or admin
 */
export async function isManagerOrAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role_id, roles!inner(is_manager_admin)')
      .eq('id', userId)
      .single();
    const typedProfile = profile as { roles: { is_manager_admin: boolean } | null } | null;

    return typedProfile?.roles?.is_manager_admin ?? false;
  } catch (error) {
    console.error('Error checking manager/admin status:', error);
    return false;
  }
}

/**
 * Check if a user is a super admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('super_admin')
      .eq('id', userId)
      .single();
    const typedProfile = profile as { super_admin: boolean | null } | null;

    return typedProfile?.super_admin ?? false;
  } catch (error) {
    console.error('Error checking super admin status:', error);
    return false;
  }
}

/**
 * Get users with permission for a specific module
 * Used for filtering dropdowns in assignment flows
 */
export async function getUsersWithPermission(
  module: ModuleName
): Promise<string[]> {
  const admin = createAdminClient();

  try {
    return Array.from(await getUsersWithModuleAccess(module, undefined, admin));
  } catch (error) {
    console.error('Error getting users with permission:', error);
    return [];
  }
}

/**
 * Validate that a user can be assigned to a task requiring a specific module
 */
export async function validateUserAssignment(
  userId: string,
  module: ModuleName
): Promise<{ valid: boolean; error?: string }> {
  const hasPermission = await userHasPermission(userId, module);

  if (!hasPermission) {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, roles!inner(display_name)')
      .eq('id', userId)
      .single();
    const typedProfile = profile as { full_name: string | null; roles: { display_name: string | null } | null } | null;

    return {
      valid: false,
      error: `${typedProfile?.full_name || 'This user'} (${typedProfile?.roles?.display_name}) does not have access to ${module}. Please update their user permission level or choose a different user.`,
    };
  }

  return { valid: true };
}

