import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { ALL_MODULES, type ModuleName, type ShiftPermissionModuleRequest } from '@/types/roles';
import {
  isMissingTeamPermissionSchemaError,
  shiftPermissionModuleTier,
  updatePermissionModuleSensitivePinRequirement,
} from '@/lib/server/team-permissions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ moduleName: string }> }
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

    const { moduleName } = await params;
    if (!ALL_MODULES.includes(moduleName as ModuleName)) {
      return NextResponse.json({ error: 'Unknown module' }, { status: 404 });
    }

    const body = (await request.json()) as ShiftPermissionModuleRequest;
    if (typeof body.requires_sensitive_pin === 'boolean') {
      const updatedModule = await updatePermissionModuleSensitivePinRequirement(
        createAdminClient(),
        moduleName as ModuleName,
        body.requires_sensitive_pin
      );

      return NextResponse.json({
        success: true,
        module: updatedModule,
      });
    }

    if (body.direction !== 'left' && body.direction !== 'right') {
      return NextResponse.json(
        { error: 'Direction must be left or right, or requires_sensitive_pin must be boolean' },
        { status: 400 }
      );
    }

    const updatedModule = await shiftPermissionModuleTier(
      createAdminClient(),
      moduleName as ModuleName,
      body.direction
    );

    return NextResponse.json({
      success: true,
      module: updatedModule,
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
      componentName: '/api/admin/permissions/modules/[moduleName]',
      additionalData: {
        endpoint: '/api/admin/permissions/modules/[moduleName]',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
