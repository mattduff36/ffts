import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildEmployeeAssignmentConflicts,
  buildPlantAssignmentConflicts,
} from '@/lib/server/scheduling-board';
import type { ScheduleJob, SchedulePlantResource, ScheduleVisit } from '@/types/scheduling';

const job = {
  id: 'job-1',
  job_reference: '99000-SD',
} as ScheduleJob;

function visit(
  id: string,
  startsAt: string,
  endsAt: string
): ScheduleVisit {
  return {
    id,
    job_id: id === 'visit-1' ? 'job-1' : 'job-2',
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

const workingShift = new Map([
  ['employee-1', {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
  }],
]);

describe('timed scheduling conflicts', () => {
  it('allows two employee visits on the same day when their times do not overlap', () => {
    const rows = [
      { id: 'a1', job_id: 'job-1', profile_id: 'employee-1', work_date: '2026-07-20', visit_id: 'visit-1' },
      { id: 'a2', job_id: 'job-2', profile_id: 'employee-1', work_date: '2026-07-20', visit_id: 'visit-2' },
    ];
    const visits = new Map([
      ['visit-1', visit('visit-1', '2026-07-20T08:00:00Z', '2026-07-20T10:00:00Z')],
      ['visit-2', visit('visit-2', '2026-07-20T10:00:00Z', '2026-07-20T12:00:00Z')],
    ]);

    expect(
      buildEmployeeAssignmentConflicts(
        rows[0],
        rows,
        new Map([['job-1', job], ['job-2', { ...job, id: 'job-2', job_reference: '99001-SD' }]]),
        [],
        workingShift,
        visits
      ).filter((conflict) => conflict.code === 'employee_double_booked')
    ).toHaveLength(0);
  });

  it('detects overlapping timed visits and treats a legacy assignment as full-day', () => {
    const timedRows = [
      { id: 'a1', job_id: 'job-1', profile_id: 'employee-1', work_date: '2026-07-20', visit_id: 'visit-1' },
      { id: 'a2', job_id: 'job-2', profile_id: 'employee-1', work_date: '2026-07-20', visit_id: 'visit-2' },
    ];
    const visits = new Map([
      ['visit-1', visit('visit-1', '2026-07-20T08:00:00Z', '2026-07-20T11:00:00Z')],
      ['visit-2', visit('visit-2', '2026-07-20T10:00:00Z', '2026-07-20T12:00:00Z')],
    ]);
    const jobs = new Map([['job-1', job], ['job-2', { ...job, id: 'job-2', job_reference: '99001-SD' }]]);

    expect(
      buildEmployeeAssignmentConflicts(timedRows[0], timedRows, jobs, [], workingShift, visits)
        .some((conflict) => conflict.code === 'employee_double_booked')
    ).toBe(true);

    const withLegacy = [
      timedRows[0],
      { ...timedRows[1], id: 'legacy', visit_id: null },
    ];
    expect(
      buildEmployeeAssignmentConflicts(withLegacy[0], withLegacy, jobs, [], workingShift, visits)
        .some((conflict) => conflict.code === 'employee_double_booked')
    ).toBe(true);
  });

  it('uses the same overlap rules for plant assignments', () => {
    const rows = [
      { id: 'p1', job_id: 'job-1', plant_id: 'plant-1', work_date: '2026-07-20', visit_id: 'visit-1' },
      { id: 'p2', job_id: 'job-2', plant_id: 'plant-1', work_date: '2026-07-20', visit_id: 'visit-2' },
    ];
    const visits = new Map([
      ['visit-1', visit('visit-1', '2026-07-20T08:00:00Z', '2026-07-20T10:00:00Z')],
      ['visit-2', visit('visit-2', '2026-07-20T09:00:00Z', '2026-07-20T11:00:00Z')],
    ]);
    const jobs = new Map([['job-1', job], ['job-2', { ...job, id: 'job-2', job_reference: '99001-SD' }]]);
    const plants = new Map([
      ['plant-1', {
        id: 'plant-1',
        plant_id: 'PL-1',
        nickname: 'Chipper',
        make: null,
        model: null,
        status: 'active',
      } satisfies SchedulePlantResource],
    ]);

    expect(
      buildPlantAssignmentConflicts(rows[0], rows, jobs, plants, [], visits)
        .some((conflict) => conflict.code === 'plant_double_booked')
    ).toBe(true);
  });
});
