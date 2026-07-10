import type {
  WorkShiftCellKey,
  WorkShiftDayKey,
  WorkShiftPattern,
  WorkShiftSession,
} from '@/types/work-shifts';
import { WORK_SHIFT_DAY_ORDER } from '@/types/work-shifts';

export const STANDARD_WORK_SHIFT_PATTERN: WorkShiftPattern = {
  monday_am: true,
  monday_pm: true,
  tuesday_am: true,
  tuesday_pm: true,
  wednesday_am: true,
  wednesday_pm: true,
  thursday_am: true,
  thursday_pm: true,
  friday_am: true,
  friday_pm: true,
  saturday_am: false,
  saturday_pm: false,
  sunday_am: false,
  sunday_pm: false,
};

export function cloneWorkShiftPattern(pattern?: Partial<WorkShiftPattern> | null): WorkShiftPattern {
  return {
    ...STANDARD_WORK_SHIFT_PATTERN,
    ...pattern,
  };
}

export function getWorkShiftCellKey(day: WorkShiftDayKey, session: WorkShiftSession): WorkShiftCellKey {
  return `${day}_${session.toLowerCase() as Lowercase<WorkShiftSession>}`;
}

export function getWorkShiftDayFromDate(date: Date): WorkShiftDayKey {
  const dayIndex = date.getDay();

  switch (dayIndex) {
    case 1:
      return 'monday';
    case 2:
      return 'tuesday';
    case 3:
      return 'wednesday';
    case 4:
      return 'thursday';
    case 5:
      return 'friday';
    case 6:
      return 'saturday';
    default:
      return 'sunday';
  }
}

export function getWorkingSessionsForDate(
  date: Date,
  pattern?: WorkShiftPattern | null
): { am: boolean; pm: boolean } {
  const resolvedPattern = cloneWorkShiftPattern(pattern);
  const dayKey = getWorkShiftDayFromDate(date);

  return {
    am: resolvedPattern[getWorkShiftCellKey(dayKey, 'AM')],
    pm: resolvedPattern[getWorkShiftCellKey(dayKey, 'PM')],
  };
}

export function getWorkingDayFraction(date: Date, pattern?: WorkShiftPattern | null): number {
  const sessions = getWorkingSessionsForDate(date, pattern);
  return (sessions.am ? 0.5 : 0) + (sessions.pm ? 0.5 : 0);
}

export function getWorkingSessionFraction(
  date: Date,
  session: WorkShiftSession,
  pattern?: WorkShiftPattern | null
): number {
  const sessions = getWorkingSessionsForDate(date, pattern);
  return session === 'AM' ? (sessions.am ? 0.5 : 0) : (sessions.pm ? 0.5 : 0);
}

export function calculateDurationDaysForShiftPattern(
  startDate: Date,
  endDate: Date | null,
  pattern?: WorkShiftPattern | null,
  options: {
    isHalfDay?: boolean;
    halfDaySession?: WorkShiftSession | null;
  } = {}
): number {
  const resolvedPattern = cloneWorkShiftPattern(pattern);
  const resolvedStart = new Date(startDate);
  const resolvedEnd = endDate ? new Date(endDate) : new Date(startDate);

  resolvedStart.setHours(0, 0, 0, 0);
  resolvedEnd.setHours(0, 0, 0, 0);

  if (resolvedEnd < resolvedStart) {
    return 0;
  }

  if (options.isHalfDay) {
    const requestedSession = options.halfDaySession || 'AM';
    return getWorkingSessionFraction(resolvedStart, requestedSession, resolvedPattern);
  }

  let total = 0;
  const current = new Date(resolvedStart);
  while (current <= resolvedEnd) {
    total += getWorkingDayFraction(current, resolvedPattern);
    current.setDate(current.getDate() + 1);
  }

  return total;
}

export function serializePatternToTemplateSlots(pattern?: WorkShiftPattern | null): Array<{
  day_of_week: number;
  am_working: boolean;
  pm_working: boolean;
}> {
  const resolvedPattern = cloneWorkShiftPattern(pattern);

  return WORK_SHIFT_DAY_ORDER.map((day, index) => ({
    day_of_week: index + 1,
    am_working: resolvedPattern[`${day}_am`],
    pm_working: resolvedPattern[`${day}_pm`],
  }));
}
