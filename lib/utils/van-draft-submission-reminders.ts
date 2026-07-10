import { getChecklistForCategory, type InspectionStatus } from '@/types/inspection';

export const VAN_DRAFT_SUBMISSION_CTA_LABEL = 'click here to submit draft inspection';

export const VAN_DRAFT_SUBMISSION_RETIREMENT_NOTICE =
  'The 7-day Van Daily Checks have been retired. Van Daily Checks are now to be done daily and submitted each day, to align them with the Plant and HGV Daily Checks.';

export const VAN_DRAFT_SUBMISSION_REMINDER_MESSAGE =
  `Please ${VAN_DRAFT_SUBMISSION_CTA_LABEL}. ${VAN_DRAFT_SUBMISSION_RETIREMENT_NOTICE}`;

export interface VanDraftInspectionItemForReminder {
  item_number: number | null;
  day_of_week: number | null;
  status: InspectionStatus | string | null;
}

export interface VanDraftInspectionForReminder {
  id: string;
  status: 'draft' | 'submitted' | string | null;
  inspection_date: string | null;
  submitted_at?: string | null;
  signed_at?: string | null;
  signature_data?: string | null;
  current_mileage?: number | null;
  vans?: {
    vehicle_type?: string | null;
    van_categories?: { name?: string | null } | null;
  } | null;
  inspection_items?: VanDraftInspectionItemForReminder[] | null;
}

export function getVanDraftSubmissionDedupeKey(draftInspectionId: string): string {
  return `van_draft_submission:${draftInspectionId}`;
}

export function getVanDraftSubmissionHref(draftInspectionId: string): string {
  return `/van-inspections/new?id=${encodeURIComponent(draftInspectionId)}`;
}

export function getVanDraftExpectedChecklistCount(
  categoryName: string | null | undefined,
  vehicleType: string | null | undefined,
): number {
  return getChecklistForCategory(categoryName || vehicleType || 'Truck').length;
}

export function isVanDraftInspectionForReminder(
  inspection: VanDraftInspectionForReminder,
): boolean {
  if (inspection.status !== 'draft') return false;
  if (inspection.submitted_at || inspection.signed_at || inspection.signature_data) return false;
  return true;
}
