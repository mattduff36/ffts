import { createAdminClient } from '@/lib/supabase/admin';
import {
  FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
  VAN_DRAFT_SUBMISSION_WORKFLOW_KEY,
} from '@/lib/config/reminder-workflows';
import { getVanDraftSubmissionDedupeKey } from '@/lib/utils/van-draft-submission-reminders';
import type { ReminderAssetType } from '@/types/reminders';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface CompleteReminderActionInput {
  admin: AdminClient;
  assetType: ReminderAssetType;
  assetId: string;
  assignedTo: string;
  actionedBy: string;
  nowIso?: string;
}

export interface CompleteReminderActionResult {
  actionedCount: number;
  cancelledCount: number;
  actionIds: string[];
}

export interface CompleteVanDraftSubmissionReminderInput {
  admin: AdminClient;
  draftInspectionId: string;
  assignedTo: string;
  actionedBy: string;
  nowIso?: string;
}

export function getReminderAssetIdColumn(assetType: ReminderAssetType): 'van_id' | 'plant_id' | 'hgv_id' {
  if (assetType === 'plant') return 'plant_id';
  if (assetType === 'hgv') return 'hgv_id';
  return 'van_id';
}

export async function completeReminderActionForAsset({
  admin,
  assetType,
  assetId,
  assignedTo,
  actionedBy,
  nowIso = new Date().toISOString(),
}: CompleteReminderActionInput): Promise<CompleteReminderActionResult> {
  const assetColumn = getReminderAssetIdColumn(assetType);
  const { data: actions, error: actionsError } = await admin
    .from('reminder_actions')
    .select('id')
    .eq('workflow_key', FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY)
    .eq('status', 'open')
    .eq('asset_type', assetType)
    .eq(assetColumn, assetId);

  if (actionsError) throw actionsError;

  const actionIds = (actions || []).map((action) => action.id);
  if (actionIds.length === 0) {
    return {
      actionedCount: 0,
      cancelledCount: 0,
      actionIds: [],
    };
  }

  const { data: actionedRows, error: actionedError } = await admin
    .from('reminders')
    .update({
      status: 'actioned',
      action_note: 'Completed by submitted daily check.',
      actioned_at: nowIso,
      actioned_by: actionedBy,
      cancelled_at: null,
      updated_at: nowIso,
    })
    .in('action_id', actionIds)
    .eq('assigned_to', assignedTo)
    .eq('status', 'pending')
    .select('id, action_id');

  if (actionedError) throw actionedError;

  const { data: cancelledRows, error: cancelledError } = await admin
    .from('reminders')
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      updated_at: nowIso,
    })
    .in('action_id', actionIds)
    .eq('status', 'pending')
    .select('id');

  if (cancelledError) throw cancelledError;

  const { error: resolveError } = await admin
    .from('reminder_actions')
    .update({
      status: 'resolved',
      resolved_at: nowIso,
      resolved_by: actionedBy,
      last_detected_at: nowIso,
      updated_at: nowIso,
    })
    .in('id', actionIds);

  if (resolveError) throw resolveError;

  return {
    actionedCount: (actionedRows || []).length,
    cancelledCount: (cancelledRows || []).length,
    actionIds,
  };
}

export async function completeVanDraftSubmissionReminder({
  admin,
  draftInspectionId,
  assignedTo,
  actionedBy,
  nowIso = new Date().toISOString(),
}: CompleteVanDraftSubmissionReminderInput): Promise<CompleteReminderActionResult> {
  const { data: action, error: actionError } = await admin
    .from('reminder_actions')
    .select('id')
    .eq('workflow_key', VAN_DRAFT_SUBMISSION_WORKFLOW_KEY)
    .eq('dedupe_key', getVanDraftSubmissionDedupeKey(draftInspectionId))
    .eq('status', 'open')
    .maybeSingle();

  if (actionError) throw actionError;

  if (!action) {
    return {
      actionedCount: 0,
      cancelledCount: 0,
      actionIds: [],
    };
  }

  const { data: actionedRows, error: actionedError } = await admin
    .from('reminders')
    .update({
      status: 'actioned',
      action_note: 'Completed by signed draft van daily check submission.',
      actioned_at: nowIso,
      actioned_by: actionedBy,
      cancelled_at: null,
      updated_at: nowIso,
    })
    .eq('action_id', action.id)
    .eq('assigned_to', assignedTo)
    .eq('status', 'pending')
    .select('id');

  if (actionedError) throw actionedError;

  const actionedCount = (actionedRows || []).length;
  if (actionedCount === 0) {
    return {
      actionedCount: 0,
      cancelledCount: 0,
      actionIds: [action.id],
    };
  }

  const { error: resolveError } = await admin
    .from('reminder_actions')
    .update({
      status: 'resolved',
      resolved_at: nowIso,
      resolved_by: actionedBy,
      last_detected_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', action.id);

  if (resolveError) throw resolveError;

  return {
    actionedCount,
    cancelledCount: 0,
    actionIds: [action.id],
  };
}
