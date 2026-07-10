import { calculateHours } from '@/lib/utils/time-calculations';
import { getEntryJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { syncSubsistenceRemark } from '@/lib/utils/timesheet-subsistence';
import { getWorkingSessionsForDate } from '@/lib/utils/work-shifts';
import type { WorkShiftPattern } from '@/types/work-shifts';

export type TimesheetDidNotWorkReason = 'Holiday' | 'Sickness' | 'Off Shift' | 'Other';
export type LeaveSession = 'AM' | 'PM';
export const PAID_LEAVE_DAILY_HOURS = 9;
const PAID_LEAVE_HALF_DAY_HOURS = PAID_LEAVE_DAILY_HOURS / 2;

export interface ApprovedAbsenceForTimesheet {
  id?: string;
  date: string;
  end_date: string | null;
  status?: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled' | string | null;
  is_half_day?: boolean | null;
  half_day_session?: LeaveSession | null;
  allow_timesheet_work_on_leave?: boolean | null;
  absence_reasons?: { name?: string | null; color?: string | null; is_paid?: boolean | null } | null;
}

export interface TimesheetLeaveLabel {
  absenceId: string | null;
  reasonName: string;
  label: string;
  session: LeaveSession | 'FULL';
  color: string | null;
  isPaid: boolean;
  isTraining: boolean;
  isPending: boolean;
  blocksWorkingEntry: boolean;
}

export interface TimesheetWorkWindow {
  start: string;
  end: string;
}

export interface TimesheetOffDayState {
  day_of_week: number;
  date: string;
  isExpectedShiftDay: boolean;
  isOnApprovedLeave: boolean;
  isLeaveLocked: boolean;
  isPartialLeave: boolean;
  hasAmLeave: boolean;
  hasPmLeave: boolean;
  workWindow: TimesheetWorkWindow | null;
  paidLeaveHours: number;
  leaveLabels: TimesheetLeaveLabel[];
  trainingLabels: TimesheetLeaveLabel[];
  pendingTrainingLabels: TimesheetLeaveLabel[];
  hasTrainingBooking: boolean;
  hasPendingTrainingBooking: boolean;
  trainingAbsenceIds: string[];
  pendingTrainingAbsenceIds: string[];
  trainingDisplayRemarks: string;
  pendingTrainingDisplayRemarks: string;
  displayRemarks: string;
  leaveReasonName: string | null;
  leaveReasonColor: string | null;
  trainingReasonColor: string | null;
  isAnnualLeave: boolean;
}

export interface TimesheetEntryLike {
  day_of_week: number;
  time_started: string;
  time_finished: string;
  job_number: string;
  job_numbers?: string[];
  working_in_yard: boolean;
  subsistence_payment_required?: boolean;
  did_not_work: boolean;
  didNotWorkReason: TimesheetDidNotWorkReason | null;
  daily_total: number | null;
  remarks: string;
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeReasonName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function isTrainingReasonName(value: string | null | undefined): boolean {
  return normalizeReasonName(value) === 'training';
}

function parseDidNotWorkReason(value: string | null | undefined): TimesheetDidNotWorkReason {
  const normalized = normalizeReasonName(value);
  if (normalized.startsWith('annual leave') || normalized === 'holiday') return 'Holiday';
  if (normalized.startsWith('sickness') || normalized.startsWith('sick')) return 'Sickness';
  if (normalized === 'not on shift' || normalized === 'off shift' || normalized === 'off') return 'Off Shift';
  return 'Other';
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasExplicitWorkingInput(entry: TimesheetEntryLike): boolean {
  return Boolean(
    (entry.time_started && entry.time_started.trim()) ||
      (entry.time_finished && entry.time_finished.trim()) ||
      getEntryJobNumbers(entry).length > 0 ||
      entry.working_in_yard
  );
}

function toMinutes(time: string): number | null {
  if (!time || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

export function isWorkWindowOvernight(window: TimesheetWorkWindow | null): boolean {
  if (!window) return false;
  const min = toMinutes(window.start);
  const max = toMinutes(window.end);
  if (min === null || max === null) return false;
  return max < min;
}

export function isTimeWithinWorkWindow(time: string, window: TimesheetWorkWindow | null): boolean {
  if (!window || !time) return true;
  const minutes = toMinutes(time);
  const min = toMinutes(window.start);
  const max = toMinutes(window.end);
  if (minutes === null || min === null || max === null) return false;
  if (max < min) {
    // Overnight window, e.g. 17:00 -> 05:00.
    return minutes >= min || minutes <= max;
  }
  return minutes >= min && minutes <= max;
}

export function getTimesheetEntryDateFromWeekEnding(weekEnding: string, dayOfWeek: number): Date {
  const safeDay = Math.min(7, Math.max(1, dayOfWeek));
  const weekEndingDate = new Date(`${weekEnding}T00:00:00`);
  const entryDate = new Date(weekEndingDate);

  // week_ending is Sunday and day_of_week is 1-7 (Monday-Sunday)
  entryDate.setDate(weekEndingDate.getDate() - (7 - safeDay));

  return entryDate;
}

export function getTimesheetWeekIsoBounds(weekEnding: string): { startIso: string; endIso: string } {
  const start = getTimesheetEntryDateFromWeekEnding(weekEnding, 1);
  const end = getTimesheetEntryDateFromWeekEnding(weekEnding, 7);
  return {
    startIso: formatLocalIsoDate(start),
    endIso: formatLocalIsoDate(end),
  };
}

function computeWorkedHours(entry: TimesheetEntryLike, offDay: TimesheetOffDayState): number {
  if (!entry.time_started || !entry.time_finished) return 0;
  if (!isTimeWithinWorkWindow(entry.time_started, offDay.workWindow)) return 0;
  if (!isTimeWithinWorkWindow(entry.time_finished, offDay.workWindow)) return 0;

  const startMinutes = toMinutes(entry.time_started);
  const finishMinutes = toMinutes(entry.time_finished);

  // Keep half-day leave windows as same-day ranges unless the window itself wraps overnight.
  if (
    offDay.workWindow &&
    !isWorkWindowOvernight(offDay.workWindow) &&
    startMinutes !== null &&
    finishMinutes !== null &&
    finishMinutes < startMinutes
  ) {
    return 0;
  }

  let workedHours = calculateHours(entry.time_started, entry.time_finished) || 0;
  if (workedHours > 6.5) {
    workedHours -= 0.5;
  }

  return roundHours(Math.max(0, workedHours));
}

function toLeaveLabel(row: ApprovedAbsenceForTimesheet): TimesheetLeaveLabel {
  const reasonName = row.absence_reasons?.name?.trim() || 'Approved Leave';
  const isHalf = Boolean(row.is_half_day);
  const session: LeaveSession | 'FULL' = isHalf && row.half_day_session ? row.half_day_session : 'FULL';
  const isAnnualLeave = normalizeReasonName(reasonName) === 'annual leave';
  const isTraining = isTrainingReasonName(reasonName);
  const isPending = normalizeReasonName(row.status) === 'pending';
  const allowsTimesheetWork = isAnnualLeave && Boolean(row.allow_timesheet_work_on_leave);

  return {
    absenceId: row.id || null,
    reasonName,
    label: session === 'FULL' ? reasonName : `${reasonName} (${session})`,
    session,
    color: row.absence_reasons?.color || null,
    isPaid: Boolean(row.absence_reasons?.is_paid),
    isTraining,
    isPending,
    blocksWorkingEntry: !allowsTimesheetWork,
  };
}

export function resolveTimesheetOffDayStates(
  weekEnding: string,
  approvedAbsences: ApprovedAbsenceForTimesheet[],
  pattern?: WorkShiftPattern | null
): TimesheetOffDayState[] {
  return Array.from({ length: 7 }, (_, index) => {
    const dayOfWeek = index + 1;
    const entryDate = getTimesheetEntryDateFromWeekEnding(weekEnding, dayOfWeek);
    const entryDateIso = formatLocalIsoDate(entryDate);
    const sessions = getWorkingSessionsForDate(entryDate, pattern);
    const isExpectedShiftDay = sessions.am || sessions.pm;

    const dayRows = approvedAbsences.filter((row) => {
      // Half-day bookings are single-day by rule. Treat legacy rows with an
      // end_date as single-day too so one bad record cannot affect a whole week.
      const rowEnd = row.is_half_day ? row.date : (row.end_date || row.date);
      return row.date <= entryDateIso && rowEnd >= entryDateIso;
    });

    const resolvedLabels = dayRows
      .map(toLeaveLabel)
      .sort((a, b) => {
        const weight = (session: LeaveSession | 'FULL') => {
          if (session === 'FULL') return 0;
          return session === 'AM' ? 1 : 2;
        };
        return weight(a.session) - weight(b.session);
      });
    const effectiveLabels = resolvedLabels.filter((label) => {
      if (label.session === 'FULL') return sessions.am || sessions.pm;
      if (label.session === 'AM') return sessions.am;
      return sessions.pm;
    });
    const effectiveTrainingLabels = effectiveLabels.filter((label) => label.isTraining && !label.isPending);
    const effectivePendingTrainingLabels = effectiveLabels.filter((label) => label.isTraining && label.isPending);
    const effectiveLeaveLabels = effectiveLabels.filter((label) => !label.isTraining && !label.isPending);

    const hasAmCoverage = sessions.am && effectiveLeaveLabels.some(
      (label) => label.session === 'FULL' || label.session === 'AM'
    );
    const hasPmCoverage = sessions.pm && effectiveLeaveLabels.some(
      (label) => label.session === 'FULL' || label.session === 'PM'
    );
    const hasAmLeave = sessions.am && effectiveLeaveLabels.some(
      (label) => label.blocksWorkingEntry && (label.session === 'FULL' || label.session === 'AM')
    );
    const hasPmLeave = sessions.pm && effectiveLeaveLabels.some(
      (label) => label.blocksWorkingEntry && (label.session === 'FULL' || label.session === 'PM')
    );
    const isOnApprovedLeave = hasAmCoverage || hasPmCoverage;
    const isLeaveLocked = hasAmLeave && hasPmLeave;
    const isPartialLeave = isOnApprovedLeave && !isLeaveLocked;

    const amPaid = sessions.am && effectiveLeaveLabels.some(
      (label) => label.isPaid && (label.session === 'FULL' || label.session === 'AM')
    );
    const pmPaid = sessions.pm && effectiveLeaveLabels.some(
      (label) => label.isPaid && (label.session === 'FULL' || label.session === 'PM')
    );
    const paidLeaveHours = roundHours((amPaid ? PAID_LEAVE_HALF_DAY_HOURS : 0) + (pmPaid ? PAID_LEAVE_HALF_DAY_HOURS : 0));

    let workWindow: TimesheetWorkWindow | null = null;
    if (!isLeaveLocked) {
      if (hasAmLeave) {
        workWindow = { start: '12:00', end: '23:59' };
      } else if (hasPmLeave) {
        workWindow = { start: '00:00', end: '13:00' };
      }
    }

    const displayRemarks = effectiveLeaveLabels.map((label) => label.label).join('\n');
    const firstLabel = effectiveLeaveLabels[0];
    const trainingDisplayRemarks = effectiveTrainingLabels.map((label) => label.label).join('\n');
    const pendingTrainingDisplayRemarks = effectivePendingTrainingLabels
      .map((label) => `${label.label} (pending)`)
      .join('\n');
    const trainingReasonColor = effectiveTrainingLabels[0]?.color || null;
    const trainingAbsenceIds = effectiveTrainingLabels
      .map((label) => label.absenceId)
      .filter((value): value is string => Boolean(value));
    const pendingTrainingAbsenceIds = effectivePendingTrainingLabels
      .map((label) => label.absenceId)
      .filter((value): value is string => Boolean(value));
    const hasTrainingBooking = trainingAbsenceIds.length > 0 || effectiveTrainingLabels.length > 0;
    const hasPendingTrainingBooking = pendingTrainingAbsenceIds.length > 0 || effectivePendingTrainingLabels.length > 0;
    const isAnnualLeave =
      isOnApprovedLeave && effectiveLeaveLabels.some((label) => normalizeReasonName(label.reasonName) === 'annual leave');

    return {
      day_of_week: dayOfWeek,
      date: entryDateIso,
      isExpectedShiftDay,
      isOnApprovedLeave,
      isLeaveLocked,
      isPartialLeave,
      hasAmLeave,
      hasPmLeave,
      workWindow,
      paidLeaveHours,
      leaveLabels: effectiveLeaveLabels,
      trainingLabels: effectiveTrainingLabels,
      pendingTrainingLabels: effectivePendingTrainingLabels,
      hasTrainingBooking,
      hasPendingTrainingBooking,
      trainingAbsenceIds,
      pendingTrainingAbsenceIds,
      trainingDisplayRemarks,
      pendingTrainingDisplayRemarks,
      displayRemarks,
      leaveReasonName: firstLabel?.reasonName || null,
      leaveReasonColor: firstLabel?.color || null,
      trainingReasonColor,
      isAnnualLeave,
    };
  });
}

export function normalizeTimesheetEntriesForOffDays(
  entries: TimesheetEntryLike[],
  offDayStates: TimesheetOffDayState[],
  options?: {
    enforceLeaveOverwrite?: boolean;
    applyNonShiftDefaults?: boolean;
  }
): TimesheetEntryLike[] {
  const enforceLeaveOverwrite = options?.enforceLeaveOverwrite ?? true;
  const applyNonShiftDefaults = options?.applyNonShiftDefaults ?? true;
  const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));

  return entries.map((entry) => {
    const offDay = offDayByDay.get(entry.day_of_week);
    if (!offDay) return entry;

    if (
      offDay.hasTrainingBooking &&
      entry.did_not_work &&
      entry.didNotWorkReason === 'Off Shift' &&
      !hasExplicitWorkingInput(entry) &&
      (!entry.remarks || entry.remarks.trim() === '' || entry.remarks.trim() === 'Not on Shift')
    ) {
      return {
        ...entry,
        did_not_work: false,
        didNotWorkReason: null,
        daily_total: null,
        remarks: '',
      };
    }

    if (enforceLeaveOverwrite && offDay.isLeaveLocked) {
      const primaryReason = offDay.leaveReasonName || 'Approved Leave';
      return {
        ...entry,
        time_started: '',
        time_finished: '',
        job_number: '',
        job_numbers: [],
        working_in_yard: false,
        subsistence_payment_required: false,
        did_not_work: true,
        didNotWorkReason: parseDidNotWorkReason(primaryReason),
        daily_total: offDay.paidLeaveHours,
        remarks: offDay.displayRemarks || primaryReason,
      };
    }

    if (offDay.isPartialLeave) {
      const workedHours = computeWorkedHours(entry, offDay);
      const requiresSubsistence = Boolean(
        entry.subsistence_payment_required && entry.time_started && entry.time_finished
      );
      return {
        ...entry,
        did_not_work: false,
        didNotWorkReason: null,
        subsistence_payment_required: requiresSubsistence,
        daily_total: roundHours(workedHours + offDay.paidLeaveHours),
        remarks: offDay.displayRemarks || syncSubsistenceRemark(entry.remarks, requiresSubsistence),
      };
    }

    const shouldAutoMarkOffShift =
      applyNonShiftDefaults &&
      !offDay.isExpectedShiftDay &&
      !hasExplicitWorkingInput(entry) &&
      (entry.did_not_work || !entry.daily_total || entry.daily_total <= 0);

    if (shouldAutoMarkOffShift) {
      return {
        ...entry,
        did_not_work: true,
        didNotWorkReason: 'Off Shift',
        subsistence_payment_required: false,
        daily_total: 0,
        remarks: 'Not on Shift',
      };
    }

    return entry;
  });
}
