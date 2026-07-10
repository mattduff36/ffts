import { DAY_NAMES } from '@/types/timesheet';
import {
  getTimesheetEntryDateFromWeekEnding,
  type TimesheetEntryLike,
  type TimesheetOffDayState,
} from '@/lib/utils/timesheet-off-days';

const DID_NOT_WORK_REASON_PREFIX = 'Did Not Work:';

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ScheduledDidNotWorkException {
  dayOfWeek: number;
  dayName: string;
  date: string;
  reason: string;
}

export function formatDidNotWorkReasonRemark(reason: string): string {
  return `${DID_NOT_WORK_REASON_PREFIX} ${reason.trim()}`;
}

export function parseDidNotWorkReasonRemark(remarks: string | null | undefined): string {
  const value = (remarks || '').trim();
  if (!value) return '';
  if (value.toLowerCase().startsWith(DID_NOT_WORK_REASON_PREFIX.toLowerCase())) {
    return value.slice(DID_NOT_WORK_REASON_PREFIX.length).trim();
  }
  if (value.toLowerCase() === 'did not work') return '';
  return value;
}

export function isScheduledWorkingDayDidNotWork(
  entry: Pick<TimesheetEntryLike, 'did_not_work'>,
  offDayState: Pick<TimesheetOffDayState, 'isExpectedShiftDay' | 'isOnApprovedLeave' | 'hasTrainingBooking'> | undefined
): boolean {
  return Boolean(
    entry.did_not_work &&
      offDayState?.isExpectedShiftDay &&
      !offDayState.isOnApprovedLeave &&
      !offDayState.hasTrainingBooking
  );
}

export function getScheduledDidNotWorkExceptions(
  entries: TimesheetEntryLike[],
  offDayStates: TimesheetOffDayState[],
  weekEnding: string
): ScheduledDidNotWorkException[] {
  const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));

  return entries.flatMap((entry) => {
    if (!isScheduledWorkingDayDidNotWork(entry, offDayByDay.get(entry.day_of_week))) return [];

    const entryDate = getTimesheetEntryDateFromWeekEnding(weekEnding, entry.day_of_week);
    return {
      dayOfWeek: entry.day_of_week,
      dayName: DAY_NAMES[entry.day_of_week - 1] || `Day ${entry.day_of_week}`,
      date: formatLocalIsoDate(entryDate),
      reason: parseDidNotWorkReasonRemark(entry.remarks),
    };
  });
}

export function getMissingScheduledDidNotWorkReasonException(
  entries: TimesheetEntryLike[],
  offDayStates: TimesheetOffDayState[],
  weekEnding: string
): ScheduledDidNotWorkException | null {
  return getScheduledDidNotWorkExceptions(entries, offDayStates, weekEnding).find(
    (exception) => exception.reason.length === 0
  ) || null;
}
