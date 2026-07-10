import type { ReminderAssetType } from '@/types/reminders';
import { VAN_DRAFT_SUBMISSION_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import {
  getVanDraftSubmissionHref,
  VAN_DRAFT_SUBMISSION_CTA_LABEL,
} from '@/lib/utils/van-draft-submission-reminders';

export interface ReminderTaskLink {
  href: string;
  label: string;
}

const TASK_LINKS_BY_ASSET_TYPE: Record<ReminderAssetType, ReminderTaskLink> = {
  van: {
    href: '/van-inspections/new',
    label: 'Start van daily check',
  },
  plant: {
    href: '/plant-inspections/new',
    label: 'Start plant daily check',
  },
  hgv: {
    href: '/hgv-inspections/new',
    label: 'Start HGV daily check',
  },
};

const VAN_DRAFT_SUBMISSION_DEDUPE_PREFIX = `${VAN_DRAFT_SUBMISSION_WORKFLOW_KEY}:`;

export function getReminderTaskLink(assetType: ReminderAssetType | null | undefined): ReminderTaskLink | null {
  if (!assetType) return null;

  return TASK_LINKS_BY_ASSET_TYPE[assetType] || null;
}

function getMetadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getDraftInspectionIdFromDedupeKey(dedupeKey: string | null | undefined): string | null {
  if (!dedupeKey?.startsWith(VAN_DRAFT_SUBMISSION_DEDUPE_PREFIX)) return null;

  const draftInspectionId = dedupeKey.slice(VAN_DRAFT_SUBMISSION_DEDUPE_PREFIX.length).trim();
  return draftInspectionId || null;
}

function getSpecificDraftHref(draftHref: string | null): string | null {
  if (!draftHref) return null;

  try {
    const url = new URL(draftHref, 'https://ffts.local');
    const draftInspectionId = url.searchParams.get('id')?.trim();
    return draftInspectionId ? getVanDraftSubmissionHref(draftInspectionId) : null;
  } catch {
    return null;
  }
}

export function getReminderTaskLinkForAction(action: {
  workflow_key: string;
  dedupe_key?: string | null;
  asset_type: ReminderAssetType | null;
  metadata: Record<string, unknown>;
}): ReminderTaskLink | null {
  if (action.workflow_key === VAN_DRAFT_SUBMISSION_WORKFLOW_KEY) {
    const draftInspectionId =
      getMetadataString(action.metadata, 'draft_inspection_id') ||
      getDraftInspectionIdFromDedupeKey(action.dedupe_key);
    const draftHref = getMetadataString(action.metadata, 'draft_href');
    const href = draftInspectionId
      ? getVanDraftSubmissionHref(draftInspectionId)
      : getSpecificDraftHref(draftHref);

    return href
      ? {
          href,
          label: VAN_DRAFT_SUBMISSION_CTA_LABEL,
        }
      : null;
  }

  return getReminderTaskLink(action.asset_type);
}

export function getReminderTaskName(assetType: ReminderAssetType | null | undefined): string {
  if (assetType === 'van') return 'van daily check';
  if (assetType === 'plant') return 'plant daily check';
  if (assetType === 'hgv') return 'HGV daily check';

  return 'assigned task';
}
