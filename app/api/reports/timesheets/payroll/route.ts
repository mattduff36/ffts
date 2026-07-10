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
  formatExcelHours
} from '@/lib/utils/excel';
import type { ApprovedAbsenceForTimesheet } from '@/lib/utils/timesheet-off-days';
import { getTimesheetWeekIsoBounds, resolveTimesheetOffDayStates } from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, buildLeaveDaysBreakdown } from '@/lib/utils/timesheet-leave-totals';
import { normalizeTimesheetEntriesForDisplay } from '@/lib/utils/plant-timesheet-v2-normalization';
import { collectUniqueJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { isSubsistencePaymentRequired } from '@/lib/utils/timesheet-subsistence';
import type { TimesheetEntry } from '@/types/timesheet';

type AbsenceReasonRow = {
  name?: string | null;
  is_paid?: boolean | null;
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
  daily_total?: number | null;
  working_in_yard?: boolean | null;
  subsistence_payment_required?: boolean | null;
  did_not_work?: boolean | null;
  remarks?: string | null;
  job_number?: string | null;
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }> | null;
  night_shift?: boolean | null;
  bank_holiday?: boolean | null;
};

type EmployeeRow = {
  full_name?: string | null;
  employee_id?: string | null;
  team_id?: string | null;
};

