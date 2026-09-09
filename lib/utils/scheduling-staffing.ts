export const REQUIRED_STAFF_MIN = 1;
export const REQUIRED_STAFF_MAX = 20;

export function normalizeRequiredStaffCount(value: unknown): number | null {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) return Number.NaN;
  if (parsed < REQUIRED_STAFF_MIN || parsed > REQUIRED_STAFF_MAX) return Number.NaN;
  return parsed;
}

export function isValidRequiredStaffCount(value: unknown): value is number | null {
  const normalized = normalizeRequiredStaffCount(value);
  return normalized === null || Number.isInteger(normalized);
}

export function countAssignedStaffForJobDate(input: {
  jobId: string;
  workDate: string;
  assignments: Array<{
    job_id: string;
    work_date: string;
    resource_type: string;
    profile_id?: string;
  }>;
}): number {
  const people = new Set<string>();
  for (const assignment of input.assignments) {
    if (
      assignment.job_id === input.jobId
      && assignment.work_date === input.workDate
      && assignment.resource_type === 'employee'
      && assignment.profile_id
    ) {
      people.add(assignment.profile_id);
    }
  }
  return people.size;
}

export function formatStaffingBadge(assigned: number, required: number | null | undefined): {
  label: string;
  short: boolean;
} | null {
  if (required == null) {
    if (assigned <= 0) return null;
    return { label: String(assigned), short: false };
  }
  return {
    label: `${assigned}/${required}`,
    short: assigned < required,
  };
}

export function scheduleEmployeeKindFromRole(
  role: { name?: string | null; display_name?: string | null } | null | undefined
): 'employee' | 'subcontractor' {
  const name = (role?.name || '').trim().toLowerCase();
  const displayName = (role?.display_name || '').trim().toLowerCase();
  if (name === 'contractor' || displayName === 'contractor') return 'subcontractor';
  return 'employee';
}
