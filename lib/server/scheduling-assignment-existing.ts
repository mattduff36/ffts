import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExistingScheduleAssignmentRow {
  assignment_id: string;
  job_id: string;
  work_date: string;
  visit_id: string | null;
  notes: string | null;
  conflict_override: boolean;
  conflict_codes: string[];
  conflict_override_by: string | null;
  conflict_override_at: string | null;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
  profile_id: string | null;
  plant_id: string | null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function mapExistingAssignmentRow(
  row: Record<string, unknown>,
  resourceType: 'employee' | 'plant'
): ExistingScheduleAssignmentRow {
  return {
    assignment_id: String(row.id),
    job_id: String(row.job_id),
    work_date: String(row.work_date),
    visit_id: asOptionalString(row.visit_id),
    notes: asOptionalString(row.notes),
    conflict_override: row.conflict_override === true,
    conflict_codes: Array.isArray(row.conflict_codes)
      ? row.conflict_codes.filter((code): code is string => typeof code === 'string')
      : [],
    conflict_override_by: asOptionalString(row.conflict_override_by),
    conflict_override_at: asOptionalString(row.conflict_override_at),
    assigned_by: asOptionalString(row.assigned_by),
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || new Date().toISOString()),
    profile_id: resourceType === 'employee' ? String(row.profile_id || '') : null,
    plant_id: resourceType === 'plant' ? String(row.plant_id || '') : null,
  };
}

export async function loadExactVisitAssignment(
  admin: SupabaseClient,
  input: {
    jobId: string;
    visitId: string;
    resourceType: 'employee' | 'plant';
    resourceId: string;
  }
): Promise<ExistingScheduleAssignmentRow | null> {
  const table =
    input.resourceType === 'employee'
      ? 'schedule_employee_assignments'
      : 'schedule_plant_assignments';
  const resourceColumn = input.resourceType === 'employee' ? 'profile_id' : 'plant_id';
  const result = await admin
    .from(table)
    .select('*')
    .eq('job_id', input.jobId)
    .eq('visit_id', input.visitId)
    .eq(resourceColumn, input.resourceId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  return mapExistingAssignmentRow(result.data as Record<string, unknown>, input.resourceType);
}
