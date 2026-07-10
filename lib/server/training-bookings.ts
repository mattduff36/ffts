import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTrainingBookingDeclinedEmail } from '@/lib/utils/email';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { isAdminRole } from '@/lib/utils/role-access';
import { isTrainingReasonName } from '@/lib/utils/timesheet-off-days';
import {
  resolveTrainingTimesheetImpacts,
  returnSubmittedTrainingTimesheetsForAmendment,
} from '@/lib/utils/training-timesheet-impact';
import type { Database } from '@/types/database';

type AdminClient = SupabaseClient<Database>;

interface TrainingCoordinatorConfig {
  profileId: string;
  name: string;
  email: string | null;
}

function getTrainingCoordinatorConfig(): TrainingCoordinatorConfig | null {
  const profileId = process.env.TRAINING_COORDINATOR_PROFILE_ID?.trim();
  if (!profileId) return null;

  return {
    profileId,
    name: process.env.TRAINING_COORDINATOR_NAME?.trim() || 'Training Coordinator',
    email: process.env.TRAINING_COORDINATOR_EMAIL?.trim() || null,
  };
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  team_id: string | null;
  line_manager_id: string | null;
  secondary_manager_id: string | null;
}

interface OrgTeamRow {
  manager_1_profile_id: string | null;
  manager_2_profile_id: string | null;
}

interface AbsenceRow {
  id: string;
  date: string;
  end_date: string | null;
  is_half_day: boolean | null;
  profile_id: string;
  absence_reasons: {
    name: string | null;
  } | null;
  profile: ProfileRow | null;
}

interface AbsenceQueryRow {
  id: string;
  date: string;
  end_date: string | null;
  is_half_day: boolean | null;
  profile_id: string;
  absence_reasons: AbsenceRow['absence_reasons'] | AbsenceRow['absence_reasons'][];
  profile: ProfileRow | ProfileRow[] | null;
}

interface NotificationRecipient {
  profileId: string;
  name: string;
  email: string | null;
}

export interface DeclineTrainingBookingsResult {
  deletedAbsenceIds: string[];
  employeeName: string;
  trainingDate: string;
  notifiedProfileIds: string[];
  returnedTimesheetIds: string[];
}

function formatTrainingDate(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function pickSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function getAuthEmail(admin: AdminClient, profileId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(profileId);
  if (error) {
    console.error(`Failed to fetch auth email for ${profileId}:`, error);
    return null;
  }

  return data.user?.email ?? null;
}

async function resolvePrimaryManager(admin: AdminClient, profile: ProfileRow): Promise<string | null> {
  if (profile.line_manager_id) return profile.line_manager_id;
  if (profile.secondary_manager_id) return profile.secondary_manager_id;
  if (!profile.team_id) return null;

  const { data, error } = await admin
    .from('org_teams')
    .select('manager_1_profile_id, manager_2_profile_id')
    .eq('id', profile.team_id)
    .maybeSingle();

  if (error) {
    console.error('Failed to resolve org team managers for training booking:', error);
    return null;
  }

  const team = data as OrgTeamRow | null;
  return team?.manager_1_profile_id ?? team?.manager_2_profile_id ?? null;
}

async function resolveTrainingCoordinator(
  admin: AdminClient
): Promise<NotificationRecipient | null> {
  const config = getTrainingCoordinatorConfig();
  if (!config) return null;

  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('id', config.profileId)
    .maybeSingle();

  if (error) {
    console.error('Failed to resolve the configured training coordinator profile:', error);
    return null;
  }

  const profile = data as { id: string; full_name: string | null } | null;
  if (!profile?.id) {
    return null;
  }

  return {
    profileId: profile.id,
    name: profile.full_name || config.name,
    email: config.email || await getAuthEmail(admin, profile.id),
  };
}

async function resolveNotificationRecipients(
  admin: AdminClient,
  profile: ProfileRow
): Promise<NotificationRecipient[]> {
  const recipients: NotificationRecipient[] = [];
  const managerProfileId = await resolvePrimaryManager(admin, profile);

  if (managerProfileId) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('id', managerProfileId)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch team manager profile for training booking:', error);
    } else if (data?.id) {
      recipients.push({
        profileId: data.id,
        name: data.full_name || 'Team Manager',
        email: await getAuthEmail(admin, data.id),
      });
    }
  }

  const trainingCoordinator = await resolveTrainingCoordinator(admin);
  if (trainingCoordinator) {
    recipients.push(trainingCoordinator);
  }

  return recipients.filter(
    (recipient, index, list) =>
      Boolean(recipient.profileId) &&
      list.findIndex((candidate) => candidate.profileId === recipient.profileId) === index
  );
}

