import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { IgnoreReminderActionRequest, ReminderActionIgnoreDuration } from '@/types/reminders';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

const ignoreReminderActionSchema = z.object({
  duration: z.enum(['6_weeks', '1_year', 'forever']),
});

function getIgnoredUntil(duration: ReminderActionIgnoreDuration, now: Date): string | null {
  if (duration === 'forever') return null;

  const ignoredUntil = new Date(now);
  if (duration === '1_year') {
    ignoredUntil.setFullYear(ignoredUntil.getFullYear() + 1);
  } else {
    ignoredUntil.setDate(ignoredUntil.getDate() + 42);
  }
  return ignoredUntil.toISOString();
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as IgnoreReminderActionRequest;
    const parsed = ignoreReminderActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid ignore duration', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const admin = createAdminClient();

    const { data: action, error: actionError } = await admin
      .from('reminder_actions')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (actionError) throw actionError;
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }
    if (action.status !== 'open') {
      return NextResponse.json({ error: 'Only open actions can be ignored' }, { status: 400 });
    }

    const { error: updateError } = await admin
      .from('reminder_actions')
      .update({
        ignored_until: getIgnoredUntil(parsed.data.duration, now),
        ignored_forever: parsed.data.duration === 'forever',
        ignored_at: nowIso,
        ignored_by: current.profile.id,
        updated_at: nowIso,
      })
      .eq('id', id);

    if (updateError) throw updateError;

    const { error: cancelError } = await admin
      .from('reminders')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('action_id', id)
      .eq('status', 'pending');

    if (cancelError) throw cancelError;

    return NextResponse.json({
      success: true,
      ignored_until: getIgnoredUntil(parsed.data.duration, now),
      ignored_forever: parsed.data.duration === 'forever',
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions/[id]/ignore',
      additionalData: {
        endpoint: 'POST /api/actions/[id]/ignore',
      },
    });

    return NextResponse.json(
      { error: 'Failed to ignore action' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const nowIso = new Date().toISOString();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('reminder_actions')
      .update({
        ignored_until: null,
        ignored_forever: false,
        ignored_by: null,
        updated_at: nowIso,
      })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions/[id]/ignore',
      additionalData: {
        endpoint: 'DELETE /api/actions/[id]/ignore',
      },
    });

    return NextResponse.json(
      { error: 'Failed to restore ignored action' },
      { status: 500 },
    );
  }
}