type TimesheetRow = {
  user_id: string;
  week_ending: string;
  timesheet_type?: string | null;
  template_version?: number | null;
  reviewed_at?: string | null;
  employee?: EmployeeRow | null;
  timesheet_entries?: TimesheetEntryRow[] | null;
};

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

    // Build query for approved timesheets only
    let query = supabase
      .from('timesheets')
      .select(`
        id,
        week_ending,
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
          remarks,
          job_number,
          timesheet_entry_job_codes (
            job_number,
            display_order
          ),
          night_shift,
          bank_holiday
        )
      `)
      .eq('status', 'approved')
      .order('week_ending', { ascending: false });

    // Apply filters
    if (dateFrom) {
      query = query.gte('week_ending', dateFrom);
    }
    if (dateTo) {
      query = query.lte('week_ending', dateTo);
    }

    const { data: timesheets, error } = await query;

    // Fetch approved paid absences in the date range
    let absenceQuery = supabase
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

    // Apply date filters for absences
    if (dateFrom) {
      absenceQuery = absenceQuery.gte('date', dateFrom);
    }
    if (dateTo) {
      absenceQuery = absenceQuery.lte('date', dateTo);
    }

    const { data: absences, error: absenceError } = await absenceQuery;

    if (error) {
      console.error('Error fetching timesheets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (absenceError) {
      console.error('Error fetching absences:', absenceError);
      // Continue without absences rather than fail completely
    }

    const scopedTimesheets = await filterTimesheetRowsForReportScope((timesheets || []) as TimesheetRow[]);
    if (scopedTimesheets.length === 0) {
      return NextResponse.json({ error: 'No approved timesheets found for the specified criteria' }, { status: 404 });
    }

    const scopedEmployeeIds = new Set(scopedTimesheets.map((timesheet) => timesheet.user_id));
    const scopedAbsences = ((absences || []) as AbsenceRow[]).filter((absence) => scopedEmployeeIds.has(absence.profile_id));
    const employeeShiftPatternMap = await loadEmployeeWorkShiftPatternMap(
      supabase,
      Array.from(scopedEmployeeIds),
      { ensureRecords: false }
    );

    // Group absences by employee for easier lookup
    const absencesByEmployee = new Map<string, { paidDays: number; unpaidDays: number }>();
    const absenceRowsByEmployee = new Map<string, AbsenceRow[]>();

    if (scopedAbsences.length > 0) {
      scopedAbsences.forEach((absence) => {
        const employeeId = absence.profile_id;
        const isPaid = absence.absence_reasons?.is_paid || false;
        const days = absence.duration_days || 0;

        if (!absencesByEmployee.has(employeeId)) {
          absencesByEmployee.set(employeeId, { paidDays: 0, unpaidDays: 0 });
        }

        const employeeAbsences = absencesByEmployee.get(employeeId)!;
        if (isPaid) {
          employeeAbsences.paidDays += days;
        } else {
          employeeAbsences.unpaidDays += days;
        }

        const employeeRows = absenceRowsByEmployee.get(employeeId) || [];
        employeeRows.push(absence);
        absenceRowsByEmployee.set(employeeId, employeeRows);
      });
    }

    // Transform data for Excel - Payroll format
    const excelData: Array<Record<string, string>> = [];
    const dnwDetailsData: Array<Record<string, string>> = [];
    const dayNameMap: Record<number, string> = {
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday',
      7: 'Sunday',
    };

    scopedTimesheets.forEach((timesheet) => {
      const employee = timesheet.employee;
      const rawEntries = timesheet.timesheet_entries || [];
      const { startIso, endIso } = getTimesheetWeekIsoBounds(timesheet.week_ending);
      const employeeAbsenceRows = (absenceRowsByEmployee.get(timesheet.user_id) || []).filter((absence) => {
        const absenceEnd = absence.end_date || absence.date;
        return absence.date <= endIso && absenceEnd >= startIso;
      });
      const offDayStates = resolveTimesheetOffDayStates(
        timesheet.week_ending,
        employeeAbsenceRows,
        employeeShiftPatternMap.get(timesheet.user_id) || null
      );
      const entries = normalizeTimesheetEntriesForDisplay(
        {
          timesheet_type: timesheet.timesheet_type ?? null,
          template_version: timesheet.template_version ?? null,
        },
        rawEntries as unknown as TimesheetEntry[],
        offDayStates
      );
      const leaveAwareTotals = buildLeaveAwareTotals(
        entries.map((entry) => ({
          day_of_week: entry.day_of_week,
          daily_total: entry.daily_total ?? null,
        })),
        offDayStates
      );
      const leaveDaysBreakdown = buildLeaveDaysBreakdown(offDayStates);

      // Calculate hours by category based on new payroll rules:
      // - Mon-Fri: All hours at basic rate (no limit)
      // - Sat-Sun: 1.5x rate
      // - Night shifts: 2x rate
      // - Bank holidays: 2x rate

      let basicHours = 0; // Mon-Fri regular hours
      let overtime15Hours = 0; // Sat-Sun hours at 1.5x
      let overtime2Hours = 0; // Night shifts + Bank holidays at 2x
      let subsistenceDays = 0;
      const subsistenceDayNames: string[] = [];

      entries.forEach((entry) => {
        const dnwReason = getDidNotWorkReasonInfo(entry.did_not_work, entry.remarks);

        // Skip days not worked
        if (dnwReason.isDidNotWork) {
          dnwDetailsData.push({
            'Employee Name': employee?.full_name || 'Unknown',
            'Employee ID': employee?.employee_id || '-',
            'Week Ending': formatExcelDate(timesheet.week_ending),
            'Day': dayNameMap[entry.day_of_week] || String(entry.day_of_week),
            'DNW Category': dnwReason.category || '-',
            'DNW Remarks': dnwReason.remarks || '-',
            'DNW Reason': dnwReason.reasonDisplay || '-',
            'DNW Display': dnwReason.combinedDisplay || '-',
            'Approved Date': timesheet.reviewed_at ? formatExcelDate(timesheet.reviewed_at) : '-',
          });
          return;
        }

        const hours = leaveAwareTotals.rowByDay.get(entry.day_of_week)?.workedHours ?? (entry.daily_total ?? 0);
        const dayOfWeek = entry.day_of_week; // Integer: 1=Mon, 2=Tue, ..., 6=Sat, 7=Sun
        const isNightShift = entry.night_shift || false;
        const isBankHoliday = entry.bank_holiday || false;
        if (isSubsistencePaymentRequired(entry)) {
          subsistenceDays += 1;
          subsistenceDayNames.push(dayNameMap[dayOfWeek] || String(dayOfWeek));
        }

        // Priority: Night shift or Bank Holiday takes precedence (2x rate)
        if (isNightShift || isBankHoliday) {
          overtime2Hours += hours;
        }
        // Weekend work (Sat/Sun) at 1.5x rate - day 6 = Saturday, day 7 = Sunday
        else if (dayOfWeek === 6 || dayOfWeek === 7) {
          overtime15Hours += hours;
        }
        // Mon-Fri at basic rate (all hours, no cap) - days 1-5
        else {
          basicHours += hours;
        }
      });

      const totalHours = basicHours + overtime15Hours + overtime2Hours;

      // Get absence data for this employee
      const employeeAbsences = absencesByEmployee.get(timesheet.user_id) || { paidDays: 0, unpaidDays: 0 };
      const paidAbsenceHours = employeeAbsences.paidDays > 0 ? Number((employeeAbsences.paidDays * 9).toFixed(2)) : null;
      const unpaidAbsenceHours = employeeAbsences.unpaidDays > 0 ? Number((employeeAbsences.unpaidDays * 9).toFixed(2)) : null;

      excelData.push({
        'Employee Name': employee?.full_name || 'Unknown',
        'Employee ID': employee?.employee_id || '-',
        'Week Ending': formatExcelDate(timesheet.week_ending),
        'Job Numbers': collectUniqueJobNumbers(entries, {
          excludeDidNotWork: true,
          excludeWorkingInYard: true,
        }).join(', ') || '-',
        'Basic Hours (Mon-Fri)': formatExcelHours(basicHours),
        'Overtime 1.5x (Weekend)': formatExcelHours(overtime15Hours),
        'Overtime 2x (Night/Bank Holiday)': formatExcelHours(overtime2Hours),
        'Worked Hours': formatExcelHours(leaveAwareTotals.weekly.workedHours),
        'Leave Days': leaveDaysBreakdown.leaveDays > 0 ? leaveDaysBreakdown.leaveDays.toFixed(1) : '-',
        'Paid Absence (Days)': leaveDaysBreakdown.paidLeaveDays > 0 ? leaveDaysBreakdown.paidLeaveDays.toFixed(1) : '-',
        'Unpaid Absence (Days)': leaveDaysBreakdown.unpaidLeaveDays > 0 ? leaveDaysBreakdown.unpaidLeaveDays.toFixed(1) : '-',
        'Weekly Total (Hours + Days)': leaveAwareTotals.weekly.display,
        'Subsistence Days': subsistenceDays > 0 ? String(subsistenceDays) : '-',
        'Subsistence Dates': subsistenceDayNames.join(', ') || '-',
        'Paid Absence Hours': formatExcelHours(paidAbsenceHours),
        'Unpaid Absence Hours': formatExcelHours(unpaidAbsenceHours),
        'Total Hours': formatExcelHours(totalHours),
        'Approved Date': timesheet.reviewed_at ? formatExcelDate(timesheet.reviewed_at) : '-',
      });
    });

    // Add summary totals
    const totalBasic = excelData.reduce((sum, row) => sum + (parseFloat(row['Basic Hours (Mon-Fri)']) || 0), 0);
    const totalOvertime15 = excelData.reduce((sum, row) => sum + (parseFloat(row['Overtime 1.5x (Weekend)']) || 0), 0);
    const totalOvertime2 = excelData.reduce((sum, row) => sum + (parseFloat(row['Overtime 2x (Night/Bank Holiday)']) || 0), 0);
    const totalWorkedHours = excelData.reduce((sum, row) => sum + (parseFloat(row['Worked Hours']) || 0), 0);
    const totalLeaveDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Leave Days']) || 0), 0);
    const totalPaidDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Paid Absence (Days)']) || 0), 0);
    const totalUnpaidDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Unpaid Absence (Days)']) || 0), 0);
    const totalPaidAbsence = excelData.reduce((sum, row) => sum + (parseFloat(row['Paid Absence Hours']) || 0), 0);
    const totalUnpaidAbsence = excelData.reduce((sum, row) => sum + (parseFloat(row['Unpaid Absence Hours']) || 0), 0);
    const totalSubsistenceDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Subsistence Days']) || 0), 0);
    const totalHours = excelData.reduce((sum, row) => sum + (parseFloat(row['Total Hours']) || 0), 0);

    excelData.push({
      'Employee Name': '',
      'Employee ID': '',
      'Week Ending': '',
      'Job Numbers': '',
      'Basic Hours (Mon-Fri)': '',
      'Overtime 1.5x (Weekend)': '',
      'Overtime 2x (Night/Bank Holiday)': '',
      'Worked Hours': '',
      'Leave Days': '',
      'Paid Absence (Days)': '',
      'Unpaid Absence (Days)': '',
      'Weekly Total (Hours + Days)': '',
      'Subsistence Days': '',
      'Subsistence Dates': '',
      'Paid Absence Hours': '',
      'Unpaid Absence Hours': '',
      'Total Hours': '',
      'Approved Date': '',
    });

    excelData.push({
      'Employee Name': 'TOTALS',
      'Employee ID': `${scopedTimesheets.length} timesheets`,
      'Week Ending': '',
      'Basic Hours (Mon-Fri)': totalBasic.toFixed(2),
      'Overtime 1.5x (Weekend)': totalOvertime15.toFixed(2),
      'Overtime 2x (Night/Bank Holiday)': totalOvertime2.toFixed(2),
      'Worked Hours': totalWorkedHours.toFixed(2),
      'Leave Days': totalLeaveDays.toFixed(1),
      'Paid Absence (Days)': totalPaidDays.toFixed(1),
      'Unpaid Absence (Days)': totalUnpaidDays.toFixed(1),
      'Weekly Total (Hours + Days)': `${totalWorkedHours.toFixed(2)} hours + ${totalLeaveDays.toFixed(1)} days`,
      'Subsistence Days': totalSubsistenceDays > 0 ? totalSubsistenceDays.toFixed(0) : '-',
      'Subsistence Dates': '',
      'Paid Absence Hours': totalPaidAbsence.toFixed(2),
      'Unpaid Absence Hours': totalUnpaidAbsence.toFixed(2),
      'Total Hours': totalHours.toFixed(2),
      'Approved Date': '',
    });

    if (dnwDetailsData.length === 0) {
      dnwDetailsData.push({
        'Employee Name': '-',
        'Employee ID': '-',
        'Week Ending': '-',
        'Day': '-',
        'DNW Category': '-',
        'DNW Remarks': '-',
        'DNW Reason': '-',
        'DNW Display': '-',
        'Approved Date': '-',
      });
    }

    // Generate Excel file
    const buffer = await generateExcelFile([
      {
        sheetName: 'Payroll Report',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Week Ending', key: 'Week Ending', width: 12 },
          { header: 'Basic Hours (Mon-Fri)', key: 'Basic Hours (Mon-Fri)', width: 18 },
          { header: 'Overtime 1.5x (Weekend)', key: 'Overtime 1.5x (Weekend)', width: 20 },
          { header: 'Overtime 2x (Night/Bank Holiday)', key: 'Overtime 2x (Night/Bank Holiday)', width: 26 },
          { header: 'Worked Hours', key: 'Worked Hours', width: 14 },
          { header: 'Leave Days', key: 'Leave Days', width: 12 },
          { header: 'Paid Absence (Days)', key: 'Paid Absence (Days)', width: 18 },
          { header: 'Unpaid Absence (Days)', key: 'Unpaid Absence (Days)', width: 20 },
          { header: 'Weekly Total (Hours + Days)', key: 'Weekly Total (Hours + Days)', width: 26 },
          { header: 'Subsistence Days', key: 'Subsistence Days', width: 18 },
          { header: 'Subsistence Dates', key: 'Subsistence Dates', width: 30 },
          { header: 'Paid Absence Hours', key: 'Paid Absence Hours', width: 18 },
          { header: 'Unpaid Absence Hours', key: 'Unpaid Absence Hours', width: 20 },
          { header: 'Total Hours', key: 'Total Hours', width: 12 },
          { header: 'Approved Date', key: 'Approved Date', width: 14 },
        ],
        data: excelData,
      },
      {
        sheetName: 'Did Not Work Details',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Week Ending', key: 'Week Ending', width: 12 },
          { header: 'Day', key: 'Day', width: 12 },
          { header: 'DNW Category', key: 'DNW Category', width: 14 },
          { header: 'DNW Remarks', key: 'DNW Remarks', width: 30 },
          { header: 'DNW Reason', key: 'DNW Reason', width: 30 },
          { header: 'DNW Display', key: 'DNW Display', width: 42 },
          { header: 'Approved Date', key: 'Approved Date', width: 14 },
        ],
        data: dnwDetailsData,
      },
    ]);

    // Generate filename
    const filename = buildSafeReportFilename('Payroll_Report', range.filenameDateRange, 'xlsx');

    // Return Excel file
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating payroll report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/timesheets/payroll',
      additionalData: {
        endpoint: '/api/reports/timesheets/payroll',
      },
    });
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
