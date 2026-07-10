import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type AdminClient = SupabaseClient<Database>;

const ACCOUNTS_TEAM_ID = 'accounts';
const SUPERVISOR_HIERARCHY_RANK = 3;

export type ProcessedAbsenceChangeAction = 'updated' | 'cancelled' | 'deleted';

export interface ProcessedAbsenceNotificationSnapshot {
  id: string;
  profileId: string;
  employeeName: string | null;
  reasonName: string | null;
  startDate: string;
  endDate: string | null;
  status: string | null;
}

interface RecipientProfileRow {
  id: string;
  team_id: string | null;
  super_admin?: boolean | null;
  team?: {
    id: string | null;
    name: string | null;
  } | Array<{
    id: string | null;
    name: string | null;
  }> | null;
  role?: {
    name: string | null;
    hierarchy_rank: number | null;
    is_super_admin: boolean | null;
    role_class: string | null;
  } | Array<{
    name: string | null;
    hierarchy_rank: number | null;
    is_super_admin: boolean | null;
    role_class: string | null;
  }> | null;
}

interface ActorProfileRow {
  full_name: string | null;
}

interface AbsenceRow {
  id: string;
  profile_id: string;
  date: string;
  end_date: string | null;
  status: string | null;
  absence_reasons: {
    name: string | null;
  } | Array<{
    name: string | null;
  }> | null;
}

interface ProcessedAbsenceNotificationParams {
  actorUserId: string;
  subject: string;
  body: string;
  createdVia: string;
}

export interface ProcessedAbsenceChangeNotificationInput {
  actorUserId: string;
  action: ProcessedAbsenceChangeAction;
  before: ProcessedAbsenceNotificationSnapshot;
  after?: ProcessedAbsenceNotificationSnapshot | null;
  changedFields?: string[];
}

export interface ProcessedAbsenceTimesheetAdjustmentInput {
  actorUserId: string;
  employeeProfileId: string;
  employeeName: string;
  weekEnding: string;
  adjustmentComments: string;
}

function pickSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function formatCalendarDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatAbsenceRange(startDate: string, endDate: string | null): string {
  if (endDate && endDate !== startDate) {
    return `${formatCalendarDate(startDate)} to ${formatCalendarDate(endDate)}`;
  }

  return formatCalendarDate(startDate);
}

function formatWeekStart(weekEnding: string): string {
  const date = new Date(`${weekEnding}T00:00:00`);
  date.setDate(date.getDate() - 6);
  return formatLocalIsoDate(date);
}

function overlapsDateRange(
  startDate: string,
  endDate: string | null,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const actualEndDate = endDate || startDate;
  return startDate <= rangeEnd && actualEndDate >= rangeStart;
}

function getActionLabel(action: ProcessedAbsenceChangeAction): string {
  switch (action) {
    case 'cancelled':
      return 'Cancelled';
    case 'deleted':
      return 'Deleted';
    case 'updated':
      return 'Updated';
  }
}

function isAccountsSupervisorOrHigher(profile: RecipientProfileRow): boolean {
  const team = pickSingleRelation(profile.team);
  const role = pickSingleRelation(profile.role);
  const teamName = normalize(team?.name);
  const teamId = normalize(team?.id || profile.team_id);
  const hierarchyRank = Number(role?.hierarchy_rank ?? 0);

  return (
    (teamId === ACCOUNTS_TEAM_ID || teamName === ACCOUNTS_TEAM_ID) &&
    hierarchyRank >= SUPERVISOR_HIERARCHY_RANK
  );
}

function isGlobalAdmin(profile: RecipientProfileRow): boolean {
  const role = pickSingleRelation(profile.role);
  return Boolean(
    profile.super_admin ||
      role?.is_super_admin ||
      normalize(role?.name) === 'admin' ||
      normalize(role?.role_class) === 'admin'
  );
}

async function getActorName(admin: AdminClient, actorUserId: string): Promise<string> {
  const { data, error } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', actorUserId)
    .maybeSingle();

  if (error) {
    console.error('Failed to resolve processed absence notification actor:', error);
  }

  const actor = data as ActorProfileRow | null;
  return actor?.full_name || 'A user';
}

export async function resolveProcessedAbsenceNotificationRecipientIds(
  admin: AdminClient
): Promise<string[]> {
  const { data, error } = await admin
    .from('profiles')
    .select(`
      id,
      team_id,
      super_admin,
      team:org_teams!profiles_team_id_fkey(id, name),
      role:roles!profiles_role_id_fkey(name, hierarchy_rank, is_super_admin, role_class)
    `);

  if (error) {
    throw new Error(error.message || 'Failed to resolve processed absence notification recipients');
  }

  const recipientIds = new Set<string>();
  for (const profile of (data || []) as unknown as RecipientProfileRow[]) {
    if (isAccountsSupervisorOrHigher(profile) || isGlobalAdmin(profile)) {
      recipientIds.add(profile.id);
    }
  }

  return Array.from(recipientIds);
}

