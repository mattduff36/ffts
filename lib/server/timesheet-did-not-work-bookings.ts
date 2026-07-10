import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  getTimesheetEntryDateFromWeekEnding,
  type LeaveSession,
} from '@/lib/utils/timesheet-off-days';
import {
  applyApprovedAbsenceTimesheetEffects,
} from '@/lib/utils/absence-timesheet-impact';
import {
  resolveProcessedAbsenceNotificationRecipientIds,
} from '@/lib/server/processed-absence-notifications';
import type {
  DidNotWorkTrainingSession,
  TimesheetDidNotWorkBookingInput,
} from '@/lib/utils/timesheet-did-not-work-bookings';

type AdminClient = SupabaseClient<Database>;

const CREATED_VIA = 'timesheet_did_not_work_booking';
const GENERATION_SOURCE = 'timesheet_did_not_work';
const ACTIVE_ABSENCE_STATUSES = ['approved', 'processed', 'pending'] as const;

interface TimesheetRow {
  id: string;
  user_id: string;
  week_ending: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  team_id: string | null;
  line_manager_id: string | null;
  secondary_manager_id: string | null;
  team?: {
    id?: string | null;
    name?: string | null;
    manager_1_profile_id?: string | null;
    manager_2_profile_id?: string | null;
  } | Array<{
    id?: string | null;
    name?: string | null;
    manager_1_profile_id?: string | null;
    manager_2_profile_id?: string | null;
  }> | null;
}

interface AbsenceReasonRow {
  id: string;
  name: string | null;
  is_paid: boolean | null;
}

interface ExistingAbsenceRow {
  id: string;
  reason_id: string;
  date: string;
  end_date: string | null;
  is_half_day: boolean | null;
  half_day_session: LeaveSession | null;
}

interface NormalizedBooking extends TimesheetDidNotWorkBookingInput {
  isHalfDay: boolean;
  halfDaySession: LeaveSession | null;
}

export interface CommitTimesheetDidNotWorkBookingsInput {
  actorUserId: string;
  timesheetId: string;
  canManageOtherUsers: boolean;
  bookings: TimesheetDidNotWorkBookingInput[];
}

export interface CommitTimesheetDidNotWorkBookingsResult {
  insertedAbsenceIds: string[];
  existingAbsenceIds: string[];
  notifiedProfileIds: string[];
}

export class TimesheetDidNotWorkBookingError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TimesheetDidNotWorkBookingError';
    this.status = status;
  }
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
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

function getReasonName(kind: NormalizedBooking['kind']): 'Sickness' | 'Training' {
  return kind === 'sickness' ? 'Sickness' : 'Training';
}

function normalizeTrainingSession(session: DidNotWorkTrainingSession | undefined): DidNotWorkTrainingSession {
  return session || 'FULL';
}

