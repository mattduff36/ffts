import { NextRequest, NextResponse } from 'next/server';
import { FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  fleetInspectionWorkflowSettingsPatchSchema,
  loadFleetInspectionWorkflowSettings,
  updateFleetInspectionWorkflowSettings,
} from '@/lib/server/reminders/fleet-inspection-workflow-settings';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';

interface RouteContext {
  params: Promise<{ workflowKey: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { workflowKey } = await context.params;
    if (workflowKey !== FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const settings = await loadFleetInspectionWorkflowSettings(admin);

    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request: _request,
      componentName: '/api/actions/settings/[workflowKey]',
      additionalData: {
        endpoint: 'GET /api/actions/settings/[workflowKey]',
      },
    });

    return NextResponse.json(
      { error: 'Failed to load workflow settings' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { workflowKey } = await context.params;
    if (workflowKey !== FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const body = await request.json();
    const parsed = fleetInspectionWorkflowSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid settings payload', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const settings = await updateFleetInspectionWorkflowSettings(admin, {
      patch: parsed.data,
      updatedBy: current.profile.id,
    });

    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions/settings/[workflowKey]',
      additionalData: {
        endpoint: 'PATCH /api/actions/settings/[workflowKey]',
      },
    });

    return NextResponse.json(
      { error: 'Failed to update workflow settings' },
      { status: 500 },
    );
  }
}