export async function createProcessedAbsenceNotification(
  admin: AdminClient,
  params: ProcessedAbsenceNotificationParams
): Promise<string[]> {
  const recipientIds = await resolveProcessedAbsenceNotificationRecipientIds(admin);
  if (recipientIds.length === 0) return [];

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      type: 'NOTIFICATION',
      subject: params.subject,
      body: params.body,
      priority: 'HIGH',
      sender_id: params.actorUserId,
      created_via: params.createdVia,
      module_key: 'processed_absence',
    })
    .select('id')
    .single();

  if (messageError || !message?.id) {
    throw new Error(messageError?.message || 'Failed to create processed absence notification');
  }

  const { error: recipientsError } = await admin
    .from('message_recipients')
    .insert(
      recipientIds.map((recipientId) => ({
        message_id: message.id,
        user_id: recipientId,
        status: 'PENDING' as const,
      }))
    );

  if (recipientsError) {
    throw new Error(recipientsError.message || 'Failed to assign processed absence notification');
  }

  return recipientIds;
}

export async function notifyProcessedAbsenceChange(
  admin: AdminClient,
  input: ProcessedAbsenceChangeNotificationInput
): Promise<string[]> {
  const actorName = await getActorName(admin, input.actorUserId);
  const employeeName = input.before.employeeName || input.after?.employeeName || 'Unknown employee';
  const reasonName = input.before.reasonName || input.after?.reasonName || 'Leave';
  const bookingRange = formatAbsenceRange(input.before.startDate, input.before.endDate);
  const actionLabel = getActionLabel(input.action);
  const changedFields = (input.changedFields || []).filter(Boolean);
  const currentStatus = input.after?.status || (input.action === 'deleted' ? 'deleted' : input.before.status);

  const body = [
    `${actorName} ${actionLabel.toLowerCase()} a processed absence booking.`,
    '',
    `Employee: ${employeeName}`,
    `Reason: ${reasonName}`,
    `Booking: ${bookingRange}`,
    `Previous status: ${input.before.status || 'processed'}`,
    `Current status: ${currentStatus || 'unknown'}`,
    ...(changedFields.length > 0 ? [`Changed fields: ${changedFields.join(', ')}`] : []),
  ].join('\n');

  return createProcessedAbsenceNotification(admin, {
    actorUserId: input.actorUserId,
    subject: `Processed absence ${actionLabel.toLowerCase()}: ${employeeName}`,
    body,
    createdVia: 'processed_absence_change',
  });
}

export async function notifyProcessedAbsenceTimesheetAdjustment(
  admin: AdminClient,
  input: ProcessedAbsenceTimesheetAdjustmentInput
): Promise<string[]> {
  const weekStart = formatWeekStart(input.weekEnding);
  const { data, error } = await admin
    .from('absences')
    .select(`
      id,
      profile_id,
      date,
      end_date,
      status,
      absence_reasons(name)
    `)
    .eq('profile_id', input.employeeProfileId)
    .eq('status', 'processed')
    .lte('date', input.weekEnding)
    .or(`end_date.gte.${weekStart},end_date.is.null`);

  if (error) {
    throw new Error(error.message || 'Failed to load processed absences for adjusted timesheet');
  }

  const absences = ((data || []) as unknown as AbsenceRow[])
    .filter((absence) => overlapsDateRange(absence.date, absence.end_date, weekStart, input.weekEnding));

  if (absences.length === 0) return [];

  const actorName = await getActorName(admin, input.actorUserId);
  const weekEnding = formatCalendarDate(input.weekEnding);
  const affectedAbsences = absences.map((absence) => {
    const reason = pickSingleRelation(absence.absence_reasons)?.name || 'Leave';
    return `- ${reason}: ${formatAbsenceRange(absence.date, absence.end_date)}`;
  });

  const body = [
    `${actorName} adjusted a timesheet that overlaps processed absence leave.`,
    '',
    `Employee: ${input.employeeName}`,
    `Week ending: ${weekEnding}`,
    '',
    'Processed absences in this week:',
    ...affectedAbsences,
    '',
    `Adjustment comments: ${input.adjustmentComments.trim()}`,
  ].join('\n');

  return createProcessedAbsenceNotification(admin, {
    actorUserId: input.actorUserId,
    subject: `Processed absence affected by timesheet adjustment: ${input.employeeName}`,
    body,
    createdVia: 'processed_absence_timesheet_adjustment',
  });
}
