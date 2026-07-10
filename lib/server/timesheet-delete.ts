import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getTimesheetEntryDateFromWeekEnding } from '@/lib/utils/timesheet-off-days';

type AdminClient = SupabaseClient<Database>;

const ACTIVE_LEAVE_STATUSES = ['pending', 'approved', 'processed'] as const;

interface TimesheetRow {
  id: string;
  user_id: string;
  week_ending: string;
}

interface AbsenceReasonRow {
  name?: string | null;
}

interface AssociatedAbsenceRow {
  id: string;
  date: string;
  end_date: string | null;
  status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled';
  is_half_day: boolean | null;
  half_day_session: 'AM' | 'PM' | null;
  duration_days: number;
  absence_reasons?: AbsenceReasonRow | AbsenceReasonRow[] | null;
}

export interface TimesheetAssociatedLeaveBooking {
  id: string;
  date: string;
  endDate: string | null;
  reasonName: string;
  status: 'pending' | 'approved' | 'processed';
  isHalfDay: boolean;
  halfDaySession: 'AM' | 'PM' | null;
  durationDays: number;
}

export interface DeleteTimesheetInput {
  timesheetId: string;
  associatedLeaveBookingIdsToDelete: string[];
}

export interface DeleteTimesheetResult {
  success: true;
  deletedAssociatedLeaveBookingCount: number;
}

export class TimesheetDeleteError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TimesheetDeleteError';
    this.status = status;
  }
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pickSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getWeekBounds(weekEnding: string): { weekStart: string; weekEnd: string } {
  return {
    weekStart: formatLocalIsoDate(getTimesheetEntryDateFromWeekEnding(weekEnding, 1)),
    weekEnd: formatLocalIsoDate(getTimesheetEntryDateFromWeekEnding(weekEnding, 7)),
  };
}

async function loadTimesheet(admin: AdminClient, timesheetId: string): Promise<TimesheetRow> {
  const { data, error } = await admin
    .from('timesheets')
    .select('id, user_id, week_ending')
    .eq('id', timesheetId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new TimesheetDeleteError('Timesheet not found.', 404);

  return data as TimesheetRow;
}

function toAssociatedLeaveBooking(row: AssociatedAbsenceRow): TimesheetAssociatedLeaveBooking {
  const reason = pickSingleRelation(row.absence_reasons);

  return {
    id: row.id,
    date: row.date,
    endDate: row.end_date,
    reasonName: reason?.name || 'Leave booking',
    status: row.status as 'pending' | 'approved' | 'processed',
    isHalfDay: Boolean(row.is_half_day),
    halfDaySession: row.half_day_session,
    durationDays: row.duration_days,
  };
}

export async function listTimesheetAssociatedLeaveBookings(
  admin: AdminClient,
  timesheetId: string
): Promise<TimesheetAssociatedLeaveBooking[]> {
  const timesheet = await loadTimesheet(admin, timesheetId);
  const { weekStart, weekEnd } = getWeekBounds(timesheet.week_ending);

  const { data, error } = await admin
    .from('absences')
    .select('id, date, end_date, status, is_half_day, half_day_session, duration_days, absence_reasons(name)')
    .eq('profile_id', timesheet.user_id)
    .eq('is_bank_holiday', false)
    .in('status', [...ACTIVE_LEAVE_STATUSES])
    .lte('date', weekEnd)
    .or(`end_date.is.null,end_date.gte.${weekStart}`)
    .order('date', { ascending: true });

  if (error) throw error;

  return ((data || []) as unknown as AssociatedAbsenceRow[]).map(toAssociatedLeaveBooking);
}

export async function deleteTimesheetWithOptionalLeaveBookings(
  admin: AdminClient,
  input: DeleteTimesheetInput
): Promise<DeleteTimesheetResult> {
  const requestedLeaveBookingIds = Array.from(new Set(input.associatedLeaveBookingIdsToDelete.filter(Boolean)));
  const associatedLeaveBookings = requestedLeaveBookingIds.length > 0
    ? await listTimesheetAssociatedLeaveBookings(admin, input.timesheetId)
    : [];
  const associatedLeaveBookingIds = new Set(associatedLeaveBookings.map((booking) => booking.id));
  const invalidLeaveBookingIds = requestedLeaveBookingIds.filter((id) => !associatedLeaveBookingIds.has(id));

  if (invalidLeaveBookingIds.length > 0) {
    throw new TimesheetDeleteError('One or more selected leave bookings are not associated with this timesheet.', 400);
  }

  if (requestedLeaveBookingIds.length > 0) {
    const { error } = await admin
      .from('absences')
      .delete()
      .in('id', requestedLeaveBookingIds);

    if (error) throw error;
  }

  const { error: deleteError } = await admin
    .from('timesheets')
    .delete()
    .eq('id', input.timesheetId);

  if (deleteError) throw deleteError;

  return {
    success: true,
    deletedAssociatedLeaveBookingCount: requestedLeaveBookingIds.length,
  };
}
