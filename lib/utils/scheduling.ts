import { addDays, eachDayOfInterval, format, isValid, parseISO, startOfWeek } from 'date-fns';

export function formatScheduleDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function getSchedulingWeek(value?: string | null): { start: string; end: string } {
  const parsed = value ? parseISO(value) : new Date();
  const safeDate = isValid(parsed) ? parsed : new Date();
  const start = startOfWeek(safeDate, { weekStartsOn: 1 });
  return {
    start: formatScheduleDate(start),
    end: formatScheduleDate(addDays(start, 6)),
  };
}

export function enumerateScheduleDates(startDate: string, endDate: string): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end) || end < start) return [];
  return eachDayOfInterval({ start, end }).map(formatScheduleDate);
}

export function isScheduleDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = parseISO(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parsed);
}
