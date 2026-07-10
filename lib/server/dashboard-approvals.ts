import type { SupabaseClient } from '@supabase/supabase-js';
import { canActorUseScopedAbsencePermission, getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { getApprovalsDefaultStatusFilters } from '@/lib/utils/approvals-filters';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { hasAccountsTimesheetFullVisibilityOverride } from '@/lib/utils/timesheet-visibility';
import type { Database } from '@/types/database';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';

interface DashboardApprovalTimesheetRow {
  id: string;
  status: string | null;
  user_id: string;
  employee?: { team_id?: string | null } | Array<{ team_id?: string | null }> | null;
}

interface DashboardApprovalAbsenceRow {
  id: string;
  status: string | null;
  profile_id: string;
  employee?: { team_id?: string | null } | Array<{ team_id?: string | null }> | null;
}

export interface DashboardApprovalsMetrics {
  summaryTimesheets: number;
  summaryAbsences: number;
  tileTotal: number;
}

function getRelatedTeamId(
  relation: { team_id?: string | null } | Array<{ team_id?: string | null }> | null | undefined
): string | null {
  if (!relation) return null;
  if (Array.isArray(relation)) {
    return relation[0]?.team_id || null;
  }

  return relation.team_id || null;
}

function countRowsWithStatus<T extends { status: string | null }>(rows: T[], status: string): number {
  return rows.reduce((total, row) => total + (row.status === status ? 1 : 0), 0);
}

function getApprovalTileStatuses(teamName: string | null | undefined): {
  timesheetStatus: 'submitted' | 'approved';
  absenceStatus: 'pending' | 'approved';
} {
  const defaultFilters = getApprovalsDefaultStatusFilters(teamName);

  return {
    timesheetStatus: defaultFilters.timesheets === 'approved' ? 'approved' : 'submitted',
    absenceStatus: defaultFilters.absences === 'approved' ? 'approved' : 'pending',
  };
}

export async function getDashboardApprovalsMetrics(params: {
  supabase: SupabaseClient<Database>;
  actorProfileId: string;
  effectiveRole: EffectiveRoleInfo;
}): Promise<DashboardApprovalsMetrics> {
  const { supabase, actorProfileId, effectiveRole } = params;
  if (!actorProfileId) {
    return {
      summaryTimesheets: 0,
      summaryAbsences: 0,
      tileTotal: 0,
    };
  }

  const hasAccountsVisibilityOverride = hasAccountsTimesheetFullVisibilityOverride(
    effectiveRole.role_name,
    effectiveRole.team_name
  );
  const isAdminTier = hasEffectiveRoleFullAccess(effectiveRole) || hasAccountsVisibilityOverride;
  const actorPermissions = await getActorAbsenceSecondaryPermissions(actorProfileId, {
    role: {
      name: effectiveRole.role_name,
      display_name: effectiveRole.display_name,
      role_class: effectiveRole.role_class,
      is_manager_admin: effectiveRole.is_manager_admin,
      is_super_admin: effectiveRole.is_super_admin,
    },
    team_id: effectiveRole.team_id,
    team_name: effectiveRole.team_name,
  });
  const canAuthoriseBookings = Boolean(
    actorPermissions.effective.authorise_bookings_all ||
      actorPermissions.effective.authorise_bookings_team ||
      actorPermissions.effective.authorise_bookings_own
  );

  if (!isAdminTier && !canAuthoriseBookings) {
    return {
      summaryTimesheets: 0,
      summaryAbsences: 0,
      tileTotal: 0,
    };
  }

  const tileStatuses = getApprovalTileStatuses(effectiveRole.team_name);
  const timesheetStatusesToLoad: ReadonlyArray<'submitted' | 'approved'> =
    tileStatuses.timesheetStatus === 'approved' ? ['submitted', 'approved'] : ['submitted'];
  const absenceStatusesToLoad: ReadonlyArray<'pending' | 'approved'> =
    tileStatuses.absenceStatus === 'approved' ? ['pending', 'approved'] : ['pending'];

  const [timesheetsResult, absencesResult] = await Promise.all([
    supabase
      .from('timesheets')
      .select('id, status, user_id, employee:profiles!timesheets_user_id_fkey(team_id)')
      .in('status', timesheetStatusesToLoad),
    supabase
      .from('absences')
      .select('id, status, profile_id, employee:profiles!absences_profile_id_fkey(team_id)')
      .in('status', absenceStatusesToLoad),
  ]);

  if (timesheetsResult.error) throw timesheetsResult.error;
  if (absencesResult.error) throw absencesResult.error;

  const scopedTimesheets = ((timesheetsResult.data || []) as DashboardApprovalTimesheetRow[]).filter((row) => {
    if (isAdminTier) return true;

    return canActorUseScopedAbsencePermission({
      actorPermissions,
      target: {
        profile_id: row.user_id,
        team_id: getRelatedTeamId(row.employee),
      },
      allKey: 'authorise_bookings_all',
      teamKey: 'authorise_bookings_team',
      ownKey: 'authorise_bookings_own',
    });
  });

  const scopedAbsences = ((absencesResult.data || []) as DashboardApprovalAbsenceRow[]).filter((row) => {
    if (isAdminTier) return true;

    return canActorUseScopedAbsencePermission({
      actorPermissions,
      target: {
        profile_id: row.profile_id,
        team_id: getRelatedTeamId(row.employee),
      },
      allKey: 'authorise_bookings_all',
      teamKey: 'authorise_bookings_team',
      ownKey: 'authorise_bookings_own',
    });
  });

  return {
    summaryTimesheets: countRowsWithStatus(scopedTimesheets, tileStatuses.timesheetStatus),
    summaryAbsences: countRowsWithStatus(scopedAbsences, tileStatuses.absenceStatus),
    tileTotal:
      countRowsWithStatus(scopedTimesheets, tileStatuses.timesheetStatus) +
      countRowsWithStatus(scopedAbsences, tileStatuses.absenceStatus),
  };
}
