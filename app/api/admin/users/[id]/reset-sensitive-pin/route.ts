import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { adminResetSensitivePin } from '@/lib/server/sensitive-pin';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const userId = (await params).id;
    const supabase = await createClient();
    const { data: targetProfile, error: profileError } = await supabase
      .from('profiles')
      .select('role_id')
      .eq('id', userId)
      .single();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (targetProfile.role_id) {
      const canManageTargetRole = await canEffectiveRoleAssignRole(targetProfile.role_id);
      if (!canManageTargetRole) {
        return NextResponse.json(
          { error: 'Forbidden: you cannot reset sensitive PIN for this role' },
          { status: 403 }
        );
      }
    }

    await adminResetSensitivePin({
      actorProfileId: current.profile.id,
      targetProfileId: userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/users/[id]/reset-sensitive-pin',
      additionalData: {
        endpoint: '/api/admin/users/[id]/reset-sensitive-pin',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
