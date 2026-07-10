import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { ALL_MODULES, type ModuleName, type UpdateTeamPermissionsRequest } from '@/types/roles';
import { isMissingTeamPermissionSchemaError, updateTeamModulePermissions } from '@/lib/server/team-permissions';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const effectiveRole = await getEffectiveRole();
    const actorIsAdmin = hasEffectiveRoleFullAccess(effectiveRole);
    if (!actorIsAdmin) {
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 });
    }

    const { teamId } = await params;
    const body = (await request.json()) as UpdateTeamPermissionsRequest;
    if (!Array.isArray(body.permissions)) {
      return NextResponse.json({ error: 'Invalid request: permissions array required' }, { status: 400 });
    }

    const normalizedPermissions = body.permissions.filter(
      (permission): permission is { module_name: ModuleName; enabled: boolean } =>
        ALL_MODULES.includes(permission.module_name) && typeof permission.enabled === 'boolean'
    );

    if (normalizedPermissions.length !== body.permissions.length) {
      return NextResponse.json({ error: 'Invalid module permissions payload' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: team, error: teamError } = await admin
      .from('org_teams')
      .select('id')
      .eq('id', teamId)
      .single();

    if (teamError || !team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    await updateTeamModulePermissions(admin, teamId, normalizedPermissions);

    return NextResponse.json({
      success: true,
      message: 'Team permissions updated successfully',
    });
  } catch (error) {
    if (isMissingTeamPermissionSchemaError(error)) {
      return NextResponse.json(
        { error: 'Team permission matrix is not configured yet.' },
        { status: 501 }
      );
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/permissions/matrix/[teamId]',
      additionalData: {
        endpoint: '/api/admin/permissions/matrix/[teamId]',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
