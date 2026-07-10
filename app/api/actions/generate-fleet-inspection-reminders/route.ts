import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { generateFleetInspectionReminderActions } from '@/lib/server/reminders/generate-fleet-inspection-actions';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

async function handleGeneration(initiatedBy: 'cron' | 'manager') {
  const summary = await generateFleetInspectionReminderActions();

  return NextResponse.json({
    success: true,
    initiated_by: initiatedBy,
    summary,
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return await handleGeneration('cron');
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions/generate-fleet-inspection-reminders',
      additionalData: {
        endpoint: 'GET /api/actions/generate-fleet-inspection-reminders',
      },
    });

    return NextResponse.json(
      { error: 'Failed to generate fleet inspection reminders' },
      { status: 500 },
    );
  }
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

    return await handleGeneration('manager');
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions/generate-fleet-inspection-reminders',
      additionalData: {
        endpoint: 'POST /api/actions/generate-fleet-inspection-reminders',
      },
    });

    return NextResponse.json(
      { error: 'Failed to generate fleet inspection reminders' },
      { status: 500 },
    );
  }
}
