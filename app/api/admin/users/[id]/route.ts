import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendProfileUpdateEmail } from '@/lib/utils/email';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { logServerError } from '@/lib/utils/server-error-logger';
import { isMissingTeamManagerSchemaError, reconcileProfileHierarchy } from '@/lib/server/team-managers';
import { hasRoleFullAccess } from '@/lib/utils/role-access';

function isMissingHierarchySchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';
  return (
    code === '42703' ||
    code === '42P01' ||
    message.includes('line_manager_id') ||
    message.includes('team_id') ||
    message.includes('column') ||
    message.includes('does not exist')
  );
}

async function validateHierarchyReferences(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  input: { profile_id: string; line_manager_id?: string | null; team_id?: string | null }
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const { profile_id, line_manager_id, team_id } = input;

  if (line_manager_id && line_manager_id === profile_id) {
    return { ok: false, error: 'A user cannot be their own line manager.' };
  }

  if (line_manager_id) {
    const { data: managerRow, error: managerError } = await supabaseAdmin
      .from('profiles')
      .select('id, role:roles(role_class)')
      .eq('id', line_manager_id)
      .single();

    if (managerError || !managerRow) {
      return { ok: false, error: 'Selected line manager does not exist.' };
    }

    const roleClass = (managerRow as { role?: { role_class?: string } | null })?.role?.role_class;
    if (roleClass !== 'manager' && roleClass !== 'admin') {
      return { ok: false, error: 'Selected line manager must have a manager/admin role.' };
    }
  }

  if (team_id) {
    const { data: teamRow, error: teamError } = await supabaseAdmin
      .from('org_teams')
      .select('id')
      .eq('id', team_id)
      .single();

    if (teamError) {
      if (isMissingHierarchySchemaError(teamError)) {
        return { ok: true, warning: 'Team validation skipped because hierarchy schema is not ready yet.' };
      }
      return { ok: false, error: 'Failed to validate selected team.' };
    }
    if (!teamRow) {
      return { ok: false, error: 'Selected team does not exist.' };
    }
  }

  return { ok: true };
}

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

interface ProfileChangeEntry {
  old: string;
  new: string;
}

interface ProfileChanges {
  email?: ProfileChangeEntry;
  full_name?: ProfileChangeEntry;
  phone_number?: ProfileChangeEntry;
  employee_id?: ProfileChangeEntry;
  role?: ProfileChangeEntry;
  line_manager?: ProfileChangeEntry;
  team?: ProfileChangeEntry;
}

