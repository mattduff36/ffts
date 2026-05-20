import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PROFILE_HUB_PRD_EPIC_ID } from '@/lib/profile/epic';
import { canEditOwnBasicProfileFields } from '@/lib/profile/permissions';
import { buildFrequentQuickLinks, buildRecentQuickLinks } from '@/lib/profile/quick-links';
import { fetchCarryoverMapForFinancialYear, getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { getCurrentFinancialYear } from '@/lib/utils/date';
import type { ProfileOverviewPayload } from '@/types/profile';

interface InspectionRow {
  id: string;
  inspection_date: string;
  status: string;
}

interface InspectionItemSummaryRow {
  inspection_id: string | null;
}

interface WorkshopTaskSummaryRow {
  inspection_id: string | null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const { start, end } = getCurrentFinancialYear();
    const fyStartYear = start.getFullYear();
    const startIso = start.toISOString().split('T')[0];
    const endIso = end.toISOString().split('T')[0];

    const [
      { data: profile, error: profileError },
      { data: timesheets, error: timesheetsError },
      { data: absences, error: absencesError },
      { data: vanInspections, error: vanInspectionsError },
      { data: plantInspections, error: plantInspectionsError },
      { data: hgvInspections, error: hgvInspectionsError },
      { data: annualLeaveReasons, error: annualLeaveReasonsError },
      { data: visits, error: visitsError },
      carryoverByProfile,
    ] = await Promise.all([
      admin
        .from('profiles')
        .select(`
          id,
          full_name,
          phone_number,
          employee_id,
          avatar_url,
          must_change_password,
          annual_holiday_allowance_days,
          super_admin,
          team:org_teams!profiles_team_id_fkey(id, name),
          role:roles(name, display_name, role_class, is_manager_admin, is_super_admin)
        `)
        .eq('id', user.id)
        .single(),
      admin
        .from('timesheets')
        .select('id, week_ending, status')
        .eq('user_id', user.id)
        .order('week_ending', { ascending: false })
        .limit(3),
      admin
        .from('absences')
        .select('id, date, end_date, status, reason:absence_reasons(name)')
        .eq('profile_id', user.id)
        .gte('date', startIso)
        .lte('date', endIso)
        .order('date', { ascending: false })
        .limit(3),
      admin
        .from('van_inspections')
        .select('id, inspection_date, status')
        .eq('user_id', user.id)
        .order('inspection_date', { ascending: false })
        .limit(3),
      admin
        .from('plant_inspections')
        .select('id, inspection_date, status')
        .eq('user_id', user.id)
        .order('inspection_date', { ascending: false })
        .limit(3),
      admin
        .from('hgv_inspections')
        .select('id, inspection_date, status')
        .eq('user_id', user.id)
        .order('inspection_date', { ascending: false })
        .limit(3),
      admin
        .from('absence_reasons')
        .select('id')
        .ilike('name', 'annual leave')
        .order('name', { ascending: true }),
      admin
        .from('user_page_visits')
        .select('path, visited_at')
        .eq('user_id', user.id)
        .gte('visited_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order('visited_at', { ascending: false })
        .limit(500),
      fetchCarryoverMapForFinancialYear(admin, fyStartYear, [user.id]),
    ]);

    if (profileError) throw profileError;
    if (timesheetsError) throw timesheetsError;
    if (absencesError) throw absencesError;
    if (vanInspectionsError) throw vanInspectionsError;
    if (plantInspectionsError) throw plantInspectionsError;
    if (hgvInspectionsError) throw hgvInspectionsError;
    if (annualLeaveReasonsError) throw annualLeaveReasonsError;
    if (visitsError) throw visitsError;

    const profileRow = (profile || {}) as Record<string, unknown>;
    const teamValueRaw = profileRow.team;
    const roleValueRaw = profileRow.role;
    const teamValue =
      Array.isArray(teamValueRaw) ? (teamValueRaw[0] as Record<string, unknown> | undefined) || null : teamValueRaw;
    const roleValue =
      Array.isArray(roleValueRaw) ? (roleValueRaw[0] as Record<string, unknown> | undefined) || null : roleValueRaw;

    const typedProfile = {
      ...profileRow,
      team: teamValue,
      role: roleValue,
      email: user.email || null,
    };

    const allowance = getEffectiveAllowance(
      (profileRow.annual_holiday_allowance_days as number | null | undefined) ?? null,
      carryoverByProfile.get(user.id) || 0
    );

    const annualLeaveReasonIds = ((annualLeaveReasons || []) as Array<{ id?: string | null }>)
      .map((reason) => reason.id)
      .filter((id): id is string => Boolean(id));
    const annualRows = annualLeaveReasonIds.length > 0
      ? await admin
          .from('absences')
          .select('status, duration_days')
          .eq('profile_id', user.id)
          .in('reason_id', annualLeaveReasonIds)
          .gte('date', startIso)
          .lte('date', endIso)
      : { data: [], error: null };

    if (annualRows.error) throw annualRows.error;

    const approvedTaken = (annualRows.data || [])
      .filter((row) => row.status === 'approved' || row.status === 'processed')
      .reduce((sum, row) => sum + (row.duration_days || 0), 0);
    const pendingTotal = (annualRows.data || [])
      .filter((row) => row.status === 'pending')
      .reduce((sum, row) => sum + (row.duration_days || 0), 0);

    let mergedInspections = [
      ...((vanInspections || []) as InspectionRow[]).map((inspection) => ({
        ...inspection,
        inspectionType: 'van' as const,
        href: `/van-inspections/${inspection.id}`,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      })),
      ...((plantInspections || []) as InspectionRow[]).map((inspection) => ({
        ...inspection,
        inspectionType: 'plant' as const,
        href: `/plant-inspections/${inspection.id}`,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      })),
      ...((hgvInspections || []) as InspectionRow[]).map((inspection) => ({
        ...inspection,
        inspectionType: 'hgv' as const,
        href: `/hgv-inspections/${inspection.id}`,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      })),
    ]
      .sort((a, b) => new Date(b.inspection_date).getTime() - new Date(a.inspection_date).getTime())
      .slice(0, 3);

    const inspectionIds = mergedInspections.map((inspection) => inspection.id).filter(Boolean);
    if (inspectionIds.length > 0) {
      const [{ data: defectData, error: defectError }, { data: workshopTaskData, error: workshopTaskError }] =
        await Promise.all([
          admin
            .from('inspection_items')
            .select('inspection_id')
            .in('inspection_id', inspectionIds)
            .in('status', ['attention', 'defect']),
          admin
            .from('actions')
            .select('inspection_id')
            .in('inspection_id', inspectionIds)
            .eq('action_type', 'workshop_vehicle_task'),
        ]);

      if (!defectError) {
        const defectInspectionIds = new Set(
          ((defectData || []) as InspectionItemSummaryRow[])
            .map((row) => row.inspection_id)
            .filter((id): id is string => Boolean(id))
        );
        mergedInspections = mergedInspections.map((inspection) => ({
          ...inspection,
          has_reported_defect: defectInspectionIds.has(inspection.id),
        }));
      }

      if (!workshopTaskError) {
        const workshopInspectionIds = new Set(
          ((workshopTaskData || []) as WorkshopTaskSummaryRow[])
            .map((row) => row.inspection_id)
            .filter((id): id is string => Boolean(id))
        );
        mergedInspections = mergedInspections.map((inspection) => ({
          ...inspection,
          has_inform_workshop_task: workshopInspectionIds.has(inspection.id),
        }));
      }
    }

    const response: ProfileOverviewPayload = {
      prd_epic_id: PROFILE_HUB_PRD_EPIC_ID,
      profile: typedProfile as ProfileOverviewPayload['profile'],
      can_edit_basic_fields: canEditOwnBasicProfileFields(
        typedProfile as Parameters<typeof canEditOwnBasicProfileFields>[0]
      ),
      timesheets: (timesheets || []) as ProfileOverviewPayload['timesheets'],
      inspections: mergedInspections,
      absences: ((absences || []) as Array<Record<string, unknown>>).map((absence) => ({
        id: String(absence.id),
        date: String(absence.date),
        end_date: (absence.end_date as string | null) || null,
        status: absence.status as ProfileOverviewPayload['absences'][number]['status'],
        reason_name: String(
          (
            Array.isArray(absence.reason)
              ? (absence.reason[0] as { name?: string } | undefined)
              : (absence.reason as { name?: string } | null)
          )?.name || 'Unknown'
        ),
      })),
      annual_leave_summary: {
        allowance,
        approved_taken: approvedTaken,
        pending_total: pendingTotal,
        remaining: allowance - approvedTaken - pendingTotal,
      },
      quick_links: {
        recent: buildRecentQuickLinks((visits || []) as Array<{ path: string; visited_at: string }>, 5),
        frequent: buildFrequentQuickLinks((visits || []) as Array<{ path: string; visited_at: string }>, 5),
      },
    };

    return NextResponse.json({ success: true, ...response });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load profile overview' },
      { status: 500 }
    );
  }
}

