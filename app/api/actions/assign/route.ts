import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';
import { getReminderActionRequiredModule } from '@/lib/utils/reminder-action-permissions';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { AssignRemindersRequest } from '@/types/reminders';

function getUniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function POST(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as AssignRemindersRequest;
    const actionId = body.action_id?.trim();
    const assigneeIds = getUniqueIds(body.assignee_ids || []);

    if (!actionId) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 });
    }

    if (assigneeIds.length === 0) {
      return NextResponse.json({ error: 'At least one assignee is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: action, error: actionError } = await admin
      .from('reminder_actions')
      .select('id, status, asset_type')
      .eq('id', actionId)
      .maybeSingle();

    if (actionError) {
      throw actionError;
    }

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (action.status !== 'open') {
      return NextResponse.json({ error: 'Only open actions can be assigned' }, { status: 400 });
    }

    const requiredModule = getReminderActionRequiredModule(action.asset_type);
    const allowedUsers = await getUsersWithModuleAccess(requiredModule, assigneeIds, admin);
    const validAssigneeIds = assigneeIds.filter((id) => allowedUsers.has(id));
    if (validAssigneeIds.length === 0) {
      return NextResponse.json({ error: 'No selected users can receive reminders' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const rows = validAssigneeIds.map((assigneeId) => ({
      action_id: actionId,
      assigned_to: assigneeId,
      assigned_by: current.profile.id,
      status: 'pending' as const,
      action_note: null,
      actioned_at: null,
      actioned_by: null,
      cancelled_at: null,
      updated_at: nowIso,
    }));

    const { data, error } = await admin
      .from('reminders')
      .upsert(rows, { onConflict: 'action_id,assigned_to' })
      .select('id');

    if (error) {
      throw error;
    }

    const { error: clearIgnoreError } = await admin
      .from('reminder_actions')
      .update({
        ignored_until: null,
        ignored_forever: false,
        ignored_at: null,
        ignored_by: null,
        updated_at: nowIso,
      })
      .eq('id', actionId);

    if (clearIgnoreError) {
      throw clearIgnoreError;
    }

    return NextResponse.json({
      success: true,
      assigned_count: (data || []).length,
      skipped_count: assigneeIds.length - validAssigneeIds.length,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions/assign',
      additionalData: {
        endpoint: 'POST /api/actions/assign',
      },
    });

    return NextResponse.json(
      { error: 'Failed to assign reminders' },
      { status: 500 },
    );
  }
}
