import type { InspectionReferenceType } from '@/lib/utils/reference-ids';

export interface LinkedInspectionTaskSummary {
  id: string;
  action_type: string;
  status: string;
  created_at: string | null;
  logged_at: string | null;
  actioned_at: string | null;
  inspection_item_id?: string | null;
  logged_comment?: string | null;
  workshop_comments?: string | null;
}

export async function fetchInspectionLinks(
  inspectionId: string,
  inspectionType: InspectionReferenceType
): Promise<LinkedInspectionTaskSummary[]> {
  const response = await fetch(
    `/api/inspection-links?inspectionId=${encodeURIComponent(inspectionId)}&inspectionType=${inspectionType}`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch linked inspection tasks');
  }

  const payload = await response.json();
  return Array.isArray(payload.linkedTasks) ? payload.linkedTasks : [];
}
