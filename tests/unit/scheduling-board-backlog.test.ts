import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  loadSchedulingBoard,
  loadSchedulingSelf,
} from '@/lib/server/scheduling-board';

interface QueryResult {
  data: unknown[];
  error: null;
}

class FakeQuery implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}

  select() { return this; }
  eq() { return this; }
  gte() { return this; }
  in() { return this; }
  is() { return this; }
  lt() { return this; }
  lte() { return this; }
  neq() { return this; }
  not() { return this; }
  or() { return this; }
  order() { return this; }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function fakeAdmin(rows: Record<string, unknown[]>): SupabaseClient {
  return {
    from: (table: string) =>
      new FakeQuery({ data: rows[table] || [], error: null }),
  } as unknown as SupabaseClient;
}

const job = {
  id: 'job-1',
  job_reference: '99108-SD',
  title: 'Sample job',
  description: null,
  site_address: null,
  status: 'scheduled',
  source_type: 'sample',
  start_date: '2026-08-10',
  end_date: '2026-08-16',
  estimated_duration_minutes: 480,
  quote_id: null,
  quote_project_number_id: null,
  customer_id: null,
  customer: null,
  is_drop_on_ready: false,
  tag_links: [],
  created_by: null,
  updated_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

const visibleVisit = {
  id: 'visit-visible',
  job_id: 'job-1',
  sequence_number: 1,
  title: 'Visible visit',
  starts_at: '2026-08-11T07:00:00.000Z',
  ends_at: '2026-08-11T11:00:00.000Z',
  status: 'planned',
  notes: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

const queuedVisit = {
  ...visibleVisit,
  id: 'visit-queued',
  sequence_number: 2,
  title: 'Queued visit',
  starts_at: '2026-08-12T07:00:00.000Z',
  ends_at: '2026-08-12T11:00:00.000Z',
};

const employee = {
  id: 'employee-1',
  full_name: 'Test Employee',
  employee_id: 'E001',
  team_id: null,
  team_name: null,
};

function employeeAssignment(id: string, visitId: string, workDate: string) {
  return {
    id,
    job_id: 'job-1',
    work_date: workDate,
    visit_id: visitId,
    profile_id: 'employee-1',
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    employee,
  };
}

describe('scheduling board queued visit reads', () => {
  it('omits queued visits and their assignments from the manager board', async () => {
    const admin = fakeAdmin({
      schedule_jobs: [job],
      schedule_job_tags: [],
      schedule_visits: [visibleVisit, queuedVisit],
      schedule_visit_backlog: [{ visit_id: queuedVisit.id }],
      schedule_employee_assignments: [
        employeeAssignment('assignment-visible', visibleVisit.id, '2026-08-11'),
        employeeAssignment('assignment-queued', queuedVisit.id, '2026-08-12'),
      ],
      schedule_plant_assignments: [],
      profiles: [employee],
      plant: [],
      plant_unavailability: [],
      employee_absences: [],
      employee_shifts: [],
    });

    const board = await loadSchedulingBoard(
      admin,
      '2026-08-10',
      '2026-08-16'
    );

    expect(board.visits.map((visit) => visit.id)).toEqual(['visit-visible']);
    expect(board.assignments.map((assignment) => assignment.id)).toEqual([
      'assignment-visible',
    ]);
  });

  it('omits queued visits and inconsistent queued assignments from employee self reads', async () => {
    const admin = fakeAdmin({
      schedule_employee_assignments: [
        employeeAssignment('assignment-visible', visibleVisit.id, '2026-08-11'),
        employeeAssignment('assignment-queued', queuedVisit.id, '2026-08-12'),
      ],
      schedule_jobs: [job],
      schedule_visits: [visibleVisit, queuedVisit],
      schedule_visit_backlog: [{ visit_id: queuedVisit.id }],
      schedule_plant_assignments: [],
    });

    const schedule = await loadSchedulingSelf(
      admin,
      'employee-1',
      '2026-08-10',
      '2026-08-16'
    );

    expect(schedule.visits.map((visit) => visit.id)).toEqual(['visit-visible']);
    expect(schedule.assignments.map((assignment) => assignment.id)).toEqual([
      'assignment-visible',
    ]);
  });
});
