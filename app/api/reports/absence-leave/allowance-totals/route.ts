import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActorAbsenceSecondaryPermissions, canActorUseScopedAbsencePermission } from '@/lib/server/absence-secondary-permissions';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { generateExcelFile, formatExcelDate } from '@/lib/utils/excel';
import { getFinancialYear } from '@/lib/utils/date';
import { fetchCarryoverMapForFinancialYear, getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { filterHiddenSystemTestAccounts } from '@/lib/utils/system-test-accounts';

interface ProfileReportRow {
  id: string;
  full_name?: string | null;
  employee_id?: string | null;
  team_id?: string | null;
  annual_holiday_allowance_days?: number | null;
}

interface ReasonRow {
  id: string;
  name?: string | null;
  is_paid?: boolean | null;
}

interface AbsenceAggregateRow {
  profile_id: string;
  reason_id?: string | null;
  status: string;
  duration_days?: number | null;
  date: string;
  end_date?: string | null;
  is_half_day?: boolean | null;
}

interface EmployeeSnapshotTotals {
  annualUsed: number;
  annualPending: number;
  paidTotal: number;
  unpaidTotal: number;
}

const ANNUAL_LEAVE_REASON_NAME = 'annual leave';

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getSafeEndDate(row: Pick<AbsenceAggregateRow, 'date' | 'end_date'>): string {
  return row.end_date || row.date;
}

function resolveDurationDays(row: AbsenceAggregateRow): number {
  if (typeof row.duration_days === 'number' && Number.isFinite(row.duration_days)) {
    return row.duration_days;
  }

  if (row.is_half_day) {
    return 0.5;
  }

  const start = new Date(`${row.date}T00:00:00`);
  const end = new Date(`${getSafeEndDate(row)}T00:00:00`);
  const millisPerDay = 24 * 60 * 60 * 1000;
  const computedDays = Math.floor((end.getTime() - start.getTime()) / millisPerDay) + 1;
  return Math.max(1, computedDays);
}

async function fetchAbsenceRowsForSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName: 'absences' | 'absences_archive',
  profileIds: string[],
  financialYearStartIso: string,
  snapshotDate: string
): Promise<AbsenceAggregateRow[]> {
  if (profileIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from(tableName)
    .select('profile_id, reason_id, status, duration_days, date, end_date, is_half_day')
    .in('profile_id', profileIds)
    .in('status', ['approved', 'processed', 'pending'])
    .gte('date', financialYearStartIso)
    .lte('date', snapshotDate);

  if (error) {
    throw error;
  }

  return (data || []) as AbsenceAggregateRow[];
}

function getEmptySnapshotTotals(): EmployeeSnapshotTotals {
  return {
    annualUsed: 0,
    annualPending: 0,
    paidTotal: 0,
    unpaidTotal: 0,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessReports = await canEffectiveRoleAccessModule('reports');
    if (!canAccessReports) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const canAccessAbsenceModule = await canEffectiveRoleAccessModule('absence');
    if (!canAccessAbsenceModule) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    if (!dateFrom || !dateTo || !isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
      return NextResponse.json({ error: 'Valid dateFrom and dateTo are required (YYYY-MM-DD)' }, { status: 400 });
    }

    const snapshotDate = dateFrom;
    const financialYear = getFinancialYear(new Date(`${snapshotDate}T00:00:00`));
    const financialYearStartIso = financialYear.start.toISOString().split('T')[0];
    const financialYearStartYear = financialYear.start.getFullYear();

    const scopeContext = await getReportScopeContext();

    let baseProfilesQuery = supabase
      .from('profiles')
      .select('id, full_name, employee_id, team_id, annual_holiday_allowance_days')
      .not('full_name', 'ilike', '%(Deleted User)%')
      .order('full_name', { ascending: true });

    if (!scopeContext.isAdminTier) {
      const moduleScopedProfileIds = await getScopedProfileIdsForModule('absence', scopeContext);
      if (moduleScopedProfileIds && moduleScopedProfileIds.size === 0) {
        return NextResponse.json({ error: 'No employees found for the selected criteria' }, { status: 404 });
      }

      const actorUserId = scopeContext.effectiveRole.user_id;
      if (!actorUserId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const actorAbsencePermissions = await getActorAbsenceSecondaryPermissions(actorUserId, {
        role: {
          name: scopeContext.effectiveRole.role_name,
          display_name: scopeContext.effectiveRole.display_name,
          role_class: scopeContext.effectiveRole.role_class,
          is_manager_admin: scopeContext.effectiveRole.is_manager_admin,
          is_super_admin: scopeContext.effectiveRole.is_super_admin,
        },
        team_id: scopeContext.effectiveRole.team_id,
        team_name: scopeContext.effectiveRole.team_name,
      });

      const canViewBookings = Boolean(
        actorAbsencePermissions.effective.see_bookings_all ||
          actorAbsencePermissions.effective.see_bookings_team ||
          actorAbsencePermissions.effective.see_bookings_own
      );
      if (!canViewBookings) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (moduleScopedProfileIds && moduleScopedProfileIds.size > 0) {
        baseProfilesQuery = baseProfilesQuery.in('id', Array.from(moduleScopedProfileIds));
      }

      const { data: profileRows, error: profileError } = await baseProfilesQuery;
      if (profileError) {
        throw profileError;
      }

      const scopedProfiles = filterHiddenSystemTestAccounts((profileRows || []) as ProfileReportRow[]).filter((profile) =>
        canActorUseScopedAbsencePermission({
          actorPermissions: actorAbsencePermissions,
          target: {
            profile_id: profile.id,
            team_id: profile.team_id || null,
          },
          allKey: 'see_bookings_all',
          teamKey: 'see_bookings_team',
          ownKey: 'see_bookings_own',
        })
      );

      if (scopedProfiles.length === 0) {
        return NextResponse.json({ error: 'No employees found for the selected criteria' }, { status: 404 });
      }

      const profileIds = scopedProfiles.map((profile) => profile.id);
      const [reasonRows, activeAbsences, archivedAbsences, carryoverByProfile] = await Promise.all([
        supabase.from('absence_reasons').select('id, name, is_paid').then(({ data, error }) => {
          if (error) throw error;
          return (data || []) as ReasonRow[];
        }),
        fetchAbsenceRowsForSnapshot(supabase, 'absences', profileIds, financialYearStartIso, snapshotDate),
        fetchAbsenceRowsForSnapshot(supabase, 'absences_archive', profileIds, financialYearStartIso, snapshotDate),
        fetchCarryoverMapForFinancialYear(supabase, financialYearStartYear, profileIds),
      ]);

      const annualLeaveReason = reasonRows.find(
        (reason) => reason.name?.trim().toLowerCase() === ANNUAL_LEAVE_REASON_NAME
      );
      const annualLeaveReasonId = annualLeaveReason?.id || null;
      const paidReasonIds = new Set(reasonRows.filter((reason) => reason.is_paid === true).map((reason) => reason.id));
      const allAbsences = [...activeAbsences, ...archivedAbsences];

      const totalsByProfile = new Map<string, EmployeeSnapshotTotals>();
      for (const absence of allAbsences) {
        const currentTotals = totalsByProfile.get(absence.profile_id) || getEmptySnapshotTotals();
        const durationDays = resolveDurationDays(absence);

        if (annualLeaveReasonId && absence.reason_id === annualLeaveReasonId) {
          if (absence.status === 'approved' || absence.status === 'processed') {
            currentTotals.annualUsed += durationDays;
          }
          if (absence.status === 'pending') {
            currentTotals.annualPending += durationDays;
          }
        }

        if (absence.status === 'approved' || absence.status === 'processed') {
          if (absence.reason_id && paidReasonIds.has(absence.reason_id)) {
            currentTotals.paidTotal += durationDays;
          } else {
            currentTotals.unpaidTotal += durationDays;
          }
        }

        totalsByProfile.set(absence.profile_id, currentTotals);
      }

      const excelData = scopedProfiles.map((profile) => {
        const totals = totalsByProfile.get(profile.id) || getEmptySnapshotTotals();
        const allowance = getEffectiveAllowance(
          profile.annual_holiday_allowance_days,
          carryoverByProfile.get(profile.id) || 0
        );
        const annualRemaining = allowance - totals.annualUsed - totals.annualPending;

        return {
          'Employee Name': profile.full_name || 'Unknown',
          'Employee ID': profile.employee_id || '-',
          'Team ID': profile.team_id || '-',
          'Snapshot Date': formatExcelDate(snapshotDate),
          'Financial Year': financialYear.label,
          'Annual Allowance (Days)': allowance.toFixed(1),
          'Annual Used (Days)': totals.annualUsed.toFixed(1),
          'Annual Pending (Days)': totals.annualPending.toFixed(1),
          'Annual Remaining (Days)': annualRemaining.toFixed(1),
          'Paid Total (Days)': totals.paidTotal.toFixed(1),
          'Unpaid Total (Days)': totals.unpaidTotal.toFixed(1),
        };
      });

      const summary = excelData.reduce(
        (accumulator, row) => ({
          allowance: accumulator.allowance + Number(row['Annual Allowance (Days)']),
          annualUsed: accumulator.annualUsed + Number(row['Annual Used (Days)']),
          annualPending: accumulator.annualPending + Number(row['Annual Pending (Days)']),
          annualRemaining: accumulator.annualRemaining + Number(row['Annual Remaining (Days)']),
          paidTotal: accumulator.paidTotal + Number(row['Paid Total (Days)']),
          unpaidTotal: accumulator.unpaidTotal + Number(row['Unpaid Total (Days)']),
        }),
        {
          allowance: 0,
          annualUsed: 0,
          annualPending: 0,
          annualRemaining: 0,
          paidTotal: 0,
          unpaidTotal: 0,
        }
      );

      excelData.push({
        'Employee Name': '',
        'Employee ID': '',
        'Team ID': '',
        'Snapshot Date': '',
        'Financial Year': '',
        'Annual Allowance (Days)': '',
        'Annual Used (Days)': '',
        'Annual Pending (Days)': '',
        'Annual Remaining (Days)': '',
        'Paid Total (Days)': '',
        'Unpaid Total (Days)': '',
      });

      excelData.push({
        'Employee Name': 'SUMMARY',
        'Employee ID': `${scopedProfiles.length} employees`,
        'Team ID': '',
        'Snapshot Date': formatExcelDate(snapshotDate),
        'Financial Year': financialYear.label,
        'Annual Allowance (Days)': summary.allowance.toFixed(1),
        'Annual Used (Days)': summary.annualUsed.toFixed(1),
        'Annual Pending (Days)': summary.annualPending.toFixed(1),
        'Annual Remaining (Days)': summary.annualRemaining.toFixed(1),
        'Paid Total (Days)': summary.paidTotal.toFixed(1),
        'Unpaid Total (Days)': summary.unpaidTotal.toFixed(1),
      });

      const buffer = await generateExcelFile([
        {
          sheetName: 'Allowance Snapshot',
          columns: [
            { header: 'Employee Name', key: 'Employee Name', width: 24 },
            { header: 'Employee ID', key: 'Employee ID', width: 14 },
            { header: 'Team ID', key: 'Team ID', width: 16 },
            { header: 'Snapshot Date', key: 'Snapshot Date', width: 14 },
            { header: 'Financial Year', key: 'Financial Year', width: 14 },
            { header: 'Annual Allowance (Days)', key: 'Annual Allowance (Days)', width: 20 },
            { header: 'Annual Used (Days)', key: 'Annual Used (Days)', width: 18 },
            { header: 'Annual Pending (Days)', key: 'Annual Pending (Days)', width: 20 },
            { header: 'Annual Remaining (Days)', key: 'Annual Remaining (Days)', width: 21 },
            { header: 'Paid Total (Days)', key: 'Paid Total (Days)', width: 16 },
            { header: 'Unpaid Total (Days)', key: 'Unpaid Total (Days)', width: 18 },
          ],
          data: excelData,
        },
      ]);

      const filename = `Absence_Allowance_Snapshot_${snapshotDate}.xlsx`;
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    const { data: profileRows, error: profileError } = await baseProfilesQuery;
    if (profileError) {
      throw profileError;
    }
    const allProfiles = filterHiddenSystemTestAccounts((profileRows || []) as ProfileReportRow[]);

    if (allProfiles.length === 0) {
      return NextResponse.json({ error: 'No employees found for the selected criteria' }, { status: 404 });
    }

    const allProfileIds = allProfiles.map((profile) => profile.id);
    const [reasonRows, activeAbsences, archivedAbsences, carryoverByProfile] = await Promise.all([
      supabase.from('absence_reasons').select('id, name, is_paid').then(({ data, error }) => {
        if (error) throw error;
        return (data || []) as ReasonRow[];
      }),
      fetchAbsenceRowsForSnapshot(supabase, 'absences', allProfileIds, financialYearStartIso, snapshotDate),
      fetchAbsenceRowsForSnapshot(supabase, 'absences_archive', allProfileIds, financialYearStartIso, snapshotDate),
      fetchCarryoverMapForFinancialYear(supabase, financialYearStartYear, allProfileIds),
    ]);

    const annualLeaveReason = reasonRows.find((reason) => reason.name?.trim().toLowerCase() === ANNUAL_LEAVE_REASON_NAME);
    const annualLeaveReasonId = annualLeaveReason?.id || null;
    const paidReasonIds = new Set(reasonRows.filter((reason) => reason.is_paid === true).map((reason) => reason.id));
    const allAbsences = [...activeAbsences, ...archivedAbsences];

    const totalsByProfile = new Map<string, EmployeeSnapshotTotals>();
    for (const absence of allAbsences) {
      const currentTotals = totalsByProfile.get(absence.profile_id) || getEmptySnapshotTotals();
      const durationDays = resolveDurationDays(absence);

      if (annualLeaveReasonId && absence.reason_id === annualLeaveReasonId) {
        if (absence.status === 'approved' || absence.status === 'processed') {
          currentTotals.annualUsed += durationDays;
        }
        if (absence.status === 'pending') {
          currentTotals.annualPending += durationDays;
        }
      }

      if (absence.status === 'approved' || absence.status === 'processed') {
        if (absence.reason_id && paidReasonIds.has(absence.reason_id)) {
          currentTotals.paidTotal += durationDays;
        } else {
          currentTotals.unpaidTotal += durationDays;
        }
      }

      totalsByProfile.set(absence.profile_id, currentTotals);
    }

    const excelData = allProfiles.map((profile) => {
      const totals = totalsByProfile.get(profile.id) || getEmptySnapshotTotals();
      const allowance = getEffectiveAllowance(
        profile.annual_holiday_allowance_days,
        carryoverByProfile.get(profile.id) || 0
      );
      const annualRemaining = allowance - totals.annualUsed - totals.annualPending;

      return {
        'Employee Name': profile.full_name || 'Unknown',
        'Employee ID': profile.employee_id || '-',
        'Team ID': profile.team_id || '-',
        'Snapshot Date': formatExcelDate(snapshotDate),
        'Financial Year': financialYear.label,
        'Annual Allowance (Days)': allowance.toFixed(1),
        'Annual Used (Days)': totals.annualUsed.toFixed(1),
        'Annual Pending (Days)': totals.annualPending.toFixed(1),
        'Annual Remaining (Days)': annualRemaining.toFixed(1),
        'Paid Total (Days)': totals.paidTotal.toFixed(1),
        'Unpaid Total (Days)': totals.unpaidTotal.toFixed(1),
      };
    });

    const summary = excelData.reduce(
      (accumulator, row) => ({
        allowance: accumulator.allowance + Number(row['Annual Allowance (Days)']),
        annualUsed: accumulator.annualUsed + Number(row['Annual Used (Days)']),
        annualPending: accumulator.annualPending + Number(row['Annual Pending (Days)']),
        annualRemaining: accumulator.annualRemaining + Number(row['Annual Remaining (Days)']),
        paidTotal: accumulator.paidTotal + Number(row['Paid Total (Days)']),
        unpaidTotal: accumulator.unpaidTotal + Number(row['Unpaid Total (Days)']),
      }),
      {
        allowance: 0,
        annualUsed: 0,
        annualPending: 0,
        annualRemaining: 0,
        paidTotal: 0,
        unpaidTotal: 0,
      }
    );

    excelData.push({
      'Employee Name': '',
      'Employee ID': '',
      'Team ID': '',
      'Snapshot Date': '',
      'Financial Year': '',
      'Annual Allowance (Days)': '',
      'Annual Used (Days)': '',
      'Annual Pending (Days)': '',
      'Annual Remaining (Days)': '',
      'Paid Total (Days)': '',
      'Unpaid Total (Days)': '',
    });

    excelData.push({
      'Employee Name': 'SUMMARY',
      'Employee ID': `${allProfiles.length} employees`,
      'Team ID': '',
      'Snapshot Date': formatExcelDate(snapshotDate),
      'Financial Year': financialYear.label,
      'Annual Allowance (Days)': summary.allowance.toFixed(1),
      'Annual Used (Days)': summary.annualUsed.toFixed(1),
      'Annual Pending (Days)': summary.annualPending.toFixed(1),
      'Annual Remaining (Days)': summary.annualRemaining.toFixed(1),
      'Paid Total (Days)': summary.paidTotal.toFixed(1),
      'Unpaid Total (Days)': summary.unpaidTotal.toFixed(1),
    });

    const buffer = await generateExcelFile([
      {
        sheetName: 'Allowance Snapshot',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 24 },
          { header: 'Employee ID', key: 'Employee ID', width: 14 },
          { header: 'Team ID', key: 'Team ID', width: 16 },
          { header: 'Snapshot Date', key: 'Snapshot Date', width: 14 },
          { header: 'Financial Year', key: 'Financial Year', width: 14 },
          { header: 'Annual Allowance (Days)', key: 'Annual Allowance (Days)', width: 20 },
          { header: 'Annual Used (Days)', key: 'Annual Used (Days)', width: 18 },
          { header: 'Annual Pending (Days)', key: 'Annual Pending (Days)', width: 20 },
          { header: 'Annual Remaining (Days)', key: 'Annual Remaining (Days)', width: 21 },
          { header: 'Paid Total (Days)', key: 'Paid Total (Days)', width: 16 },
          { header: 'Unpaid Total (Days)', key: 'Unpaid Total (Days)', width: 18 },
        ],
        data: excelData,
      },
    ]);

    const filename = `Absence_Allowance_Snapshot_${snapshotDate}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating absence allowance snapshot report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/absence-leave/allowance-totals',
      additionalData: {
        endpoint: '/api/reports/absence-leave/allowance-totals',
      },
    });

    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