type RoleAccessRow = {
  name: string | null;
  display_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_super_admin: boolean | null;
};

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check effective role (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const userId = (await params).id;
    const body = await request.json();
    const { email, full_name, phone_number, employee_id, role_id, line_manager_id, team_id } = body;

    // Validate required fields
    if (!full_name) {
      return NextResponse.json(
        { error: 'Full name is required' },
        { status: 400 }
      );
    }

    // Validate role_id
    if (!role_id) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: requestedRole, error: requestedRoleError } = await supabaseAdmin
      .from('roles')
      .select('id, is_super_admin')
      .eq('id', role_id)
      .maybeSingle();

    if (requestedRoleError || !requestedRole) {
      return NextResponse.json({ error: 'Invalid role selected.' }, { status: 400 });
    }

    // Fetch existing user data before validating the role transition. Existing
    // Super Admin accounts may retain their protected role while other profile
    // fields are edited, but the role cannot be assigned or removed here.
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*, assigned_role:roles!profiles_role_id_fkey(is_super_admin)')
      .eq('id', userId)
      .single();

    if (fetchError || !existingUser) {
      console.error('Error fetching existing user:', fetchError);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const existingAssignedRole = existingUser.assigned_role as { is_super_admin?: boolean | null } | null;
    const isExistingSuperAdmin =
      existingUser.super_admin === true || existingAssignedRole?.is_super_admin === true;
    const isProtectedRoleUnchanged =
      isExistingSuperAdmin && requestedRole.is_super_admin === true && existingUser.role_id === role_id;

    if (
      (requestedRole.is_super_admin === true && !isProtectedRoleUnchanged) ||
      (isExistingSuperAdmin && existingUser.role_id !== role_id)
    ) {
      return NextResponse.json(
        { error: 'Super Admin roles cannot be assigned or changed in the application.' },
        { status: 403 }
      );
    }

    if (!isProtectedRoleUnchanged) {
      const canAssignRequestedRole = await canEffectiveRoleAssignRole(role_id);
      if (!canAssignRequestedRole) {
        return NextResponse.json(
          { error: 'Forbidden: you cannot assign this role' },
          { status: 403 }
        );
      }
    }

    const hierarchyValidation = await validateHierarchyReferences(supabaseAdmin, {
      profile_id: userId,
      line_manager_id: line_manager_id || null,
      team_id: team_id || null,
    });
    if (!hierarchyValidation.ok) {
      return NextResponse.json(
        {
          error: hierarchyValidation.error || 'Invalid hierarchy assignment',
          code: 'INVALID_HIERARCHY_ASSIGNMENT',
        },
        { status: 400 }
      );
    }

    // Track changes for email notification
    const changes: ProfileChanges = {};
    const notificationEmail = email || null;
    if (email) {
      const { data: existingAuthUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      const existingEmail = existingAuthUser?.user?.email || '';
      if (email !== existingEmail) {
        changes.email = { old: existingEmail, new: email };
      }
    }
    if (full_name !== existingUser.full_name) {
      changes.full_name = { old: existingUser.full_name, new: full_name };
    }
    if (phone_number !== existingUser.phone_number) {
      changes.phone_number = { old: existingUser.phone_number || '', new: phone_number || '' };
    }
    if (employee_id !== existingUser.employee_id) {
      changes.employee_id = { old: existingUser.employee_id || '', new: employee_id || '' };
    }
    if ((line_manager_id || null) !== ((existingUser as { line_manager_id?: string | null }).line_manager_id || null)) {
      changes.line_manager = {
        old: String((existingUser as { line_manager_id?: string | null }).line_manager_id || ''),
        new: String(line_manager_id || ''),
      };
    }
    if ((team_id || null) !== ((existingUser as { team_id?: string | null }).team_id || null)) {
      changes.team = {
        old: String((existingUser as { team_id?: string | null }).team_id || ''),
        new: String(team_id || ''),
      };
    }
    let shouldClearUserPermissionOverrides = false;
    if (role_id !== existingUser.role_id) {
      // Fetch role names for email (display_name instead of UUID)
      const { data: oldRole } = await supabaseAdmin
        .from('roles')
        .select('name, display_name, role_class, is_super_admin')
        .eq('id', existingUser.role_id)
        .maybeSingle();
      
      const { data: newRole } = await supabaseAdmin
        .from('roles')
        .select('name, display_name, role_class, is_super_admin')
        .eq('id', role_id)
        .maybeSingle();

      const oldRoleAccess = oldRole as RoleAccessRow | null;
      const newRoleAccess = newRole as RoleAccessRow | null;
      shouldClearUserPermissionOverrides =
        hasRoleFullAccess(oldRoleAccess) && !hasRoleFullAccess(newRoleAccess);
      
      changes.role = {
        old: oldRoleAccess?.display_name || 'Unknown',
        new: newRoleAccess?.display_name || 'Unknown'
      };
    }

    // Update email in auth if it changed
    if (email) {
      const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { email }
      );

      if (emailError) {
        console.error('Email update error:', emailError);
        return NextResponse.json(
          { error: `Failed to update email: ${emailError.message}` },
          { status: 400 }
        );
      }
    }

    // Update profile data (email is only in auth, not in profiles table)
    // Use admin client to bypass RLS policies
    const baseUpdatePayload = {
      full_name,
      phone_number: phone_number || null,
      employee_id: employee_id || null,
      role_id,
    };

    const hierarchyUpdatePayload = {
      ...baseUpdatePayload,
      line_manager_id: line_manager_id || null,
      team_id: team_id || null,
    };

    let hierarchyFieldsPersisted = true;
    let hierarchyWarning: string | null = null;

    if (shouldClearUserPermissionOverrides) {
      const { error: clearPermissionsError } = await supabaseAdmin
        .from('user_module_permissions')
        .delete()
        .eq('user_id', userId);

      if (clearPermissionsError) {
        console.error('Permission override cleanup error:', clearPermissionsError);
        return NextResponse.json(
          { error: 'Failed to reset user permissions to team defaults' },
          { status: 500 }
        );
      }
    }

    let { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(hierarchyUpdatePayload)
      .eq('id', userId);

    if (profileError && isMissingHierarchySchemaError(profileError)) {
      hierarchyFieldsPersisted = false;
      hierarchyWarning = 'Hierarchy fields were ignored because the database schema is not ready yet.';
      const fallbackResult = await supabaseAdmin
        .from('profiles')
        .update(baseUpdatePayload)
        .eq('id', userId);
      profileError = fallbackResult.error;
    }

    if (profileError) {
      console.error('Profile update error:', profileError);
      return NextResponse.json(
        { error: 'Failed to update user profile' },
        { status: 500 }
      );
    }

    if (hierarchyFieldsPersisted) {
      try {
        await reconcileProfileHierarchy(supabaseAdmin, userId);
      } catch (error) {
        if (!isMissingTeamManagerSchemaError(error) && !isMissingHierarchySchemaError(error)) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to reconcile hierarchy assignments' },
            { status: 500 }
          );
        }
      }
    }

    // Send notification email if there were changes
    if (Object.keys(changes).length > 0 && notificationEmail) {
      const emailResult = await sendProfileUpdateEmail({
        to: notificationEmail,
        userName: full_name,
        changes,
      });

      if (!emailResult.success) {
        console.warn('Failed to send profile update notification:', emailResult.error);
        // Don't fail the update if email fails - just log it
      }
    }

    return NextResponse.json({
      success: true,
      message: 'User updated successfully',
      hierarchyFieldsPersisted,
      hierarchyWarning: hierarchyWarning || hierarchyValidation.warning || null,
    });
  } catch (error) {
    console.error('Error updating user:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/users/[id]',
      additionalData: {
        endpoint: '/api/admin/users/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check effective role (respects View As mode)
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const userId = (await params).id;

    // Prevent self-deletion
    if (userId === effectiveRole.user_id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    // Get deletion mode from query parameter (default: keep-data)
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'keep-data';

    const supabaseAdmin = getSupabaseAdmin();

    // Get user's current name for the "(Deleted User)" suffix
    const { data: userProfile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { data: targetProfileRole } = await supabaseAdmin
      .from('profiles')
      .select('role_id')
      .eq('id', userId)
      .single();

    if (targetProfileRole?.role_id) {
      const canManageTargetRole = await canEffectiveRoleAssignRole(targetProfileRole.role_id);
      if (!canManageTargetRole) {
        return NextResponse.json(
          { error: 'Forbidden: you cannot manage this user role' },
          { status: 403 }
        );
      }
    }

    if (mode === 'keep-data') {
      // MODE 1: Keep company data, only delete user account
      // Update user's name to mark as deleted (use admin client to bypass RLS)
      const deletedName = userProfile.full_name.includes('(Deleted User)') 
        ? userProfile.full_name 
        : `${userProfile.full_name} (Deleted User)`;

      await supabaseAdmin
        .from('profiles')
        .update({ full_name: deletedName })
        .eq('id', userId);

      // Nullify reviewer/assigner references (keeps audit trail of who created data)
      // Use admin client to bypass RLS policies
      await supabaseAdmin
        .from('timesheets')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      await supabaseAdmin
        .from('van_inspections')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      await supabaseAdmin
        .from('plant_inspections')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      await supabaseAdmin
        .from('timesheets')
        .update({ adjusted_by: null })
        .eq('adjusted_by', userId);

      await supabaseAdmin
        .from('actions')
        .update({ actioned_by: null })
        .eq('actioned_by', userId);

      // Disable the auth user (ban until far future) instead of deleting
      // This prevents cascade deletion of profile while making account inaccessible
      const farFuture = new Date('2099-12-31').toISOString();
      const banPayload = {
        banned_until: farFuture,
        user_metadata: {
          ...userProfile,
          deleted_at: new Date().toISOString(),
          account_status: 'deleted'
        }
      } as unknown as Parameters<typeof supabaseAdmin.auth.admin.updateUserById>[1];
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        ...banPayload
      });

      if (banError) {
        console.error('Error disabling user:', banError);
        return NextResponse.json(
          { error: `Failed to disable account: ${banError.message}` },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'User account deleted - company data preserved',
        mode: 'keep-data'
      });
    } else {
      // MODE 2: Delete all user data
      // Step 1: Handle foreign key references before deletion (use admin client to bypass RLS)
      // Set reviewed_by to NULL in timesheets where this user was the reviewer
      await supabaseAdmin
        .from('timesheets')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      // Set reviewed_by to NULL in inspections where this user was the reviewer
      await supabaseAdmin
        .from('van_inspections')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      await supabaseAdmin
        .from('plant_inspections')
        .update({ reviewed_by: null })
        .eq('reviewed_by', userId);

      // Set adjusted_by to NULL in timesheets if it exists
      await supabaseAdmin
        .from('timesheets')
        .update({ adjusted_by: null })
        .eq('adjusted_by', userId);

    // Step 2: Delete user's own records (use admin client)
    // First get all timesheet IDs for this user
    const { data: userTimesheets } = await supabaseAdmin
      .from('timesheets')
      .select('id')
      .eq('user_id', userId);

    // Delete timesheet entries (must delete before timesheets due to FK)
    if (userTimesheets && userTimesheets.length > 0) {
      const timesheetIds = userTimesheets.map(t => t.id);
      await supabaseAdmin
        .from('timesheet_entries')
        .delete()
        .in('timesheet_id', timesheetIds);
    }

    // Delete timesheets created by this user
    await supabaseAdmin
      .from('timesheets')
      .delete()
      .eq('user_id', userId);

    // Get all van inspection IDs for this user
    const { data: userVanInspections } = await supabaseAdmin
      .from('van_inspections')
      .select('id')
      .eq('user_id', userId);

    // Delete inspection items for van inspections (must delete before inspections due to FK)
    if (userVanInspections && userVanInspections.length > 0) {
      const vanInspectionIds = userVanInspections.map(i => i.id);
      await supabaseAdmin
        .from('inspection_items')
        .delete()
        .in('inspection_id', vanInspectionIds);
    }

    // Delete van inspections created by this user
    await supabaseAdmin
      .from('van_inspections')
      .delete()
      .eq('user_id', userId);

    // Get all plant inspection IDs for this user
    const { data: userPlantInspections } = await supabaseAdmin
      .from('plant_inspections')
      .select('id')
      .eq('user_id', userId);

    // Delete inspection items for plant inspections (must delete before inspections due to FK)
    if (userPlantInspections && userPlantInspections.length > 0) {
      const plantInspectionIds = userPlantInspections.map(i => i.id);
      await supabaseAdmin
        .from('inspection_items')
        .delete()
        .in('inspection_id', plantInspectionIds);
    }

    // Delete plant inspections created by this user
    await supabaseAdmin
      .from('plant_inspections')
      .delete()
      .eq('user_id', userId);

    // Delete or nullify actions
    await supabaseAdmin
      .from('actions')
      .delete()
      .eq('created_by', userId);

    await supabaseAdmin
      .from('actions')
      .update({ actioned_by: null })
      .eq('actioned_by', userId);

    // Delete absences
    await supabaseAdmin
      .from('absences')
      .delete()
      .eq('profile_id', userId);

    // Delete RAMS assignments
    await supabaseAdmin
      .from('rams_assignments')
      .delete()
      .eq('employee_id', userId);

    // Nullify audit log references
    await supabaseAdmin
      .from('audit_log')
      .update({ user_id: null })
      .eq('user_id', userId);

    // Nullify message references
    await supabaseAdmin
      .from('messages')
      .update({ sender_id: null })
      .eq('sender_id', userId);

    // Delete message recipients
    await supabaseAdmin
      .from('message_recipients')
      .delete()
      .eq('user_id', userId);

    // Step 3: Delete the profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileError) {
      console.error('Profile deletion error:', profileError);
      return NextResponse.json(
        { error: `Database error deleting user: ${profileError.message}` },
        { status: 500 }
      );
    }

    // Step 4: Delete the auth user last
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('Auth deletion error:', authError);
      return NextResponse.json(
        { error: `Failed to delete authentication: ${authError.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'User and all related data deleted successfully',
      mode: 'delete-all'
    });
  }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error deleting user:', errorMessage, error);
    return NextResponse.json(
      { error: `Internal server error: ${errorMessage}` }, 
      { status: 500 }
    );
  }
}

