import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getDidNotWorkReasonInfo } from '@/lib/utils/timesheetDidNotWork';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { buildSafeReportFilename, parseReportDateRange, validateRequiredReportDateRange } from '@/lib/server/report-date-range';
import { filterTimesheetRowsForReportScope } from '@/lib/server/reports-timesheet-scope';
import { loadEmployeeWorkShiftPatternMap } from '@/lib/server/work-shifts';
import { 
  generateExcelFile, 
  formatExcelDate, 
  formatExcelHours, 
  formatExcelStatus
} from '@/lib/utils/excel';
import type { ApprovedAbsenceForTimesheet } from '@/lib/utils/timesheet-off-days';
import { getTimesheetWeekIsoBounds, resolveTimesheetOffDayStates } from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, buildLeaveDaysBreakdown } from '@/lib/utils/timesheet-leave-totals';
import { normalizeTimesheetEntriesForDisplay } from '@/lib/utils/plant-timesheet-v2-normalization';
import { collectUniqueJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { isSubsistencePaymentRequired } from '@/lib/utils/timesheet-subsistence';
import type { TimesheetEntry } from '@/types/timesheet';
import type { WorkShiftPattern } from '@/types/work-shifts';

type AbsenceReasonRow = {
  is_paid?: boolean | null;
  name?: string | null;
};

interface AbsenceRow extends ApprovedAbsenceForTimesheet {
  profile_id: string;
  duration_days?: number | null;
  absence_reasons?: AbsenceReasonRow | null;
}

type TimesheetEntryRow = {
  day_of_week: number;
  time_started?: string | null;
  time_finished?: string | null;
  did_not_work?: boolean | null;
  working_in_yard?: boolean | null;
  subsistence_payment_required?: boolean | null;
  daily_total?: number | null;
  job_number?: string | null;
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }> | null;
  remarks?: string | null;
};

type EmployeeRow = {
  full_name?: string | null;
  employee_id?: string | null;
  team_id?: string | null;
};

type TimesheetRow = {
  user_id: string;
  week_ending: string;
  status: string;
  timesheet_type?: string | null;
  template_version?: number | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  employee?: EmployeeRow | null;
  timesheet_entries?: TimesheetEntryRow[] | null;
};

// Helper function to build timesheet query with filters
function buildTimesheetQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateFrom: string | null,
  dateTo: string | null,
  employeeId: string | null
) {
  let query = supabase
    .from('timesheets')
    .select(`
      id,
      week_ending,
      status,
      timesheet_type,
      template_version,
      submitted_at,
      reviewed_at,
      user_id,
      employee:profiles!timesheets_user_id_fkey (
        id,
        full_name,
        employee_id,
        team_id
      ),
      timesheet_entries (
        day_of_week,
        time_started,
        time_finished,
        daily_total,
        working_in_yard,
        subsistence_payment_required,
        did_not_work,
        job_number,
        timesheet_entry_job_codes (
          job_number,
          display_order
        ),
        remarks
      )
    `)
    .order('week_ending', { ascending: false });

  if (dateFrom) query = query.gte('week_ending', dateFrom);
  if (dateTo) query = query.lte('week_ending', dateTo);
  if (employeeId) query = query.eq('user_id', employeeId);

  return query;
}

// Helper function to build absence query with filters
function buildAbsenceQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateFrom: string | null,
  dateTo: string | null,
  employeeId: string | null
) {
  let query = supabase
    .from('absences')
    .select(`
      id,
      profile_id,
      date,
      end_date,
      is_half_day,
      half_day_session,
      allow_timesheet_work_on_leave,
      duration_days,
      status,
      absence_reasons (
        name,
        is_paid
      ),
      profiles (
        id,
        full_name,
        employee_id
      )
    `)
    .eq('status', 'approved');
  
  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo) query = query.lte('date', dateTo);
  if (employeeId) query = query.eq('profile_id', employeeId);
  
  return query;
}

