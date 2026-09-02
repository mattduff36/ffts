import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  patchBoardMoveAssignment,
  patchBoardRemoveJob,
  patchBoardWithAssignment,
  patchBoardWithJob,
  patchBoardWithVisit,
} from '@/app/(dashboard)/scheduling/components/scheduling-board-cache';
import { loadSchedulingBoard } from '@/lib/server/scheduling-board';
import {
  insertJobInBoardOrder,
  sortJobsByBoardSequence,
} from '@/lib/utils/scheduling-board-order';
import { buildScheduleBoardRows } from '@/lib/utils/scheduling-board-primary';
import { SCHEDULING_BOARD_PRIMARIES } from '@/lib/config/scheduling-primary-preference';
import type {
  ScheduleAssignment,
  ScheduleJob,
  ScheduleVisit,
  SchedulingBoardPayload,
} from '@/types/scheduling';

interface QueryResult {
  data: unknown[];
  error: null;
}

interface RecordedOrder {
  table: string;
  column: string;
}

class FakeQuery implements PromiseLike<QueryResult> {
  constructor(
    private readonly table: string,
    private readonly result: QueryResult,
    private readonly orders: RecordedOrder[]
  ) {}

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
  order(column: string) {
    this.orders.push({ table: this.table, column });
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function fakeAdmin(
  rows: Record<string, unknown[]>,
  orders: RecordedOrder[]
): SupabaseClient {
  return {
    from: (table: string) =>
      new FakeQuery(table, { data: rows[table] || [], error: null }, orders),
  } as unknown as SupabaseClient;
}

function job(id: string, overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id,
    job_reference: id.toUpperCase(),
    title: `${id} title`,
    description: null,
    site_address: 'Site',
    status: 'scheduled',
    source_type: 'manual',
    start_date: '2026-09-01',
    end_date: '2026-09-07',
    estimated_duration_minutes: 120,
    quote_id: null,
    quote_project_number_id: null,
    customer_id: null,
    customer_site_id: null,
    is_drop_on_ready: false,
    tags: [],
    created_by: null,
    updated_by: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function visit(id: string, jobId: string, startsAt: string): ScheduleVisit {
  return {
    id,
    job_id: jobId,
    sequence_number: 1,
    title: null,
    starts_at: startsAt,
    ends_at: startsAt.replace('08:00', '12:00'),
    status: 'planned',
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: startsAt,
    updated_at: startsAt,
  };
}

function assignment(id: string, jobId: string, visitId: string): ScheduleAssignment {
  return {
    id,
    job_id: jobId,
    work_date: '2026-09-02',
    visit_id: visitId,
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-09-02T08:00:00.000Z',
    updated_at: '2026-09-02T08:00:00.000Z',
    conflicts: [],
    resource_type: 'employee',
    profile_id: 'employee-1',
    employee: {
      id: 'employee-1',
      full_name: 'Alex',
      employee_id: null,
      team_id: null,
      team_name: null,
    },
  };
}

function boardFixture(jobs: ScheduleJob[]): SchedulingBoardPayload {
  return {
    week: { start: '2026-08-31', end: '2026-09-06' },
    jobs,
    tags: [],
    visits: [],
    assignments: [],
    resources: { employees: [], plant: [] },
    employee_capacity: [],
    plant_unavailability: [],
    day_teams: [],
  };
}

const jobC = job('job-c', {
  job_reference: '30000-CC',
  title: 'Job C',
  start_date: '2026-09-04',
  created_at: '2026-08-04T00:00:00.000Z',
  board_sequence: 1,
});
const jobA = job('job-a', {
  job_reference: '10000-AA',
  title: 'Job A',
  start_date: '2026-09-01',
  created_at: '2026-08-03T00:00:00.000Z',
  board_sequence: 2,
});
const jobF = job('job-f', {
  job_reference: '40000-FF',
  title: 'Job F',
  start_date: '2026-09-03',
  created_at: '2026-08-01T00:00:00.000Z',
  board_sequence: 3,
});
const jobB = job('job-b', {
  job_reference: '20000-BB',
  title: 'Job B',
  start_date: '2026-09-02',
  created_at: '2026-08-02T00:00:00.000Z',
  board_sequence: 4,
});

function rowOrder(jobs: ScheduleJob[]): string[] {
  return buildScheduleBoardRows({
    primary: SCHEDULING_BOARD_PRIMARIES.job,
    jobs,
    visits: [
      visit('visit-c', jobC.id, '2026-09-04T08:00:00.000Z'),
      visit('visit-a', jobA.id, '2026-09-01T08:00:00.000Z'),
      visit('visit-f', jobF.id, '2026-09-03T08:00:00.000Z'),
      visit('visit-b', jobB.id, '2026-09-02T08:00:00.000Z'),
    ],
    assignments: [],
    employees: [],
    plant: [],
    dates: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'],
  })
    .filter((row) => row.kind === 'job')
    .map((row) => row.job?.title || '');
}

describe('Schedule Board job order', () => {
  it('JOB-ORDER-001: C → A → F → B stays C,A,F,B', () => {
    const added = [jobC, jobA, jobF, jobB].reduce(
      (board, item) => patchBoardWithJob(board, item),
      boardFixture([])
    );
    expect(added.jobs.map((item) => item.title)).toEqual([
      'Job C',
      'Job A',
      'Job F',
      'Job B',
    ]);
    expect(rowOrder(added.jobs)).toEqual(['Job C', 'Job A', 'Job F', 'Job B']);
  });

  it('JOB-ORDER-002: authoritative reload keeps C,A,F,B', async () => {
    const orders: RecordedOrder[] = [];
    const board = await loadSchedulingBoard(
      fakeAdmin(
        {
          schedule_jobs: [jobB, jobA, jobC, jobF],
          schedule_job_tags: [],
          schedule_visits: [
            visit('visit-c', jobC.id, '2026-09-04T08:00:00.000Z'),
            visit('visit-a', jobA.id, '2026-09-01T08:00:00.000Z'),
            visit('visit-f', jobF.id, '2026-09-03T08:00:00.000Z'),
            visit('visit-b', jobB.id, '2026-09-02T08:00:00.000Z'),
          ],
          schedule_visit_backlog: [],
          schedule_employee_assignments: [],
          schedule_plant_assignments: [],
          profiles: [],
          plant: [],
          schedule_plant_unavailability: [],
          absences: [],
          employee_work_shifts: [],
          schedule_day_team_members: [],
        },
        orders
      ),
      '2026-08-31',
      '2026-09-06'
    );

    expect(board.jobs.map((item) => item.title)).toEqual([
      'Job C',
      'Job A',
      'Job F',
      'Job B',
    ]);
    expect(rowOrder(board.jobs)).toEqual(['Job C', 'Job A', 'Job F', 'Job B']);
  });

  it('JOB-ORDER-003: updating Job A keeps its row', () => {
    const board = [jobC, jobA, jobF, jobB].reduce(
      (current, item) => patchBoardWithJob(current, item),
      boardFixture([])
    );
    const updated = patchBoardWithJob(board, { ...jobA, title: 'Job A updated' });
    expect(updated.jobs.map((item) => item.id)).toEqual([
      'job-c',
      'job-a',
      'job-f',
      'job-b',
    ]);
    expect(updated.jobs[1].title).toBe('Job A updated');
  });

  it('JOB-ORDER-004: resizing a visit does not reorder jobs', () => {
    const board = patchBoardWithVisit(
      boardFixture([jobC, jobA, jobF, jobB]),
      visit('visit-a', jobA.id, '2026-09-01T10:00:00.000Z')
    );
    expect(board.jobs.map((item) => item.id)).toEqual([
      'job-c',
      'job-a',
      'job-f',
      'job-b',
    ]);
  });

  it('JOB-ORDER-005: assignment create/move does not reorder jobs', () => {
    const withAssignment = patchBoardWithAssignment(
      boardFixture([jobC, jobA, jobF, jobB]),
      assignment('asg-1', jobA.id, 'visit-a')
    );
    const moved = patchBoardMoveAssignment(withAssignment, 'asg-1', (item) => ({
      ...item,
      work_date: '2026-09-03',
    }));
    expect(moved.jobs.map((item) => item.id)).toEqual([
      'job-c',
      'job-a',
      'job-f',
      'job-b',
    ]);
  });

  it('JOB-ORDER-006: return then place preserves original sequence', () => {
    const onBoard = boardFixture([jobC, jobA, jobF, jobB]);
    const returned = patchBoardRemoveJob(onBoard, jobA.id);
    expect(returned.jobs.map((item) => item.id)).toEqual(['job-c', 'job-f', 'job-b']);
    const placed = patchBoardWithJob(returned, jobA);
    expect(placed.jobs.map((item) => item.id)).toEqual([
      'job-c',
      'job-a',
      'job-f',
      'job-b',
    ]);
  });

  it('JOB-ORDER-007: created_at/start-date/reference order cannot win', () => {
    const scrambled = sortJobsByBoardSequence([jobB, jobA, jobC, jobF]);
    expect(scrambled.map((item) => item.title)).toEqual([
      'Job C',
      'Job A',
      'Job F',
      'Job B',
    ]);
    const byReference = [...scrambled].sort((left, right) =>
      left.job_reference.localeCompare(right.job_reference)
    );
    const byStart = [...scrambled].sort((left, right) =>
      left.start_date.localeCompare(right.start_date)
    );
    const byCreated = [...scrambled].sort((left, right) =>
      left.created_at.localeCompare(right.created_at)
    );
    expect(byReference.map((item) => item.title)).not.toEqual([
      'Job C',
      'Job A',
      'Job F',
      'Job B',
    ]);
    expect(byStart.map((item) => item.title)).not.toEqual([
      'Job C',
      'Job A',
      'Job F',
      'Job B',
    ]);
    expect(byCreated.map((item) => item.title)).not.toEqual([
      'Job C',
      'Job A',
      'Job F',
      'Job B',
    ]);
  });

  it('JOB-ORDER-009: historical backfill order is created_at then id', () => {
    const laterId = job('job-2', {
      created_at: '2026-01-01T00:00:00.000Z',
      board_sequence: 1,
    });
    const earlierId = job('job-1', {
      created_at: '2026-01-01T00:00:00.000Z',
      board_sequence: 2,
    });
    expect(sortJobsByBoardSequence([earlierId, laterId]).map((item) => item.id)).toEqual([
      'job-2',
      'job-1',
    ]);
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260902130000_schedule_jobs_board_sequence.sql'),
      'utf8'
    );
    expect(migration).toContain('ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)');
  });

  it('JOB-ORDER-008: equal timestamps stay deterministic by id', () => {
    const first = job('job-z', {
      created_at: '2026-09-01T12:00:00.000Z',
      board_sequence: 10,
    });
    const second = job('job-y', {
      created_at: '2026-09-01T12:00:00.000Z',
      board_sequence: 10,
    });
    expect(sortJobsByBoardSequence([first, second]).map((item) => item.id)).toEqual([
      'job-y',
      'job-z',
    ]);
    expect(sortJobsByBoardSequence([second, first]).map((item) => item.id)).toEqual([
      'job-y',
      'job-z',
    ]);
  });

  it('JOB-ORDER-010: board load orders by board_sequence then id', async () => {
    const orders: RecordedOrder[] = [];
    await loadSchedulingBoard(
      fakeAdmin({ schedule_jobs: [jobC] }, orders),
      '2026-08-31',
      '2026-09-06'
    );
    const jobOrders = orders
      .filter((entry) => entry.table === 'schedule_jobs')
      .map((entry) => entry.column);
    expect(jobOrders).toEqual(['board_sequence', 'id']);
  });

  it('appends unsaved jobs and inserts persisted jobs by sequence', () => {
    const optimistic = job('optimistic-new', { board_sequence: null, title: 'New' });
    const board = patchBoardWithJob(boardFixture([jobC, jobA]), optimistic);
    expect(board.jobs.map((item) => item.id)).toEqual([
      'job-c',
      'job-a',
      'optimistic-new',
    ]);
    expect(
      insertJobInBoardOrder(board.jobs, jobF).map((item) => item.id)
    ).toEqual(['job-c', 'job-a', 'job-f', 'optimistic-new']);
  });
});
