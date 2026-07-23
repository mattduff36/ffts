import { parseISO } from 'date-fns';
import {
  formatScheduleVisitTime,
  getScheduleVisitDate,
} from '@/lib/utils/scheduling';
import type {
  ScheduleDayCapacity,
  ScheduleEmployeeAssignment,
  ScheduleEmployeeResource,
} from '@/types/scheduling';

const SESSION_CAPACITY_MINUTES = 225;
const WORK_START_MINUTES = 8 * 60;
const WORK_MIDPOINT_MINUTES = 12 * 60;
const WORK_END_MINUTES = 16 * 60;
const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

interface CapacityAbsence {
  profile_id: string;
  date: string;
  end_date: string | null;
  is_half_day?: boolean | null;
  half_day_session?: 'AM' | 'PM' | null;
}

interface MinuteInterval {
  start: number;
  end: number;
}

interface BuildEmployeeCapacityInput {
  dates: string[];
  employees: ScheduleEmployeeResource[];
  assignments: ScheduleEmployeeAssignment[];
  absences: CapacityAbsence[];
  shifts: Map<string, Record<string, boolean>>;
}

function getVisitMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = formatScheduleVisitTime(value).split(':');
  return Number(hours) * 60 + Number(minutes);
}

function mergeIntervalMinutes(intervals: MinuteInterval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((first, second) => first.start - second.start);
  let total = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;

  for (const interval of sorted.slice(1)) {
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }

  return total + currentEnd - currentStart;
}

function getScheduledSessions(
  workDate: string,
  shift: Record<string, boolean> | undefined
): { hasAm: boolean; hasPm: boolean } {
  if (!shift) return { hasAm: true, hasPm: true };
  const day = DAY_NAMES[parseISO(workDate).getDay()];
  return {
    hasAm: shift[`${day}_am`] === true,
    hasPm: shift[`${day}_pm`] === true,
  };
}

function getAbsenceSessions(
  absences: CapacityAbsence[],
  profileId: string,
  workDate: string
): { hasFullDay: boolean; hasAm: boolean; hasPm: boolean } {
  const matching = absences.filter(
    (absence) =>
      absence.profile_id === profileId
      && absence.date <= workDate
      && (absence.end_date || absence.date) >= workDate
  );
  return {
    hasFullDay: matching.some((absence) => absence.is_half_day !== true),
    hasAm: matching.some(
      (absence) => absence.is_half_day === true && absence.half_day_session === 'AM'
    ),
    hasPm: matching.some(
      (absence) => absence.is_half_day === true && absence.half_day_session === 'PM'
    ),
  };
}

function getBookingIntervals(
  assignments: ScheduleEmployeeAssignment[],
  profileId: string,
  workDate: string,
  hasAm: boolean,
  hasPm: boolean
): { hasUntimedAssignment: boolean; intervals: MinuteInterval[] } {
  const matching = assignments.filter(
    (assignment) =>
      assignment.profile_id === profileId
      && assignment.work_date === workDate
  );
  if (matching.some((assignment) => !assignment.visit_id)) {
    return { hasUntimedAssignment: true, intervals: [] };
  }

  const windows: MinuteInterval[] =
    hasAm && hasPm
      ? [{ start: WORK_START_MINUTES, end: WORK_END_MINUTES }]
      : hasAm
        ? [{ start: WORK_START_MINUTES, end: WORK_MIDPOINT_MINUTES }]
        : hasPm
          ? [{ start: WORK_MIDPOINT_MINUTES, end: WORK_END_MINUTES }]
          : [];
  const intervals = matching.flatMap((assignment) => {
    const visit = assignment.visit;
    if (
      !visit
      || visit.status === 'cancelled'
      || getScheduleVisitDate(visit.starts_at) !== workDate
    ) return [];

    const visitStart = getVisitMinutes(visit.starts_at);
    const visitEnd = getVisitMinutes(visit.ends_at);
    return windows.flatMap((window) => {
      const start = Math.max(visitStart, window.start);
      const end = Math.min(visitEnd, window.end);
      return end > start ? [{ start, end }] : [];
    });
  });

  return { hasUntimedAssignment: false, intervals };
}

export function buildEmployeeCapacity({
  dates,
  employees,
  assignments,
  absences,
  shifts,
}: BuildEmployeeCapacityInput): ScheduleDayCapacity[] {
  return dates.map((date) => {
    const capacityEmployees = employees.map((employee) => {
      const scheduled = getScheduledSessions(date, shifts.get(employee.id));
      const absence = getAbsenceSessions(absences, employee.id, date);
      const hasAm = scheduled.hasAm && !absence.hasFullDay && !absence.hasAm;
      const hasPm = scheduled.hasPm && !absence.hasFullDay && !absence.hasPm;
      const capacityMinutes =
        (hasAm ? SESSION_CAPACITY_MINUTES : 0)
        + (hasPm ? SESSION_CAPACITY_MINUTES : 0);
      const bookings = getBookingIntervals(
        assignments,
        employee.id,
        date,
        hasAm,
        hasPm
      );
      const bookedMinutes = bookings.hasUntimedAssignment
        ? capacityMinutes
        : Math.min(capacityMinutes, mergeIntervalMinutes(bookings.intervals));

      return {
        profile_id: employee.id,
        full_name: employee.full_name,
        available_minutes: Math.max(0, capacityMinutes - bookedMinutes),
      };
    });
    const availableEmployees = capacityEmployees.filter(
      (employee) => employee.available_minutes > 0
    );

    return {
      date,
      available_employee_count: availableEmployees.length,
      total_available_minutes: availableEmployees.reduce(
        (total, employee) => total + employee.available_minutes,
        0
      ),
      employees: availableEmployees,
    };
  });
}