async function createNotification(
  admin: AdminClient,
  senderId: string,
  recipientIds: string[],
  subject: string,
  body: string
): Promise<void> {
  if (recipientIds.length === 0) return;

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      type: 'NOTIFICATION',
      subject,
      body,
      priority: 'LOW',
      sender_id: senderId,
      created_via: 'timesheet_training_decline',
      module_key: 'training',
    })
    .select('id')
    .single();

  if (messageError || !message?.id) {
    throw new Error(messageError?.message || 'Failed to create training notification message');
  }

  const { error: recipientsError } = await admin.from('message_recipients').insert(
    recipientIds.map((recipientId) => ({
      message_id: message.id,
      user_id: recipientId,
      status: 'PENDING' as const,
    }))
  );

  if (recipientsError) {
    throw new Error(recipientsError.message || 'Failed to create training notification recipients');
  }
}

export async function declineTrainingBookings(
  actorUserId: string,
  absenceIds: string[]
): Promise<DeclineTrainingBookingsResult> {
  const uniqueAbsenceIds = Array.from(new Set(absenceIds.filter(Boolean)));
  if (uniqueAbsenceIds.length === 0) {
    throw new Error('At least one training booking is required');
  }

  const actorProfile = await getProfileWithRole(actorUserId);
  if (!actorProfile) {
    throw new Error('Actor profile not found');
  }

  const canManageOthers =
    Boolean(actorProfile.is_super_admin) ||
    isAdminRole(actorProfile.role) ||
    Boolean(actorProfile.role?.is_manager_admin);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('absences')
    .select(`
      id,
      date,
      end_date,
      is_half_day,
      profile_id,
      absence_reasons(name),
      profile:profiles!absences_profile_id_fkey(
        id,
        full_name,
        team_id,
        line_manager_id,
        secondary_manager_id
      )
    `)
    .in('id', uniqueAbsenceIds);

  if (error) {
    throw new Error(error.message || 'Failed to load training booking');
  }

  const rows = ((data || []) as unknown as AbsenceQueryRow[]).map<AbsenceRow>((row) => ({
    id: row.id,
    date: row.date,
    end_date: row.end_date,
    is_half_day: row.is_half_day,
    profile_id: row.profile_id,
    absence_reasons: pickSingleRelation(row.absence_reasons),
    profile: pickSingleRelation(row.profile),
  }));
  if (rows.length !== uniqueAbsenceIds.length) {
    throw new Error('One or more training bookings could not be found');
  }

  const firstRow = rows[0];
  const profile = firstRow?.profile;
  if (!profile) {
    throw new Error('Employee profile not found for training booking');
  }

  const sameEmployee = rows.every((row) => row.profile_id === firstRow.profile_id);
  const sameDate = rows.every((row) => row.date === firstRow.date);
  if (!sameEmployee || !sameDate) {
    throw new Error('Training bookings must belong to the same employee and day');
  }

  const invalidReason = rows.find((row) => !isTrainingReasonName(row.absence_reasons?.name));
  if (invalidReason) {
    throw new Error('Only Training bookings can be declined from the timesheet');
  }

  if (!canManageOthers && firstRow.profile_id !== actorUserId) {
    throw new Error('You do not have permission to decline this training booking');
  }

  const timesheetImpacts = await resolveTrainingTimesheetImpacts(admin, {
    profileId: firstRow.profile_id,
    startDate: firstRow.date,
    endDate: firstRow.end_date,
    isHalfDay: firstRow.is_half_day,
  });
  if (timesheetImpacts.some((impact) => impact.status === 'processed' || impact.status === 'adjusted')) {
    throw new Error('Training bookings linked to processed or adjusted timesheets cannot be removed from the timesheet flow');
  }

  const { error: deleteError } = await admin.from('absences').delete().in('id', uniqueAbsenceIds);
  if (deleteError) {
    throw new Error(deleteError.message || 'Failed to delete training booking');
  }

  const returnedTimesheetIds = await returnSubmittedTrainingTimesheetsForAmendment(admin, {
    actorUserId,
    impacts: timesheetImpacts,
    reason: 'Removed',
  });

  const employeeName = profile.full_name || 'Employee';
  const actorName = actorProfile.full_name || 'a colleague';
  const trainingDate = formatTrainingDate(firstRow.date);
  const recipients = await resolveNotificationRecipients(admin, profile);

  const subject = `Training booking removed for ${employeeName}`;
  const body = `${employeeName} confirmed they did not attend their booked training on ${trainingDate}. The booking was deleted from the timesheet flow by ${actorName}.`;

  try {
    await createNotification(
      admin,
      actorUserId,
      recipients.map((recipient) => recipient.profileId),
      subject,
      body
    );
  } catch (notificationError) {
    console.error('Failed to create training decline notifications:', notificationError);
  }

  await Promise.all(
    recipients.map(async (recipient) => {
      const recipientEmail = recipient.email;
      if (!recipientEmail) {
        return;
      }

      const result = await sendTrainingBookingDeclinedEmail({
        to: recipientEmail,
        recipientName: recipient.name,
        employeeName,
        trainingDate,
        declinedBy: actorName,
      });

      if (!result.success) {
        console.error(`Failed to send training decline email to ${recipientEmail}:`, result.error);
      }
    })
  );

  return {
    deletedAbsenceIds: uniqueAbsenceIds,
    employeeName,
    trainingDate,
    notifiedProfileIds: recipients.map((recipient) => recipient.profileId),
    returnedTimesheetIds,
  };
}
