import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import type { GetRoleResponse, UpdateRoleRequest } from '@/types/roles';
import { managerFlagFromRoleClass, normalizeRoleInternalName } from '@/lib/utils/role-name';
import { isRetiredRoleName } from '@/lib/config/roles-core';
import { defaultHierarchyRankForRole, normalizeHierarchyRankInput } from '@/lib/utils/permission-tiers';

/**
 * GET /api/admin/roles/[id]
 * Get role details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const isAuthorized = await isEffectiveRoleAdminOrSuper();
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    // Get role details. Module access is managed by the team matrix.
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .single();

    if (roleError) {
      if (roleError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      throw roleError;
    }

    // Get user count
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role_id', id);

    const response: GetRoleResponse = {
      success: true,
      role: {
        ...role,
        is_super_admin: Boolean(role.is_super_admin),
        is_manager_admin: Boolean(role.is_manager_admin),
        timesheet_type: role.timesheet_type ?? undefined,
        created_at: role.created_at ?? '',
        updated_at: role.updated_at ?? '',
        permissions: [],
        user_count: count || 0,
      },
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/admin/roles/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/roles/[id]',
      additionalData: {
        endpoint: '/api/admin/roles/[id]',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/roles/[id]
 * Update role details (not permissions)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const isAuthorized = await isEffectiveRoleAdminOrSuper();
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const body = (await request.json()) as UpdateRoleRequest;

    // Check if role exists and is not super admin
    const { data: existingRole, error: fetchError } = await supabase
      .from('roles')
      .select('is_super_admin, role_class, name, hierarchy_rank')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      throw fetchError;
    }

    if (existingRole.is_super_admin) {
      return NextResponse.json({ 
        error: 'Cannot modify super admin role' 
      }, { status: 403 });
    }

    const nextRoleClass = body.role_class ?? existingRole.role_class;
    const nextRoleName = body.name ? normalizeRoleInternalName(body.name) : existingRole.name;
    const nextHierarchyRank =
      body.hierarchy_rank !== undefined
        ? normalizeHierarchyRankInput(body.hierarchy_rank)
        : existingRole.hierarchy_rank ?? defaultHierarchyRankForRole(nextRoleClass, nextRoleName);

    // If changing name, check it doesn't conflict
    if (body.name) {
      const normalizedName = normalizeRoleInternalName(body.name);
      if (isRetiredRoleName(normalizedName)) {
        return NextResponse.json(
          { error: 'This retired role name cannot be reused. Use Employee, Manager, Admin, or a custom role name.' },
          { status: 400 }
        );
      }
      const { data: conflictRole } = await supabase
        .from('roles')
        .select('id')
        .eq('name', normalizedName)
        .neq('id', id)
        .single();

      if (conflictRole) {
        return NextResponse.json({ 
          error: 'A role with this name already exists' 
        }, { status: 409 });
      }

      if (nextRoleClass === 'admin' && normalizedName !== 'admin') {
        return NextResponse.json({
          error: 'Admin role must use internal name "admin"'
        }, { status: 400 });
      }
    }

    if (nextHierarchyRank !== null && nextRoleClass !== 'admin') {
      const { data: conflictingTier } = await supabase
        .from('roles')
        .select('id, display_name')
        .eq('hierarchy_rank', nextHierarchyRank)
        .neq('name', 'admin')
        .neq('id', id)
        .maybeSingle();

      if (conflictingTier) {
        return NextResponse.json(
          {
            error: `Hierarchy rank ${nextHierarchyRank} is already used by ${(conflictingTier as { display_name?: string }).display_name || 'another role'}.`,
          },
          { status: 409 }
        );
      }
    }

    // Update the role
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = normalizeRoleInternalName(body.name);
    if (body.display_name !== undefined) updateData.display_name = body.display_name.trim();
    if (body.description !== undefined) updateData.description = body.description;
    if (body.role_class !== undefined) {
      updateData.role_class = body.role_class;
      updateData.is_manager_admin = managerFlagFromRoleClass(body.role_class);
      if (body.role_class === 'admin' && updateData.name !== 'admin') {
        updateData.name = 'admin';
      }
    }
    if (body.hierarchy_rank !== undefined) {
      updateData.hierarchy_rank = nextHierarchyRank;
    } else if (body.role_class !== undefined || body.name !== undefined) {
      updateData.hierarchy_rank = nextHierarchyRank;
    }
    if (body.timesheet_type !== undefined) updateData.timesheet_type = body.timesheet_type;

    const { data: updatedRole, error: updateError } = await supabase
      .from('roles')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ 
      success: true, 
      role: updatedRole 
    });

  } catch (error) {
    console.error('Error in PATCH /api/admin/roles/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/roles/[id]',
      additionalData: {
        endpoint: '/api/admin/roles/[id]',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/roles/[id]
 * Delete a role (with safety checks)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const isAuthorized = await isEffectiveRoleAdminOrSuper();
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    // Check if role exists and is not super admin or manager/admin
    const { data: existingRole, error: fetchError } = await supabase
      .from('roles')
      .select('is_super_admin, is_manager_admin')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      throw fetchError;
    }

    if (existingRole.is_super_admin || existingRole.is_manager_admin) {
      return NextResponse.json({ 
        error: 'Cannot delete super admin or manager/admin roles' 
      }, { status: 403 });
    }

    // Check if any users have this role
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role_id', id);

    if (count && count > 0) {
      return NextResponse.json({ 
        error: `Cannot delete role: ${count} user(s) are assigned to this role. Please reassign users first.` 
      }, { status: 409 });
    }

    // Delete role (permissions will cascade delete)
    const { error: deleteError } = await supabase
      .from('roles')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({ 
      success: true,
      message: 'Role deleted successfully'
    });

  } catch (error) {
    console.error('Error in DELETE /api/admin/roles/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/roles/[id]',
      additionalData: {
        endpoint: '/api/admin/roles/[id]',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

