import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  completeReminderActionForAsset,
  completeVanDraftSubmissionReminder,
} from '@/lib/server/reminders/complete-reminder-action';
import { getReminderActionRequiredModule } from '@/lib/utils/reminder-action-permissions';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { ReminderAssetType } from '@/types/reminders';

const completeInspectionReminderSchema = z.object({
  assetType: z.enum(['van', 'plant', 'hgv']),
  assetId: z.string().trim().min(1),
  assignedTo: z.string().trim().uuid(),
  draftInspectionId: z.string().trim().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = completeInspectionReminderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid reminder completion request' }, { status: 400 });
    }

    const assetType = parsed.data.assetType as ReminderAssetType;
    const requiredModule = getReminderActionRequiredModule(assetType);
    const canCompleteFromModule = await canEffectiveRoleAccessModule(requiredModule);
    if (!canCompleteFromModule) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();
    const assetResult = await completeReminderActionForAsset({
      admin,
      assetType,
      assetId: parsed.data.assetId,
      assignedTo: parsed.data.assignedTo,
      actionedBy: current.profile.id,
    });
    const draftResult = parsed.data.draftInspectionId
      ? await completeVanDraftSubmissionReminder({
          admin,
          draftInspectionId: parsed.data.draftInspectionId,
          assignedTo: parsed.data.assignedTo,
          actionedBy: current.profile.id,
        })
      : null;

    return NextResponse.json({
      success: true,
      actionedCount: assetResult.actionedCount + (draftResult?.actionedCount || 0),
      cancelledCount: assetResult.cancelledCount + (draftResult?.cancelledCount || 0),
      actionIds: Array.from(new Set([
        ...assetResult.actionIds,
        ...(draftResult?.actionIds || []),
      ])),
      assetResult,
      draftResult,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reminders/complete-inspection-action',
      additionalData: {
        endpoint: 'POST /api/reminders/complete-inspection-action',
      },
    });

    return NextResponse.json(
      { error: 'Failed to complete reminder' },
      { status: 500 },
    );
  }
}
