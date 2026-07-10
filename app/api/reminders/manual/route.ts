import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';

function getUniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function POST(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageToolboxTalks = await canEffectiveRoleAccessModule('toolbox-talks');
    if (!canManageToolboxTalks) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as {
      subject?: string;
      body?: string;
      recipient_user_ids?: string[];
    };
    const subject = body.subject?.trim() || '';
    const messageBody = body.body?.trim() || '';
    const assigneeIds = getUniqueIds(body.recipient_user_ids || []);

    if (!subject || !messageBody) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 });
    }

    if (assigneeIds.length === 0) {
      return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const allowedUsers = await getUsersWithModuleAccess('reminders', assigneeIds, admin);
    const validAssigneeIds = assigneeIds.filter((id) => allowedUsers.has(id));
    if (validAssigneeIds.length === 0) {
      return NextResponse.json({ error: 'No selected users can receive reminders' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const dedupeKey = `${TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY}:${crypto.randomUUID()}`;
    const { data: action, error: actionError } = await admin
      .from('reminder_actions')
      .insert({
        workflow_key: TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY,
        source_type: 'manager_created',
        dedupe_key: dedupeKey,
        status: 'open',
        priority: 'medium',
        title: subject,
        description: messageBody,
        asset_type: null,
        van_id: null,
        plant_id: null,
        hgv_id: null,
        metadata: {
          created_from: 'toolbox-talks',
          cta_label: 'Dismiss reminder',
        },
        created_by: current.profile.id,
        first_detected_at: nowIso,
        last_detected_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (actionError || !action) {
      throw actionError || new Error('Failed to create reminder action');
    }

    const reminderRows = validAssigneeIds.map((assigneeId) => ({
      action_id: action.id,
      assigned_to: assigneeId,
      assigned_by: current.profile.id,
      status: 'pending' as const,
      action_note: null,
      actioned_at: null,
      actioned_by: null,
      cancelled_at: null,
      updated_at: nowIso,
    }));

    const { data: reminders, error: remindersError } = await admin
      .from('reminders')
      .insert(reminderRows)
      .select('id');

    if (remindersError) {
      await admin.from('reminder_actions').delete().eq('id', action.id);
      throw remindersError;
    }

    return NextResponse.json({
      success: true,
      action_id: action.id,
      recipients_created: (reminders || []).length,
      skipped_count: assigneeIds.length - validAssigneeIds.length,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reminders/manual',
      additionalData: {
        endpoint: 'POST /api/reminders/manual',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create reminder' },
      { status: 500 }
    );
  }
}
