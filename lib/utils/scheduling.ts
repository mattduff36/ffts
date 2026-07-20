import { addDays, eachDayOfInterval, format, isValid, parseISO, startOfWeek } from 'date-fns';

const SCHEDULING_TIME_ZONE = 'Europe/London';

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

export function getScheduleVisitDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatScheduleVisitTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function scheduleVisitIntervalsOverlap(
  first: { starts_at: string; ends_at: string },
  second: { starts_at: string; ends_at: string }
): boolean {
  return (
    new Date(first.starts_at).getTime() < new Date(second.ends_at).getTime()
    && new Date(second.starts_at).getTime() < new Date(first.ends_at).getTime()
  );
}
