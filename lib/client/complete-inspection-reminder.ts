import type { ReminderAssetType } from '@/types/reminders';
import { createStatusError } from '@/lib/utils/http-error';

interface CompleteInspectionReminderInput {
  assetType: ReminderAssetType;
  assetId: string;
  assignedTo: string;
  draftInspectionId?: string;
}

function getReminderResponseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'Failed to complete reminder';
  }

  const errorPayload = payload as { error?: unknown; message?: unknown };
  if (typeof errorPayload.error === 'string' && errorPayload.error.trim()) {
    return errorPayload.error;
  }
  if (errorPayload.error && typeof errorPayload.error === 'object' && 'message' in errorPayload.error) {
    const message = String((errorPayload.error as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  if (typeof errorPayload.message === 'string' && errorPayload.message.trim()) {
    return errorPayload.message;
  }

  return 'Failed to complete reminder';
}

export async function completeInspectionReminder({
  assetType,
  assetId,
  assignedTo,
  draftInspectionId,
}: CompleteInspectionReminderInput): Promise<void> {
  const response = await fetch('/api/reminders/complete-inspection-action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assetType,
      assetId,
      assignedTo,
      draftInspectionId,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw createStatusError(getReminderResponseErrorMessage(payload), response.status, payload);
  }
}
