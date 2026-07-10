import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import type { GetRolesResponse, CreateRoleRequest, RoleWithUserCount, RoleMatrixRow, ModuleName, RoleClass } from '@/types/roles';
import { createEmptyModulePermissionRecord } from '@/types/roles';
import { managerFlagFromRoleClass, normalizeRoleInternalName, roleClassFromLegacyRoleType } from '@/lib/utils/role-name';
import { isRetiredRoleName } from '@/lib/config/roles-core';
import { defaultHierarchyRankForRole, normalizeHierarchyRankInput } from '@/lib/utils/permission-tiers';

/**
 * GET /api/admin/roles
 * List all roles with user counts
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const effectiveRole = await getEffectiveRole();
    const isAdminOrSuper = hasEffectiveRoleFullAccess(effectiveRole);
    const isManager = effectiveRole.is_manager_admin && !isAdminOrSuper;
    if (!isAdminOrSuper && !isManager) {
      return NextResponse.json({ error: 'Forbidden - Admin or Manager access required' }, { status: 403 });
    }

    // Get all roles with user counts. Module access is managed by the team matrix.
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select(`
        *,
        profiles:profiles(count)
      `)
      .order('is_super_admin', { ascending: false })
      .order('is_manager_admin', { ascending: false })
      .order('name');

    if (rolesError) {
      throw rolesError;
    }

    interface RoleRow {
      id: string;
      name: string;
      display_name: string;
      description: string | null;
      role_class: RoleClass;
      hierarchy_rank?: number | null;
      is_super_admin: boolean;
      is_manager_admin: boolean;
      timesheet_type?: string;
      created_at: string;
      updated_at: string;
      profiles?: Array<{ count: number }>;
    }

    const formattedRoles: RoleWithUserCount[] = (roles as RoleRow[]).map((role) => ({
      id: role.id,
      name: role.name,
      display_name: role.display_name,
      description: role.description,
      role_class: role.role_class,
      is_super_admin: role.is_super_admin,
      is_manager_admin: role.is_manager_admin,
      hierarchy_rank: role.hierarchy_rank ?? null,
      created_at: role.created_at,
      updated_at: role.updated_at,
      user_count: role.profiles?.[0]?.count || 0,
      permission_count: 0,
    }));

    const matrixRoles: RoleMatrixRow[] = (roles as RoleRow[]).map((role) => {
      const perms = createEmptyModulePermissionRecord() as Record<ModuleName, boolean>;
      return {
        id: role.id,
        name: role.name,
        display_name: role.display_name,
        description: role.description,
        role_class: role.role_class,
        hierarchy_rank: role.hierarchy_rank ?? null,
        is_super_admin: role.is_super_admin,
        is_manager_admin: role.is_manager_admin,
        timesheet_type: role.timesheet_type,
        created_at: role.created_at,
        updated_at: role.updated_at,
        user_count: role.profiles?.[0]?.count || 0,
        permissions: perms,
      };
    });

    const response: GetRolesResponse = {
      success: true,
      roles: formattedRoles,
    };

    return NextResponse.json({ ...response, matrix: matrixRoles });

  } catch (error) {
    console.error('Error in GET /api/admin/roles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/roles',
      additionalData: {
        endpoint: '/api/admin/roles',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/roles
 * Create a new role with default permissions
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const effectiveRole = await getEffectiveRole();
    const isAdminOrSuper = hasEffectiveRoleFullAccess(effectiveRole);
    const isManager = effectiveRole.is_manager_admin && !isAdminOrSuper;
    if (!isAdminOrSuper && !isManager) {
      return NextResponse.json({ error: 'Forbidden - Admin or Manager access required' }, { status: 403 });
    }

    const body = (await request.json()) as CreateRoleRequest;

    // Validate required fields
    if (!body.name || !body.display_name) {
      return NextResponse.json({ 
        error: 'Missing required fields: name, display_name' 
      }, { status: 400 });
    }

    const normalizedName = normalizeRoleInternalName(body.name);
    if (isRetiredRoleName(normalizedName)) {
      return NextResponse.json(
        { error: 'This retired role name cannot be reused. Use Employee, Manager, Admin, or a new custom role name.' },
        { status: 400 }
      );
    }
    const requestedRoleClass = roleClassFromLegacyRoleType(
      body.role_class ?? body.role_type,
      false,
      normalizedName
    );
    const requestedHierarchyRank =
      normalizeHierarchyRankInput(body.hierarchy_rank) ??
      defaultHierarchyRankForRole(requestedRoleClass, normalizedName);

    if (isManager && requestedRoleClass !== 'employee') {
      return NextResponse.json({
        error: 'Managers can only create Employee roles'
      }, { status: 403 });
    }

    if (isManager && requestedHierarchyRank !== defaultHierarchyRankForRole('employee', 'employee')) {
      return NextResponse.json({
        error: 'Managers cannot create new permission tiers'
      }, { status: 403 });
    }

    if (requestedRoleClass === 'admin' && normalizedName !== 'admin') {
      return NextResponse.json({
        error: 'Admin role must use internal name "admin"'
      }, { status: 400 });
    }

    if (requestedHierarchyRank !== null && requestedRoleClass !== 'admin') {
      const { data: conflictingTier } = await supabase
        .from('roles')
        .select('id, display_name')
        .eq('hierarchy_rank', requestedHierarchyRank)
        .neq('name', 'admin')
        .maybeSingle();

      if (conflictingTier) {
        return NextResponse.json(
          {
            error: `Hierarchy rank ${requestedHierarchyRank} is already used by ${(conflictingTier as { display_name?: string }).display_name || 'another role'}.`,
          },
          { status: 409 }
        );
      }
    }

    // Check if role name already exists
    const { data: existingRole } = await supabase
      .from('roles')
      .select('id')
      .eq('name', normalizedName)
      .single();

    if (existingRole) {
      return NextResponse.json({ 
        error: 'A role with this name already exists' 
      }, { status: 409 });
    }

    // Create the role
    const { data: newRole, error: roleError } = await supabase
      .from('roles')
      .insert({
        name: normalizedName,
        display_name: body.display_name.trim(),
        description: body.description || null,
        role_class: requestedRoleClass,
        hierarchy_rank: requestedHierarchyRank,
        is_super_admin: false, // Cannot create super admin via API
        is_manager_admin: managerFlagFromRoleClass(requestedRoleClass),
        timesheet_type: body.timesheet_type === 'plant' ? 'plant' : 'civils',
      })
      .select()
      .single();

    if (roleError) {
      throw roleError;
    }

    return NextResponse.json({ 
      success: true, 
      role: newRole 
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/admin/roles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/roles',
      additionalData: {
        endpoint: '/api/admin/roles',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

