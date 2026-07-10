import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  notifyProcessedAbsenceChange,
  type ProcessedAbsenceChangeAction,
  type ProcessedAbsenceNotificationSnapshot,
} from '@/lib/server/processed-absence-notifications';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ProcessedAbsenceChangeRequest {
  action?: string;
  previousAbsence?: ProcessedAbsenceNotificationSnapshot | null;
  changedFields?: string[];
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
  profile: {
    full_name: string | null;
  } | Array<{
    full_name: string | null;
  }> | null;
}

function pickSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isProcessedAbsenceChangeAction(value: string | undefined): value is ProcessedAbsenceChangeAction {
  return value === 'updated' || value === 'cancelled' || value === 'deleted';
}

function toSnapshot(row: AbsenceRow): ProcessedAbsenceNotificationSnapshot {
  return {
    id: row.id,
    profileId: row.profile_id,
    employeeName: pickSingleRelation(row.profile)?.full_name || null,
    reasonName: pickSingleRelation(row.absence_reasons)?.name || null,
    startDate: row.date,
    endDate: row.end_date,
    status: row.status,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canNotifyProcessedAbsenceChange = await canEffectiveRoleAccessModule('approvals');
    if (!canNotifyProcessedAbsenceChange) {
      return NextResponse.json(
        { error: 'Approvals access required to notify processed absence changes' },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Absence id is required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as ProcessedAbsenceChangeRequest;
    if (!isProcessedAbsenceChangeAction(body.action)) {
      return NextResponse.json({ error: 'Valid change action is required' }, { status: 400 });
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
        profile:profiles!absences_profile_id_fkey(full_name)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || 'Failed to load processed absence booking');
    }

    const currentSnapshot = data ? toSnapshot(data as unknown as AbsenceRow) : null;
    const previousSnapshot = body.previousAbsence || currentSnapshot;

    if (!previousSnapshot) {
      return NextResponse.json({ error: 'Processed absence details are required' }, { status: 400 });
    }

    if (previousSnapshot.status !== 'processed') {
      return NextResponse.json({ success: true, notifiedProfileIds: [], skipped: true });
    }

    const notifiedProfileIds = await notifyProcessedAbsenceChange(admin, {
      actorUserId: effectiveRole.user_id,
      action: body.action,
      before: previousSnapshot,
      after: currentSnapshot,
      changedFields: body.changedFields,
    });

    return NextResponse.json({
      success: true,
      notifiedProfileIds,
    });
  } catch (error) {
    console.error('Error notifying processed absence change:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/absence/[id]/processed-change-notification',
      additionalData: {
        endpoint: '/api/absence/[id]/processed-change-notification',
      },
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
