import { addDays, eachDayOfInterval, format, isValid, parseISO, startOfWeek } from 'date-fns';

const SCHEDULING_TIME_ZONE = 'Europe/London';

export const SCHEDULE_QUOTE_STAGES = {
  draft: 'draft',
  pending: 'pending',
  accepted: 'accepted',
} as const;

export type ScheduleQuoteStage =
  (typeof SCHEDULE_QUOTE_STAGES)[keyof typeof SCHEDULE_QUOTE_STAGES];

const SCHEDULE_QUOTE_STAGE_BY_STATUS: Record<string, ScheduleQuoteStage> = {
  draft: SCHEDULE_QUOTE_STAGES.draft,
  changes_requested: SCHEDULE_QUOTE_STAGES.draft,
  pending_internal_approval: SCHEDULE_QUOTE_STAGES.pending,
  approved: SCHEDULE_QUOTE_STAGES.pending,
  sent: SCHEDULE_QUOTE_STAGES.pending,
  won: SCHEDULE_QUOTE_STAGES.accepted,
  ready_to_invoice: SCHEDULE_QUOTE_STAGES.accepted,
  po_received: SCHEDULE_QUOTE_STAGES.accepted,
  in_progress: SCHEDULE_QUOTE_STAGES.accepted,
  completed_part: SCHEDULE_QUOTE_STAGES.accepted,
  completed_full: SCHEDULE_QUOTE_STAGES.accepted,
  partially_invoiced: SCHEDULE_QUOTE_STAGES.accepted,
  invoiced: SCHEDULE_QUOTE_STAGES.accepted,
};

export function getScheduleQuoteStage(status: string | null): ScheduleQuoteStage | null {
  if (!status) return null;
  return SCHEDULE_QUOTE_STAGE_BY_STATUS[status] || null;
}

export function getScheduleQuoteEndDate(
  startDate: string,
  estimatedDurationDays: number | null
): string {
  const parsedStartDate = parseISO(startDate);
  if (!isValid(parsedStartDate)) return startDate;
  const durationDays = estimatedDurationDays && Number.isFinite(estimatedDurationDays)
    ? Math.max(Math.ceil(estimatedDurationDays), 1)
    : 1;
  return format(addDays(parsedStartDate, durationDays - 1), 'yyyy-MM-dd');
}

export function formatScheduleEmployeeCompactName(fullName: string): string {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) return nameParts[0] || 'Employee';
  return `${nameParts[0]} ${nameParts[nameParts.length - 1].charAt(0).toUpperCase()}`;
}

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

export interface DailyScheduleCoordinateInput {
  clientX: number;
  rangeLeft: number;
  hourWidth: number;
  startHour: number;
  endHour: number;
}

export interface DailyInitialVisitWindow {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
}

export function mapDailyScheduleClientXToMinutes(
  input: DailyScheduleCoordinateInput
): number {
  const rawMinutes =
    input.startHour * 60
    + ((input.clientX - input.rangeLeft) / input.hourWidth) * 60;
  const snappedMinutes = Math.round(rawMinutes / 30) * 30;
  return Math.min(
    Math.max(snappedMinutes, input.startHour * 60),
    input.endHour * 60 - 30
  );
}

export function getDailyInitialVisitWindow(
  startMinutes: number,
  estimatedMinutes: number | null,
  endHour = 20
): DailyInitialVisitWindow {
  const requestedDuration =
    estimatedMinutes && Number.isFinite(estimatedMinutes)
      ? Math.min(Math.max(Math.round(estimatedMinutes), 30), 180)
      : 180;
  const endMinutes = Math.min(startMinutes + requestedDuration, endHour * 60);
  const durationMinutes = Math.max(endMinutes - startMinutes, 30);
  return {
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
    durationMinutes,
  };
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
