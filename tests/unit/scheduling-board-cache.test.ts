import { describe, expect, it } from 'vitest';
import {
  patchBoardMoveAssignment,
  patchBoardRemoveAssignment,
  patchBoardWithAssignment,
  patchBoardWithJob,
  patchBoardWithQuickAdd,
  replaceEmployeeCapacity,
  snapshotBoard,
} from '@/app/(dashboard)/scheduling/components/scheduling-board-cache';
import type {
  ScheduleAssignment,
  ScheduleJob,
  ScheduleVisit,
  SchedulingBoardPayload,
} from '@/types/scheduling';

function boardFixture(): SchedulingBoardPayload {
  return {
    week: { start: '2026-07-13', end: '2026-07-19' },
    jobs: [],
    tags: [],
    visits: [],
    assignments: [],
    resources: { employees: [], plant: [] },
    employee_capacity: [{
      date: '2026-07-14',
      available_employee_count: 2,
      total_available_minutes: 900,
      employees: [
        { profile_id: 'e1', full_name: 'Alex', available_minutes: 450 },
        { profile_id: 'e2', full_name: 'Bob', available_minutes: 450 },
      ],
    }],
    plant_unavailability: [],
    day_teams: [],
  };
}

const visit: ScheduleVisit = {
  id: 'visit-1',
  job_id: 'job-1',
  sequence_number: 1,
  title: 'Morning',
  starts_at: '2026-07-14T08:00:00.000Z',
  ends_at: '2026-07-14T12:00:00.000Z',
  status: 'planned',
  notes: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-07-14T07:00:00.000Z',
  updated_at: '2026-07-14T07:00:00.000Z',
};

const assignment: ScheduleAssignment = {
  id: 'optimistic-1',
  job_id: 'job-1',
  work_date: '2026-07-14',
  visit_id: 'visit-1',
  notes: null,
  conflict_override: false,
  conflict_codes: [],
  conflict_override_by: null,
  conflict_override_at: null,
  assigned_by: null,
  created_at: '2026-07-14T08:00:00.000Z',
  updated_at: '2026-07-14T08:00:00.000Z',
  conflicts: [],
  visit,
  resource_type: 'employee',
  profile_id: 'e2',
  employee: {
    id: 'e2',
    full_name: 'Bob',
    employee_id: null,
    team_id: null,
    team_name: null,
  },
};

describe('scheduling-board-cache', () => {
  it('snapshots and restores board state independently', () => {
    const board = boardFixture();
    const snap = snapshotBoard(board);
    board.assignments.push(assignment);
    expect(snap?.assignments).toHaveLength(0);
  });

  it('replaces optimistic assignments and capacity for the impacted day', () => {
    const board = patchBoardWithAssignment(boardFixture(), assignment);
    const authoritative = { ...assignment, id: 'real-1' };
    const next = patchBoardWithAssignment(board, authoritative, {
      replaceOptimisticId: 'optimistic-1',
      capacityDays: [{
        date: '2026-07-14',
        available_employee_count: 1,
        total_available_minutes: 450,
        employees: [{ profile_id: 'e1', full_name: 'Alex', available_minutes: 450 }],
      }],
    });

    expect(next.assignments).toHaveLength(1);
    expect(next.assignments[0].id).toBe('real-1');
    expect(next.employee_capacity[0].available_employee_count).toBe(1);
  });

  it('moves and removes assignments while preserving other board data', () => {
    const withAssignment = patchBoardWithAssignment(boardFixture(), assignment);
    const moved = patchBoardMoveAssignment(withAssignment, assignment.id, (item) => ({
      ...item,
      visit_id: 'visit-2',
    }));
    expect(moved.assignments[0].visit_id).toBe('visit-2');

    const removed = patchBoardRemoveAssignment(moved, assignment.id);
    expect(removed.assignments).toHaveLength(0);
  });

  it('patches quick-add job and visit into the board cache', () => {
    const job = {
      id: 'job-9',
      job_reference: '60099-MD',
      title: 'Emergency',
      description: null,
      site_address: null,
      status: 'scheduled',
      source_type: 'manual',
      start_date: '2026-07-14',
      end_date: '2026-07-14',
      estimated_duration_minutes: 180,
      quote_id: null,
      quote_project_number_id: 'project-9',
      customer_id: 'customer-1',
      customer_site_id: null,
      is_drop_on_ready: false,
      tags: [],
      created_by: null,
      updated_by: null,
      created_at: '2026-07-14T07:00:00.000Z',
      updated_at: '2026-07-14T07:00:00.000Z',
    } as ScheduleJob;
    const next = patchBoardWithQuickAdd({
      board: boardFixture(),
      job,
      visit: { ...visit, id: 'visit-9', job_id: 'job-9' },
    });
    expect(next.jobs.map((item) => item.id)).toContain('job-9');
    expect(next.visits.map((item) => item.id)).toContain('visit-9');
  });

  it('keeps newly added jobs in add order instead of sorting by job reference', () => {
    const zebra = {
      id: 'job-z',
      job_reference: '99000-ZZ',
      title: 'Zebra',
      description: null,
      site_address: null,
      status: 'scheduled',
      source_type: 'manual',
      start_date: '2026-07-14',
      end_date: '2026-07-14',
      estimated_duration_minutes: 120,
      quote_id: null,
      quote_project_number_id: null,
      customer_id: null,
      customer_site_id: null,
      is_drop_on_ready: false,
      tags: [],
      created_by: null,
      updated_by: null,
      created_at: '2026-07-14T07:00:00.000Z',
      updated_at: '2026-07-14T07:00:00.000Z',
    } as ScheduleJob;
    const alpha = {
      ...zebra,
      id: 'job-a',
      job_reference: '10000-AA',
      title: 'Alpha',
      created_at: '2026-07-14T07:01:00.000Z',
    };
    const withZebra = patchBoardWithJob(boardFixture(), zebra);
    const withBoth = patchBoardWithJob(withZebra, alpha);
    expect(withBoth.jobs.map((item) => item.job_reference)).toEqual([
      '99000-ZZ',
      '10000-AA',
    ]);
    const updatedZebra = { ...zebra, title: 'Zebra updated' };
    const replaced = patchBoardWithJob(withBoth, updatedZebra);
    expect(replaced.jobs.map((item) => item.id)).toEqual(['job-z', 'job-a']);
    expect(replaced.jobs[0].title).toBe('Zebra updated');
  });

  it('merges capacity updates by date', () => {
    const next = replaceEmployeeCapacity(boardFixture(), [{
      date: '2026-07-15',
      available_employee_count: 3,
      total_available_minutes: 1200,
      employees: [],
    }]);
    expect(next.employee_capacity).toHaveLength(2);
    expect(next.employee_capacity.find((day) => day.date === '2026-07-15')?.available_employee_count)
      .toBe(3);
  });
});
