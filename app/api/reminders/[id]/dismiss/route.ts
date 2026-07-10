import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canViewReminders = await canEffectiveRoleAccessModule('reminders');
    if (!canViewReminders) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id: reminderId } = await params;
    const admin = createAdminClient();
    const { data: reminder, error: reminderError } = await admin
      .from('reminders')
      .select(`
        id,
        action_id,
        assigned_to,
        status,
        action:reminder_actions (
          id,
          workflow_key,
          status
        )
      `)
      .eq('id', reminderId)
      .eq('assigned_to', current.profile.id)
      .maybeSingle();

    if (reminderError) {
      throw reminderError;
    }

    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    const action = Array.isArray(reminder.action) ? reminder.action[0] : reminder.action;
    if (!action || action.workflow_key !== TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY) {
      return NextResponse.json({ error: 'Only manual reminders can be dismissed here' }, { status: 400 });
    }

    if (reminder.status !== 'pending') {
      return NextResponse.json({ success: true, reminder });
    }

    const nowIso = new Date().toISOString();
    const { data: updatedReminder, error: updateError } = await admin
      .from('reminders')
      .update({
        status: 'actioned',
        action_note: 'Dismissed from Reminders module.',
        actioned_at: nowIso,
        actioned_by: current.profile.id,
        cancelled_at: null,
        updated_at: nowIso,
      })
      .eq('id', reminderId)
      .eq('assigned_to', current.profile.id)
      .select('id, action_id, status')
      .single();

    if (updateError || !updatedReminder) {
      throw updateError || new Error('Failed to dismiss reminder');
    }

    const { count, error: pendingCountError } = await admin
      .from('reminders')
      .select('id', { count: 'exact', head: true })
      .eq('action_id', reminder.action_id)
      .eq('status', 'pending');

    if (pendingCountError) {
      throw pendingCountError;
    }

    if ((count || 0) === 0) {
      const { error: resolveError } = await admin
        .from('reminder_actions')
        .update({
          status: 'resolved',
          resolved_at: nowIso,
          resolved_by: current.profile.id,
          updated_at: nowIso,
        })
        .eq('id', reminder.action_id);

      if (resolveError) {
        throw resolveError;
      }
    }

    return NextResponse.json({
      success: true,
      reminder: updatedReminder,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reminders/[id]/dismiss',
      additionalData: {
        endpoint: 'POST /api/reminders/[id]/dismiss',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to dismiss reminder' },
      { status: 500 }
    );
  }
}
