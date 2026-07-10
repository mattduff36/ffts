import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import {
  ALL_MODULES,
  EDITABLE_PERMISSION_ACCESS_LEVELS,
  type ModuleName,
  type PermissionsAuditInfo,
  type PermissionsAuditModuleInfo,
  type PermissionAccessLevel,
  type UpdateUserPermissionLevelsRequest,
} from '@/types/roles';
import {
  getUserPermissionMatrix,
  InvalidPermissionLevelError,
  isMissingTeamPermissionSchemaError,
  updateTeamModulePermissionDefaults,
  updateUserModulePermissionLevels,
} from '@/lib/server/team-permissions';
import permissionsAudit from '@/lib/config/permissions-secondary-audit.json';

type RawAuditModule = {
  displayName?: string;
  moduleName?: string;
  matrixGate?: string;
  minimumRole?: string;
  byRole?: Record<string, string>;
};

function toAuditInfo(): PermissionsAuditInfo {
  const modules = ((permissionsAudit.modules || []) as RawAuditModule[])
    .filter((module): module is RawAuditModule & { moduleName: ModuleName } =>
      Boolean(module.moduleName && ALL_MODULES.includes(module.moduleName as ModuleName))
    )
    .map((module): PermissionsAuditModuleInfo => ({
      displayName: module.displayName || module.moduleName,
      moduleName: module.moduleName,
      matrixGate: module.matrixGate || '',
      minimumRole: module.minimumRole || '',
      byRole: module.byRole || {},
    }));

  return {
    title: permissionsAudit.title || 'Permissions Secondary Audit',
    auditDate: permissionsAudit.auditDate || '',
    matrixRule: permissionsAudit.matrixRule || '',
    modules,
    prdRelevantMismatches: permissionsAudit.prdRelevantMismatches || [],
  };
}

async function assertAdminPermission(): Promise<NextResponse | null> {
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

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const forbidden = await assertAdminPermission();
    if (forbidden) return forbidden;

    const matrix = await getUserPermissionMatrix(createAdminClient());
    return NextResponse.json({
      success: true,
      roles: matrix.roles,
      modules: matrix.modules,
      teams: matrix.teams,
      assignable_roles: matrix.assignableRoles,
      users: matrix.users,
      audit: toAuditInfo(),
    });
  } catch (error) {
    if (error instanceof InvalidPermissionLevelError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (isMissingTeamPermissionSchemaError(error)) {
      return NextResponse.json(
        { error: 'User permission level matrix is not configured yet.' },
        { status: 501 }
      );
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/permissions/users',
      additionalData: {
        endpoint: '/api/admin/permissions/users',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const forbidden = await assertAdminPermission();
    if (forbidden) return forbidden;

    const effectiveRole = await getEffectiveRole();
    const body = (await request.json()) as UpdateUserPermissionLevelsRequest;
    const updates = body.updates ?? [];
    const teamDefaultUpdates = body.team_default_updates ?? [];
    if (!Array.isArray(updates) || !Array.isArray(teamDefaultUpdates)) {
      return NextResponse.json({ error: 'Invalid request: updates arrays required' }, { status: 400 });
    }

    const normalizedUpdates = updates.filter(
      (update): update is { user_id: string; module_name: ModuleName; access_level: PermissionAccessLevel } =>
        typeof update.user_id === 'string' &&
        update.user_id.length > 0 &&
        ALL_MODULES.includes(update.module_name) &&
        EDITABLE_PERMISSION_ACCESS_LEVELS.includes(update.access_level)
    );

    const normalizedTeamDefaultUpdates = teamDefaultUpdates.filter(
      (update): update is { team_id: string; module_name: ModuleName; enabled: boolean } =>
        typeof update.team_id === 'string' &&
        update.team_id.length > 0 &&
        ALL_MODULES.includes(update.module_name) &&
        typeof update.enabled === 'boolean'
    );

    if (
      normalizedUpdates.length !== updates.length ||
      normalizedTeamDefaultUpdates.length !== teamDefaultUpdates.length
    ) {
      return NextResponse.json({ error: 'Invalid user permission level payload' }, { status: 400 });
    }

    const admin = createAdminClient();
    await updateTeamModulePermissionDefaults(admin, normalizedTeamDefaultUpdates, effectiveRole.user_id);
    await updateUserModulePermissionLevels(admin, normalizedUpdates, effectiveRole.user_id);

    return NextResponse.json({
      success: true,
      message: 'User permission levels updated successfully',
    });
  } catch (error) {
    if (error instanceof InvalidPermissionLevelError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (isMissingTeamPermissionSchemaError(error)) {
      return NextResponse.json(
        { error: 'User permission level matrix is not configured yet.' },
        { status: 501 }
      );
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/permissions/users',
      additionalData: {
        endpoint: '/api/admin/permissions/users',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
