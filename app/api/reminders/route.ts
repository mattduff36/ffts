import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { mapReminderActionWithAsset } from '@/lib/server/reminders/generate-fleet-inspection-actions';
import { getReminderActionRequiredModule } from '@/lib/utils/reminder-action-permissions';
import { getReminderTaskLinkForAction, getReminderTaskName } from '@/lib/utils/reminder-task-links';
import type { ReminderWithAction } from '@/types/reminders';

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export async function GET(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canViewReminders = await canEffectiveRoleAccessModule('reminders');
    if (!canViewReminders) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const statusFilter = request.nextUrl.searchParams.get('status') || 'pending';
    const admin = createAdminClient();

    let query = admin
      .from('reminders')
      .select(`
        id,
        action_id,
        assigned_to,
        assigned_by,
        status,
        action_note,
        actioned_at,
        actioned_by,
        cancelled_at,
        created_at,
        updated_at,
        action:reminder_actions (
          id,
          workflow_key,
          source_type,
          dedupe_key,
          status,
          priority,
          title,
          description,
          asset_type,
          van_id,
          plant_id,
          hgv_id,
          metadata,
          created_by,
          resolved_by,
          ignored_until,
          ignored_forever,
          ignored_at,
          ignored_by,
          first_detected_at,
          last_detected_at,
          resolved_at,
          created_at,
          updated_at
        )
      `)
      .eq('assigned_to', current.profile.id)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const assignerIds = uniqueValues((data || []).map((row) => row.assigned_by));
    const assignersById = new Map<string, string>();

    if (assignerIds.length > 0) {
      const { data: assigners, error: assignersError } = await admin
        .from('profiles')
        .select('id, full_name')
        .in('id', assignerIds);

      if (assignersError) throw assignersError;

      (assigners || []).forEach((assigner) => {
        assignersById.set(assigner.id, assigner.full_name || 'Unknown user');
      });
    }

    const moduleAccessByName = new Map<string, boolean>();
    const reminders: ReminderWithAction[] = [];

    for (const row of data || []) {
      const actionRow = Array.isArray(row.action) ? row.action[0] : row.action;
      if (!actionRow) {
        continue;
      }

      const action = mapReminderActionWithAsset({
        ...actionRow,
        reminders: [],
      });
      const requiredModule = getReminderActionRequiredModule(action.asset_type);
      let hasTaskAccess = moduleAccessByName.get(requiredModule);
      if (typeof hasTaskAccess !== 'boolean') {
        hasTaskAccess = await canEffectiveRoleAccessModule(requiredModule);
        moduleAccessByName.set(requiredModule, hasTaskAccess);
      }

      const taskLink = hasTaskAccess ? getReminderTaskLinkForAction(action) : null;

      reminders.push({
        ...row,
        assigned_by_name: row.assigned_by ? assignersById.get(row.assigned_by) || null : null,
        task_href: taskLink?.href || null,
        task_label: taskLink?.label || null,
        task_name: getReminderTaskName(action.asset_type),
        action: {
          ...action,
          asset_route: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      reminders,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reminders',
      additionalData: {
        endpoint: 'GET /api/reminders',
      },
    });

    return NextResponse.json(
      { error: 'Failed to load reminders' },
      { status: 500 },
    );
  }
}