// Helper function to group absences by employee
function groupAbsencesByEmployee(absences: AbsenceRow[]) {
  const absencesByEmployee = new Map<string, { paidDays: number; unpaidDays: number; reasons: string[]; rows: AbsenceRow[] }>();
  
  absences.forEach((absence) => {
    const employeeId = absence.profile_id;
    const isPaid = absence.absence_reasons?.is_paid || false;
    const days = absence.duration_days || 0;
    const reasonName = absence.absence_reasons?.name || 'Unknown';
    
    if (!absencesByEmployee.has(employeeId)) {
      absencesByEmployee.set(employeeId, { paidDays: 0, unpaidDays: 0, reasons: [], rows: [] });
    }
    
    const employeeAbsences = absencesByEmployee.get(employeeId)!;
    if (isPaid) {
      employeeAbsences.paidDays += days;
    } else {
      employeeAbsences.unpaidDays += days;
    }
    
    if (!employeeAbsences.reasons.includes(reasonName)) {
      employeeAbsences.reasons.push(reasonName);
    }
    employeeAbsences.rows.push(absence);
  });
  
  return absencesByEmployee;
}

// Helper function to transform timesheets to Excel rows
function transformTimesheetsToExcel(
  timesheets: TimesheetRow[],
  absencesByEmployee: Map<string, { paidDays: number; unpaidDays: number; reasons: string[]; rows: AbsenceRow[] }>,
  shiftPatternByEmployee: Map<string, WorkShiftPattern>
) {
  const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const excelData: Array<Record<string, string>> = [];

  timesheets.forEach((timesheet) => {
    const employee = timesheet.employee;
    const rawEntries = timesheet.timesheet_entries || [];
    const weekBounds = getTimesheetWeekIsoBounds(timesheet.week_ending);
    const employeeAbsenceState = absencesByEmployee.get(timesheet.user_id) || { paidDays: 0, unpaidDays: 0, reasons: [], rows: [] };
    const weekAbsences = employeeAbsenceState.rows.filter((absence) => {
      const absenceEnd = absence.end_date || absence.date;
      return absence.date <= weekBounds.endIso && absenceEnd >= weekBounds.startIso;
    });
    const offDayStates = resolveTimesheetOffDayStates(
      timesheet.week_ending,
      weekAbsences,
      shiftPatternByEmployee.get(timesheet.user_id) || null
    );
    const entries = normalizeTimesheetEntriesForDisplay(
      {
        timesheet_type: timesheet.timesheet_type ?? null,
        template_version: timesheet.template_version ?? null,
      },
      rawEntries as unknown as TimesheetEntry[],
      offDayStates
    );
    const sortedEntries = [...entries].sort((a, b) => a.day_of_week - b.day_of_week);
    const leaveAwareTotals = buildLeaveAwareTotals(
      entries.map((entry) => ({
        day_of_week: entry.day_of_week,
        daily_total: entry.daily_total ?? null,
      })),
      offDayStates
    );
    const leaveDaysBreakdown = buildLeaveDaysBreakdown(offDayStates);
    const totalHours = leaveAwareTotals.weekly.workedHours;

    const row: Record<string, string> = {
      'Employee Name': employee?.full_name || 'Unknown',
      'Employee ID': employee?.employee_id || '-',
      'Week Ending': formatExcelDate(timesheet.week_ending),
      'Status': formatExcelStatus(timesheet.status),
      'Total Hours': formatExcelHours(totalHours),
      'Leave Days': leaveDaysBreakdown.leaveDays > 0 ? leaveDaysBreakdown.leaveDays.toFixed(1) : '-',
      'Weekly Total (Hours + Days)': leaveAwareTotals.weekly.display,
    };

    const dnwDetails: string[] = [];
    const dnwReasons = new Set<string>();
    const subsistenceDetails: string[] = [];
    let dnwDays = 0;
    let subsistenceDays = 0;

    sortedEntries.forEach((entry) => {
      const dayName = DAY_NAMES[entry.day_of_week] || '';
      const day = dayName.substring(0, 3);
      const rowTotal = leaveAwareTotals.rowByDay.get(entry.day_of_week);

      if (rowTotal?.hasLeave) {
        row[`${day} Hours`] = rowTotal.display;
      } else if (entry.did_not_work) {
        const reasonInfo = getDidNotWorkReasonInfo(entry.did_not_work, entry.remarks);
        row[`${day} Hours`] = `DNW - ${reasonInfo.reasonDisplay}`;
        dnwDays += 1;

        if (reasonInfo.reasonDisplay) {
          dnwReasons.add(reasonInfo.reasonDisplay);
          dnwDetails.push(`${dayName}: ${reasonInfo.reasonDisplay}`);
        } else {
          dnwDetails.push(`${dayName}: Unknown`);
        }
      } else if (entry.working_in_yard) {
        row[`${day} Hours`] = `${formatExcelHours(rowTotal?.workedHours ?? entry.daily_total ?? null)} (Yard)`;
      } else {
        row[`${day} Hours`] = formatExcelHours(rowTotal?.workedHours ?? entry.daily_total ?? null);
      }

      if (!entry.did_not_work && isSubsistencePaymentRequired(entry)) {
        subsistenceDays += 1;
        subsistenceDetails.push(dayName);
      }
    });

    row['Job Numbers'] = collectUniqueJobNumbers(sortedEntries, {
      excludeDidNotWork: true,
      excludeWorkingInYard: true,
    }).join(', ') || '-';
    row['DNW Days'] = dnwDays > 0 ? String(dnwDays) : '-';
    row['DNW Reasons'] = dnwReasons.size > 0 ? [...dnwReasons].join(', ') : '-';
    row['DNW Details'] = dnwDetails.length > 0 ? dnwDetails.join('; ') : '-';
    row['Subsistence Days'] = subsistenceDays > 0 ? String(subsistenceDays) : '-';
    row['Subsistence Details'] = subsistenceDetails.length > 0 ? subsistenceDetails.join(', ') : '-';
    
    const employeeAbsences = absencesByEmployee.get(timesheet.user_id) || { paidDays: 0, unpaidDays: 0, reasons: [], rows: [] };
    row['Paid Absence (Days)'] = employeeAbsences.paidDays > 0 ? employeeAbsences.paidDays.toFixed(1) : '-';
    row['Unpaid Absence (Days)'] = employeeAbsences.unpaidDays > 0 ? employeeAbsences.unpaidDays.toFixed(1) : '-';
    row['Absence Reasons'] = employeeAbsences.reasons.join(', ') || '-';
    row['Submitted'] = timesheet.submitted_at ? formatExcelDate(timesheet.submitted_at) : '-';
    row['Reviewed'] = timesheet.reviewed_at ? formatExcelDate(timesheet.reviewed_at) : '-';

    excelData.push(row);
  });

  return excelData;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessReports = await canEffectiveRoleAccessModule('reports');
    if (!canAccessReports) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const canAccessTimesheets = await canEffectiveRoleAccessModule('timesheets');
    if (!canAccessTimesheets) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const { range, error: dateRangeError } = parseReportDateRange(searchParams);
    const requiredRangeError = validateRequiredReportDateRange(range, 366);
    if (dateRangeError || requiredRangeError || !range) {
      return NextResponse.json({ error: dateRangeError || requiredRangeError || 'Invalid date range.' }, { status: 400 });
    }
    const { dateFrom, dateTo } = range;
    const employeeId = searchParams.get('employeeId');

    // Fetch data
    const { data: timesheets, error } = await buildTimesheetQuery(supabase, dateFrom, dateTo, employeeId);
    const { data: absences, error: absenceError } = await buildAbsenceQuery(supabase, dateFrom, dateTo, employeeId);

    if (error) {
      console.error('Error fetching timesheets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (absenceError) {
      console.error('Error fetching absences:', absenceError);
    }

    const scopedTimesheets = await filterTimesheetRowsForReportScope((timesheets || []) as TimesheetRow[]);
    if (scopedTimesheets.length === 0) {
      return NextResponse.json({ error: 'No timesheets found for the specified criteria' }, { status: 404 });
    }

    const scopedEmployeeIds = new Set(scopedTimesheets.map((timesheet) => timesheet.user_id));
    const scopedAbsences = (absences || []).filter((absence) => scopedEmployeeIds.has(absence.profile_id)) as AbsenceRow[];
    const shiftPatternByEmployee = await loadEmployeeWorkShiftPatternMap(
      supabase,
      Array.from(scopedEmployeeIds),
      { ensureRecords: false }
    );

    // Process data
    const absencesByEmployee = groupAbsencesByEmployee(scopedAbsences);
    const excelData = transformTimesheetsToExcel(scopedTimesheets, absencesByEmployee, shiftPatternByEmployee);

    // Add totals
    const approvedTimesheets = excelData.filter(row => row['Status'] === 'Approved');
    if (approvedTimesheets.length > 0) {
      const totalHours = approvedTimesheets.reduce((sum, row) => sum + (parseFloat(row['Total Hours']) || 0), 0);
    const totalLeaveDays = approvedTimesheets.reduce((sum, row) => sum + (parseFloat(row['Leave Days']) || 0), 0);
      const totalSubsistenceDays = approvedTimesheets.reduce((sum, row) => sum + (parseFloat(row['Subsistence Days']) || 0), 0);

      excelData.push({
      'Employee Name': '', 'Employee ID': '', 'Week Ending': '', 'Status': '', 'Total Hours': '', 'Leave Days': '', 'Weekly Total (Hours + Days)': '',
        'Mon Hours': '', 'Tue Hours': '', 'Wed Hours': '', 'Thu Hours': '', 'Fri Hours': '', 'Sat Hours': '', 'Sun Hours': '',
        'Job Numbers': '', 'DNW Days': '', 'DNW Reasons': '', 'DNW Details': '', 'Subsistence Days': '', 'Subsistence Details': '', 'Paid Absence (Days)': '', 'Unpaid Absence (Days)': '', 'Absence Reasons': '', 'Submitted': '', 'Reviewed': '',
      });

      excelData.push({
        'Employee Name': 'TOTALS (Approved Only)', 'Employee ID': '', 'Week Ending': '',
      'Status': `${approvedTimesheets.length} timesheets`, 'Total Hours': totalHours.toFixed(2), 'Leave Days': totalLeaveDays.toFixed(1), 'Weekly Total (Hours + Days)': `${totalHours.toFixed(2)} hours + ${totalLeaveDays.toFixed(1)} days`,
        'Mon Hours': '', 'Tue Hours': '', 'Wed Hours': '', 'Thu Hours': '', 'Fri Hours': '', 'Sat Hours': '', 'Sun Hours': '',
        'Job Numbers': '', 'DNW Days': '', 'DNW Reasons': '', 'DNW Details': '', 'Subsistence Days': totalSubsistenceDays > 0 ? totalSubsistenceDays.toFixed(0) : '-', 'Subsistence Details': '', 'Paid Absence (Days)': '', 'Unpaid Absence (Days)': '', 'Absence Reasons': '', 'Submitted': '', 'Reviewed': '',
      });
    }

    // Generate Excel file
    const buffer = await generateExcelFile([{
      sheetName: 'Timesheet Summary',
      columns: [
        { header: 'Employee Name', key: 'Employee Name', width: 20 },
        { header: 'Employee ID', key: 'Employee ID', width: 12 },
        { header: 'Week Ending', key: 'Week Ending', width: 12 },
        { header: 'Status', key: 'Status', width: 10 },
        { header: 'Total Hours', key: 'Total Hours', width: 12 },
        { header: 'Leave Days', key: 'Leave Days', width: 12 },
        { header: 'Weekly Total (Hours + Days)', key: 'Weekly Total (Hours + Days)', width: 24 },
        { header: 'Mon Hours', key: 'Mon Hours', width: 12 },
        { header: 'Tue Hours', key: 'Tue Hours', width: 12 },
        { header: 'Wed Hours', key: 'Wed Hours', width: 12 },
        { header: 'Thu Hours', key: 'Thu Hours', width: 12 },
        { header: 'Fri Hours', key: 'Fri Hours', width: 12 },
        { header: 'Sat Hours', key: 'Sat Hours', width: 12 },
        { header: 'Sun Hours', key: 'Sun Hours', width: 12 },
        { header: 'Job Numbers', key: 'Job Numbers', width: 20 },
        { header: 'DNW Days', key: 'DNW Days', width: 10 },
        { header: 'DNW Reasons', key: 'DNW Reasons', width: 26 },
        { header: 'DNW Details', key: 'DNW Details', width: 40 },
        { header: 'Subsistence Days', key: 'Subsistence Days', width: 18 },
        { header: 'Subsistence Details', key: 'Subsistence Details', width: 30 },
        { header: 'Paid Absence (Days)', key: 'Paid Absence (Days)', width: 16 },
        { header: 'Unpaid Absence (Days)', key: 'Unpaid Absence (Days)', width: 18 },
        { header: 'Absence Reasons', key: 'Absence Reasons', width: 25 },
        { header: 'Submitted', key: 'Submitted', width: 12 },
        { header: 'Reviewed', key: 'Reviewed', width: 12 },
      ],
      data: excelData,
    }]);

    // Generate filename
    const filename = buildSafeReportFilename('Timesheet_Summary', range.filenameDateRange, 'xlsx');

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating timesheet summary:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/timesheets/summary',
      additionalData: { endpoint: '/api/reports/timesheets/summary' },
    });
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
