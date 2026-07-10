import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { closeCurrentFinancialYearBookings } from '@/lib/services/absence-bank-holiday-sync';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule, canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getProfileWithRole(user.id);
    const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
    const isManagerOrHigher = await canEffectiveRoleUseModuleLevel('absence', 4);
    if (!profile || !canAccessAbsence || !isManagerOrHigher) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or admin absence access required' },
        { status: 403 }
      );
    }

    const effectiveRole = await getEffectiveRole();
    const roleOverride =
      effectiveRole.user_id === user.id && (effectiveRole.role_name || effectiveRole.is_manager_admin || effectiveRole.is_super_admin)
        ? {
            name: effectiveRole.role_name,
            display_name: effectiveRole.display_name,
            role_class: effectiveRole.role_class,
            is_manager_admin: effectiveRole.is_manager_admin,
            is_super_admin: effectiveRole.is_super_admin,
          }
        : undefined;
    const secondary = await getActorAbsenceSecondaryPermissions(user.id, {
      role: roleOverride,
      ...(effectiveRole.user_id === user.id
        ? {
            team_id: effectiveRole.team_id,
            team_name: effectiveRole.team_name,
          }
        : {}),
    });
    const isAdmin = hasEffectiveRoleFullAccess(effectiveRole);
    if (!isAdmin && !secondary.effective.see_manage_overview_all) {
      return NextResponse.json(
        { error: 'Forbidden: Records & Admin ALL scope required' },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      notes?: string;
      financialYearStartYear?: number;
    };

    const result = await closeCurrentFinancialYearBookings({
      supabase,
      actorProfileId: profile.id,
      financialYearStartYear:
        typeof body.financialYearStartYear === 'number' ? body.financialYearStartYear : undefined,
      notes: body.notes,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message || 'Failed to close current year')
          : 'Failed to close current year';
    console.error('Error closing current financial year bookings:', error);
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
