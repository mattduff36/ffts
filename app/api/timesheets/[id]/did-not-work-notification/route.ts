import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { getCurrentUserWorkShift } from '@/lib/server/work-shifts';
import { resolveTimesheetOffDayStates, type TimesheetEntryLike } from '@/lib/utils/timesheet-off-days';
import { getScheduledDidNotWorkExceptions } from '@/lib/utils/timesheet-did-not-work-exceptions';
import type { Database } from '@/types/database';

const CREATED_VIA = 'timesheet_did_not_work_exception';

type AdminClient = ReturnType<typeof createAdminClient>;

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
  is_placeholder: boolean | null;
  super_admin?: boolean | null;
  role?: {
    name?: string | null;
    role_class?: string | null;
    is_super_admin?: boolean | null;
  } | null;
  team?: {
    id?: string | null;
    name?: string | null;
    manager_1_profile_id?: string | null;
    manager_2_profile_id?: string | null;
  } | null;
}

interface TimesheetEntryRow {
  day_of_week: number;
  time_started: string | null;
  time_finished: string | null;
  job_number: string | null;
  working_in_yard: boolean | null;
  did_not_work: boolean | null;
  daily_total: number | null;
  remarks: string | null;
}

interface AbsenceRow {
  id: string;
  date: string;
  end_date: string | null;
  is_half_day: boolean | null;
  half_day_session: 'AM' | 'PM' | null;
  allow_timesheet_work_on_leave: boolean | null;
  absence_reasons?: {
    name?: string | null;
    color?: string | null;
    is_paid?: boolean | null;
  } | null;
}

function isAdminProfile(profile: ProfileRow): boolean {
  const roleName = (profile.role?.name || '').toLowerCase();
  const roleClass = (profile.role?.role_class || '').toLowerCase();
  return Boolean(
    profile.role?.is_super_admin ||
      profile.super_admin ||
      roleName.includes('admin') ||
      roleClass === 'admin' ||
      roleClass === 'super_admin'
  );
}

function canNotifyForOtherUsers(role: Awaited<ReturnType<typeof getEffectiveRole>>): boolean {
  const roleClass = (role?.role_class || '').toLowerCase();
  const roleName = (role?.role_name || '').toLowerCase();
  return Boolean(
    role?.is_super_admin ||
      role?.is_manager_admin ||
      roleClass === 'admin' ||
      roleClass === 'manager' ||
      roleName.includes('admin') ||
      roleName.includes('manager')
  );
}

function toTimesheetEntryLike(row: TimesheetEntryRow): TimesheetEntryLike {
  return {
    day_of_week: row.day_of_week,
    time_started: row.time_started || '',
    time_finished: row.time_finished || '',
    job_number: row.job_number || '',
    job_numbers: row.job_number ? [row.job_number] : [],
    working_in_yard: Boolean(row.working_in_yard),
    did_not_work: Boolean(row.did_not_work),
    didNotWorkReason: null,
    daily_total: row.daily_total,
    remarks: row.remarks || '',
  };
}