function validateAndNormalizeBookings(
  timesheet: TimesheetRow,
  bookings: TimesheetDidNotWorkBookingInput[]
): NormalizedBooking[] {
  const unique = new Map<string, NormalizedBooking>();

  for (const booking of bookings) {
    if (booking.kind !== 'sickness' && booking.kind !== 'training') {
      throw new TimesheetDidNotWorkBookingError('Unsupported Did Not Work booking reason.');
    }
    if (!Number.isInteger(booking.dayOfWeek) || booking.dayOfWeek < 1 || booking.dayOfWeek > 7) {
      throw new TimesheetDidNotWorkBookingError('Invalid Did Not Work booking day.');
    }

    const expectedDate = formatLocalIsoDate(
      getTimesheetEntryDateFromWeekEnding(timesheet.week_ending, booking.dayOfWeek)
    );
    if (booking.date !== expectedDate) {
      throw new TimesheetDidNotWorkBookingError('Did Not Work booking date does not match the timesheet week.');
    }

    const trainingSession = booking.kind === 'training'
      ? normalizeTrainingSession(booking.trainingSession)
      : undefined;
    const isHalfDay = booking.kind === 'training' && trainingSession !== 'FULL';
    const halfDaySession = isHalfDay ? trainingSession as LeaveSession : null;
    const normalized: NormalizedBooking = {
      dayOfWeek: booking.dayOfWeek,
      date: booking.date,
      kind: booking.kind,
      ...(trainingSession ? { trainingSession } : {}),
      isHalfDay,
      halfDaySession,
    };

    unique.set(`${normalized.kind}:${normalized.date}:${normalized.halfDaySession || 'FULL'}`, normalized);
  }

  return Array.from(unique.values()).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function findReason(reasons: AbsenceReasonRow[], name: 'Sickness' | 'Training'): AbsenceReasonRow {
  const reason = reasons.find((row) => normalize(row.name) === normalize(name));
  if (!reason) {
    throw new TimesheetDidNotWorkBookingError(`${name} absence reason is not configured.`, 409);
  }
  return reason;
}

function isMatchingExistingAbsence(
  row: ExistingAbsenceRow,
  booking: NormalizedBooking,
  reason: AbsenceReasonRow
): boolean {
  if (row.reason_id !== reason.id) return false;
  if (row.date !== booking.date) return false;
  if (booking.isHalfDay) {
    return Boolean(row.is_half_day) && row.half_day_session === booking.halfDaySession;
  }
  return !row.is_half_day && (!row.end_date || row.end_date === booking.date);
}

async function loadTimesheet(admin: AdminClient, timesheetId: string): Promise<TimesheetRow> {
  const { data, error } = await admin
    .from('timesheets')
    .select('id, user_id, week_ending')
    .eq('id', timesheetId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new TimesheetDidNotWorkBookingError('Timesheet not found.', 404);
  return data as TimesheetRow;
}

async function loadEmployeeProfile(admin: AdminClient, profileId: string): Promise<ProfileRow> {
  const { data, error } = await admin
    .from('profiles')
    .select(`
      id,
      full_name,
      employee_id,
      team_id,
      line_manager_id,
      secondary_manager_id,
      team:org_teams!profiles_team_id_fkey(id, name, manager_1_profile_id, manager_2_profile_id)
    `)
    .eq('id', profileId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new TimesheetDidNotWorkBookingError('Employee profile not found.', 404);
  return data as unknown as ProfileRow;
}

async function loadAbsenceReasons(admin: AdminClient): Promise<AbsenceReasonRow[]> {
  const { data, error } = await admin
    .from('absence_reasons')
    .select('id, name, is_paid');

  if (error) throw error;
  return (data || []) as AbsenceReasonRow[];
}

async function findExistingAbsence(
  admin: AdminClient,
  profileId: string,
  booking: NormalizedBooking,
  reason: AbsenceReasonRow
): Promise<ExistingAbsenceRow | null> {
  const { data, error } = await admin
    .from('absences')
    .select('id, reason_id, date, end_date, is_half_day, half_day_session')
    .eq('profile_id', profileId)
    .eq('date', booking.date)
    .in('status', [...ACTIVE_ABSENCE_STATUSES]);

  if (error) throw error;

  return ((data || []) as ExistingAbsenceRow[]).find((row) => (
    isMatchingExistingAbsence(row, booking, reason)
  )) || null;
}

async function insertApprovedAbsence(
  admin: AdminClient,
  input: {
    actorUserId: string;
    profileId: string;
    timesheetId: string;
    booking: NormalizedBooking;
    reason: AbsenceReasonRow;
  }
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('absences')
    .insert({
      profile_id: input.profileId,
      date: input.booking.date,
      end_date: null,
      reason_id: input.reason.id,
      duration_days: input.booking.isHalfDay ? 0.5 : 1,
      is_half_day: input.booking.isHalfDay,
      half_day_session: input.booking.halfDaySession,
      notes: `Created from Did Not Work timesheet selection. Timesheet ID: ${input.timesheetId}`,
      status: 'approved',
      created_by: input.actorUserId,
      approved_by: input.actorUserId,
      approved_at: now,
      auto_generated: true,
      generation_source: GENERATION_SOURCE,
    } satisfies Database['public']['Tables']['absences']['Insert'])
    .select('id')
    .single();

  if (error) {
    const reasonName = getReasonName(input.booking.kind);
    throw new TimesheetDidNotWorkBookingError(
      `Failed to create ${reasonName} booking for ${input.booking.date}: ${error.message}`,
      409
    );
  }
  if (!data?.id) throw new TimesheetDidNotWorkBookingError('Failed to create absence booking.', 500);

  return data.id;
}

async function resolveManagerRecipientIds(employeeProfile: ProfileRow): Promise<string[]> {
  const team = pickSingleRelation(employeeProfile.team);
  const recipients = new Set<string>();

  [
    employeeProfile.line_manager_id,
    employeeProfile.secondary_manager_id,
    team?.manager_1_profile_id,
    team?.manager_2_profile_id,
  ].forEach((profileId) => {
    if (profileId && profileId !== employeeProfile.id) recipients.add(profileId);
  });

  return Array.from(recipients);
}

async function notifySicknessBookings(
  admin: AdminClient,
  input: {
    actorUserId: string;
    timesheet: TimesheetRow;
    employeeProfile: ProfileRow;
    bookings: NormalizedBooking[];
  }
): Promise<string[]> {
  if (input.bookings.length === 0) return [];

  const { data: existingNotification, error: existingNotificationError } = await admin
    .from('messages')
    .select('id')
    .eq('created_via', CREATED_VIA)
    .is('deleted_at', null)
    .ilike('body', `%Timesheet ID: ${input.timesheet.id}%`)
    .limit(1);

  if (existingNotificationError) throw existingNotificationError;
  if ((existingNotification || []).length > 0) return [];

  const [managerIds, accountsIds] = await Promise.all([
    resolveManagerRecipientIds(input.employeeProfile),
    resolveProcessedAbsenceNotificationRecipientIds(admin),
  ]);
  const recipientIds = Array.from(new Set([...managerIds, ...accountsIds]))
    .filter((profileId) => profileId !== input.employeeProfile.id);

  if (recipientIds.length === 0) return [];

  const employeeName = input.employeeProfile.full_name || 'Unknown employee';
  const rows = input.bookings.map((booking) => `- ${booking.date}: Sickness`).join('\n');
  const body = [
    `${employeeName} selected Sick from the Did Not Work timesheet flow and an approved sickness booking was created.`,
    '',
    rows,
    '',
    `Week ending: ${input.timesheet.week_ending}`,
    `Timesheet: /timesheets/new?id=${input.timesheet.id}`,
    `Timesheet ID: ${input.timesheet.id}`,
  ].join('\n');

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      type: 'NOTIFICATION',
      subject: `Sickness booked from Did Not Work: ${employeeName}`,
      body,
      priority: 'HIGH',
      sender_id: input.actorUserId,
      created_via: CREATED_VIA,
      module_key: 'absence',
    } satisfies Database['public']['Tables']['messages']['Insert'])
    .select('id')
    .single();

  if (messageError || !message?.id) {
    throw new TimesheetDidNotWorkBookingError(messageError?.message || 'Failed to create sickness notification.', 500);
  }

  const { error: recipientsError } = await admin
    .from('message_recipients')
    .insert(
      recipientIds.map((profileId) => ({
        message_id: message.id,
        user_id: profileId,
        status: 'PENDING' as const,
      }))
    );

  if (recipientsError) {
    throw new TimesheetDidNotWorkBookingError(recipientsError.message || 'Failed to assign sickness notification.', 500);
  }

  return recipientIds;
}

export async function commitTimesheetDidNotWorkBookings(
  admin: AdminClient,
  input: CommitTimesheetDidNotWorkBookingsInput
): Promise<CommitTimesheetDidNotWorkBookingsResult> {
  const timesheet = await loadTimesheet(admin, input.timesheetId);
  if (timesheet.user_id !== input.actorUserId && !input.canManageOtherUsers) {
    throw new TimesheetDidNotWorkBookingError('Forbidden.', 403);
  }

  const bookings = validateAndNormalizeBookings(timesheet, input.bookings);
  if (bookings.length === 0) {
    return { insertedAbsenceIds: [], existingAbsenceIds: [], notifiedProfileIds: [] };
  }

  const [employeeProfile, reasons] = await Promise.all([
    loadEmployeeProfile(admin, timesheet.user_id),
    loadAbsenceReasons(admin),
  ]);

  const insertedAbsenceIds: string[] = [];
  const existingAbsenceIds: string[] = [];
  const insertedSicknessBookings: NormalizedBooking[] = [];

  for (const booking of bookings) {
    const reason = findReason(reasons, getReasonName(booking.kind));
    const existing = await findExistingAbsence(admin, timesheet.user_id, booking, reason);
    if (existing) {
      existingAbsenceIds.push(existing.id);
      continue;
    }

    const absenceId = await insertApprovedAbsence(admin, {
      actorUserId: input.actorUserId,
      profileId: timesheet.user_id,
      timesheetId: timesheet.id,
      booking,
      reason,
    });
    insertedAbsenceIds.push(absenceId);

    if (booking.kind === 'sickness') {
      insertedSicknessBookings.push(booking);
      await applyApprovedAbsenceTimesheetEffects(admin, {
        absenceId,
        actorUserId: input.actorUserId,
        profileId: timesheet.user_id,
        startDate: booking.date,
        endDate: null,
        isHalfDay: false,
        reasonName: 'Sickness',
        isPaid: Boolean(reason.is_paid),
        allowTimesheetWorkOnLeave: false,
      });
    }
  }

  const notifiedProfileIds = await notifySicknessBookings(admin, {
    actorUserId: input.actorUserId,
    timesheet,
    employeeProfile,
    bookings: insertedSicknessBookings,
  });

  return {
    insertedAbsenceIds,
    existingAbsenceIds,
    notifiedProfileIds,
  };
}
