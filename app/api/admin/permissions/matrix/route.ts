import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { getTeamPermissionMatrix, isMissingTeamPermissionSchemaError } from '@/lib/server/team-permissions';

export async function GET(request: Request) {
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

    const matrix = await getTeamPermissionMatrix(createAdminClient());
    return NextResponse.json({
      success: true,
      roles: matrix.roles,
      modules: matrix.modules,
      teams: matrix.teams,
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
      componentName: '/api/admin/permissions/matrix',
      additionalData: {
        endpoint: '/api/admin/permissions/matrix',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