async function getNotificationRecipients(admin: AdminClient, employeeProfile: ProfileRow): Promise<string[]> {
  const managerIds = new Set<string>();
  [
    employeeProfile.line_manager_id,
    employeeProfile.secondary_manager_id,
    employeeProfile.team?.manager_1_profile_id,
    employeeProfile.team?.manager_2_profile_id,
  ].forEach((profileId) => {
    if (profileId) managerIds.add(profileId);
  });

  const { data, error } = await admin
    .from('profiles')
    .select('id, is_placeholder, super_admin, role:roles(name, role_class, is_super_admin)');

  if (error) throw error;

  const recipients = new Set<string>();
  for (const profile of (data || []) as unknown as ProfileRow[]) {
    if (profile.is_placeholder || profile.id === employeeProfile.id) continue;
    if (managerIds.has(profile.id) || isAdminProfile(profile)) {
      recipients.add(profile.id);
    }
  }

  return Array.from(recipients);
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: timesheetId } = await params;
    const admin = createAdminClient();
    const { data: timesheetData, error: timesheetError } = await admin
      .from('timesheets')
      .select('id, user_id, week_ending')
      .eq('id', timesheetId)
      .maybeSingle();

    if (timesheetError) throw timesheetError;
    if (!timesheetData) {
      return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    }

    const timesheet = timesheetData as TimesheetRow;
    const role = await getEffectiveRole();
    if (timesheet.user_id !== user.id && !canNotifyForOtherUsers(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: existingNotification, error: existingNotificationError } = await admin
      .from('messages')
      .select('id')
      .eq('created_via', CREATED_VIA)
      .is('deleted_at', null)
      .ilike('body', `%Timesheet ID: ${timesheet.id}%`)
      .limit(1);

    if (existingNotificationError) throw existingNotificationError;
    if ((existingNotification || []).length > 0) {
      return NextResponse.json({ success: true, notified: false, reason: 'duplicate' });
    }

    const [{ data: profileData, error: profileError }, { data: entryData, error: entryError }] = await Promise.all([
      admin
        .from('profiles')
        .select(`
          id,
          full_name,
          employee_id,
          team_id,
          line_manager_id,
          secondary_manager_id,
          is_placeholder,
          team:org_teams!profiles_team_id_fkey(id, name, manager_1_profile_id, manager_2_profile_id)
        `)
        .eq('id', timesheet.user_id)
        .maybeSingle(),
      admin
        .from('timesheet_entries')
        .select('day_of_week, time_started, time_finished, job_number, working_in_yard, did_not_work, daily_total, remarks')
        .eq('timesheet_id', timesheet.id)
        .order('day_of_week', { ascending: true }),
    ]);

    if (profileError) throw profileError;
    if (entryError) throw entryError;
    if (!profileData) {
      return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 });
    }

    const employeeProfile = profileData as unknown as ProfileRow;
    const entries = ((entryData || []) as TimesheetEntryRow[]).map(toTimesheetEntryLike);
    const weekStart = new Date(`${timesheet.week_ending}T00:00:00`);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartIso = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

    const [{ pattern }, { data: absenceData, error: absenceError }] = await Promise.all([
      getCurrentUserWorkShift(admin, timesheet.user_id),
      admin
        .from('absences')
        .select(`
          id,
          date,
          end_date,
          is_half_day,
          half_day_session,
          allow_timesheet_work_on_leave,
          absence_reasons(name, color, is_paid)
        `)
        .eq('profile_id', timesheet.user_id)
        .in('status', ['approved', 'processed'])
        .lte('date', timesheet.week_ending)
        .or(`end_date.is.null,end_date.gte.${weekStartIso}`),
    ]);

    if (absenceError) throw absenceError;

    const offDayStates = resolveTimesheetOffDayStates(
      timesheet.week_ending,
      (absenceData || []) as unknown as AbsenceRow[],
      pattern
    );
    const exceptions = getScheduledDidNotWorkExceptions(entries, offDayStates, timesheet.week_ending).filter(
      (exception) => exception.reason.trim().length > 0
    );

    if (exceptions.length === 0) {
      return NextResponse.json({ success: true, notified: false, reason: 'no-exceptions' });
    }

    const recipients = await getNotificationRecipients(admin, employeeProfile);
    if (recipients.length === 0) {
      return NextResponse.json({ success: true, notified: false, reason: 'no-recipients' });
    }

    const employeeName = employeeProfile.full_name || 'Unknown employee';
    const rows = exceptions
      .map((exception) => `- ${exception.dayName} ${exception.date}: ${exception.reason}`)
      .join('\n');
    const subject = `Did Not Work selected on scheduled shift: ${employeeName}`;
    const body = [
      `${employeeName} selected Did Not Work on a day they were scheduled to be on shift.`,
      '',
      rows,
      '',
      `Week ending: ${timesheet.week_ending}`,
      `Timesheet: /timesheets/new?id=${timesheet.id}`,
      `Timesheet ID: ${timesheet.id}`,
      '',
      'Please add the correct absence booking if this should be recorded as leave or sickness. Draft and submitted timesheets will update from the approved absence booking; processed or adjusted payroll history remains locked.',
    ].join('\n');

    const { data: message, error: messageError } = await admin
      .from('messages')
      .insert({
        type: 'NOTIFICATION',
        subject,
        body,
        priority: 'HIGH',
        sender_id: user.id,
        created_via: CREATED_VIA,
        module_key: 'timesheets',
      } satisfies Database['public']['Tables']['messages']['Insert'])
      .select('id')
      .single();

    if (messageError) throw messageError;

    const { error: recipientsError } = await admin
      .from('message_recipients')
      .insert(
        recipients.map((profileId) => ({
          message_id: message.id,
          user_id: profileId,
          status: 'PENDING' as const,
        }))
      );

    if (recipientsError) throw recipientsError;

    return NextResponse.json({ success: true, notified: true, recipients: recipients.length });
  } catch (error) {
    console.error('Error sending Did Not Work notification:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to notify managers' },
      { status: 500 }
    );
  }
}
