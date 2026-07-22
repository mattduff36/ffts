import { describe, expect, it } from 'vitest';
import {
  doesAssignmentOverlapVisit,
  isResourceUnavailableForVisit,
} from '@/lib/utils/scheduling-availability';
import type { ScheduleEmployeeAssignment, ScheduleVisit } from '@/types/scheduling';

function visit(
  id: string,
  startsAt: string,
  endsAt: string
): ScheduleVisit {
  return {
    id,
    job_id: `job-${id}`,
    sequence_number: 1,
    title: null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'planned',
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: startsAt,
    updated_at: startsAt,
  };
}

function assignment(assignedVisit: ScheduleVisit | null): ScheduleEmployeeAssignment {
  return {
    id: 'assignment-1',
    job_id: assignedVisit?.job_id || 'legacy-job',
    work_date: '2026-07-14',
    visit_id: assignedVisit?.id || null,
    profile_id: 'employee-1',
    resource_type: 'employee',
    employee: null,
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-07-14T07:00:00Z',
    updated_at: '2026-07-14T07:00:00Z',
    conflicts: [],
    visit: assignedVisit,
  };
}

describe('scheduling availability', () => {
  const morning = visit(
    'morning',
    '2026-07-14T08:00:00Z',
    '2026-07-14T12:00:00Z'
  );
  const overlapping = visit(
    'overlapping',
    '2026-07-14T11:00:00Z',
    '2026-07-14T15:00:00Z'
  );
  const afternoon = visit(
    'afternoon',
    '2026-07-14T13:00:00Z',
    '2026-07-14T17:00:00Z'
  );

  it('removes a resource only when its timed assignment overlaps', () => {
    const morningAssignment = assignment(morning);

    expect(doesAssignmentOverlapVisit(morningAssignment, overlapping)).toBe(true);
    expect(doesAssignmentOverlapVisit(morningAssignment, afternoon)).toBe(false);
    expect(
      isResourceUnavailableForVisit(
        { type: 'employee', id: 'employee-1' },
        [morningAssignment],
        overlapping
      )
    ).toBe(true);
    expect(
      isResourceUnavailableForVisit(
        { type: 'employee', id: 'employee-1' },
        [morningAssignment],
        afternoon
      )
    ).toBe(false);
  });

  it('treats legacy day-level assignments as unavailable for the whole day', () => {
    expect(doesAssignmentOverlapVisit(assignment(null), afternoon)).toBe(true);
  });
});
