import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { templateConfig } from '@/lib/config/template-config';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { logServerError } from '@/lib/utils/server-error-logger';

type AdminClient = ReturnType<typeof createAdminClient>;

interface RouteContext {
  params: Promise<{ id: string }>;
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
  profile_id: string;
  date: string;
  end_date: string | null;
  status: string;
  absence_reasons: {
    name: string | null;
  } | null;
  profile: ProfileRow | null;
}

function formatCalendarDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatAbsenceRange(startDate: string, endDate: string | null): string {
  if (endDate && endDate !== startDate) {
    return `${formatCalendarDate(startDate)} to ${formatCalendarDate(endDate)}`;
  }

  return formatCalendarDate(startDate);
}

async function resolveManagerProfileId(
  admin: AdminClient,
  profile: ProfileRow
): Promise<string | null> {
  if (profile.line_manager_id) return profile.line_manager_id;
  if (profile.secondary_manager_id) return profile.secondary_manager_id;
  if (!profile.team_id) return null;

  const { data, error } = await admin
    .from('org_teams')
    .select('manager_1_profile_id, manager_2_profile_id')
    .eq('id', profile.team_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to resolve team manager');
  }

  const team = data as OrgTeamRow | null;
  return team?.manager_1_profile_id ?? team?.manager_2_profile_id ?? null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Absence id is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('absences')
      .select(`
        id,
        profile_id,
        date,
        end_date,
        status,
        absence_reasons(name),
        profile:profiles!absences_profile_id_fkey(
          id,
          full_name,
          team_id,
          line_manager_id,
          secondary_manager_id
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || 'Failed to load absence booking');
    }

    const absence = data as AbsenceRow | null;
    if (!absence) {
      return NextResponse.json({ error: 'Absence booking not found' }, { status: 404 });
    }

    if (absence.profile_id !== current.profile.id) {
      return NextResponse.json({ error: 'You can only request help for your own booking' }, { status: 403 });
    }

    if (!absence.profile) {
      return NextResponse.json({ error: 'Employee profile could not be found for this booking' }, { status: 400 });
    }

    if (!['pending', 'approved', 'processed'].includes(absence.status)) {
      return NextResponse.json({ error: 'Only active leave bookings can notify a manager' }, { status: 400 });
    }

    const managerProfileId = await resolveManagerProfileId(admin, absence.profile);
    if (!managerProfileId) {
      return NextResponse.json({ error: 'No line manager is assigned to your profile' }, { status: 400 });
    }

    const employeeName = current.profile.full_name || absence.profile.full_name || 'An employee';
    const reasonName = absence.absence_reasons?.name?.trim() || 'Leave';
    const bookingRange = formatAbsenceRange(absence.date, absence.end_date);
    const subject = `Leave cancellation request from ${employeeName}`;
    const body = [
      `${employeeName} tried to cancel a leave booking in ${templateConfig.branding.appName}.`,
      '',
      `Type: ${reasonName}`,
      `Booking: ${bookingRange}`,
      `Current status: ${absence.status}`,
      '',
      'Direct cancellation is disabled in the app. Please contact them to discuss the change.',
    ].join('\n');

    const { data: message, error: messageError } = await admin
      .from('messages')
      .insert({
        type: 'NOTIFICATION',
        subject,
        body,
        priority: 'LOW',
        sender_id: current.profile.id,
        created_via: 'absence_contact_line_manager',
        module_key: 'absence',
      })
      .select('id')
      .single();

    if (messageError || !message?.id) {
      throw new Error(messageError?.message || 'Failed to create manager notification');
    }

    const { error: recipientError } = await admin
      .from('message_recipients')
      .insert({
        message_id: message.id,
        user_id: managerProfileId,
        status: 'PENDING' as const,
      });

    if (recipientError) {
      throw new Error(recipientError.message || 'Failed to assign manager notification');
    }

    return NextResponse.json({
      success: true,
      message: 'Your line manager has been notified. Please contact them about this booking.',
    });
  } catch (error) {
    console.error('Error in POST /api/absence/[id]/contact-line-manager:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/absence/[id]/contact-line-manager',
      additionalData: {
        endpoint: '/api/absence/[id]/contact-line-manager',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
