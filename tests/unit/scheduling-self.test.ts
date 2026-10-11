import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadSchedulingSelf } from '@/lib/server/scheduling-board';

interface QueryResult {
  data: unknown[];
  error: null;
}

interface QueryCall {
  table: string;
  method: string;
  column?: string;
  value?: unknown;
}

class RecordingQuery implements PromiseLike<QueryResult> {
  constructor(
    private readonly table: string,
    private readonly result: QueryResult,
    private readonly calls: QueryCall[]
  ) {}

  select() { return this; }
  gte() { return this; }
  lte() { return this; }
  lt() { return this; }
  order() { return this; }

  eq(column: string, value: unknown) {
    this.calls.push({ table: this.table, method: 'eq', column, value });
    return this;
  }

  in(column: string, value: unknown) {
    this.calls.push({ table: this.table, method: 'in', column, value });
    return this;
  }

  or(value: string) {
    this.calls.push({ table: this.table, method: 'or', value });
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function recordingAdmin(rows: Record<string, unknown[]>, calls: QueryCall[]): SupabaseClient {
  return {
    from: (table: string) => new RecordingQuery(table, { data: rows[table] || [], error: null }, calls),
  } as unknown as SupabaseClient;
}

function job(id: string, status: string) {
  return {
    id,
    job_reference: id.toUpperCase(),
    title: id,
    description: null,
    site_address: null,
    status,
    source_type: 'manual',
    start_date: '2026-08-10',
    end_date: '2026-08-16',
    estimated_duration_minutes: 180,
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
}

function visit(id: string, jobId: string, status: string, startsAt: string) {
  return {
    id,
    job_id: jobId,
    sequence_number: 1,
    title: id,
    starts_at: startsAt,
    ends_at: startsAt,
    status,
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function employeeRow(id: string, profileId: string, jobId: string, workDate: string, visitId: string | null) {
  return {
    id,
    job_id: jobId,
    work_date: workDate,
    visit_id: visitId,
    profile_id: profileId,
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function plantRow(id: string, jobId: string, workDate: string, visitId: string | null, nickname: string) {
  return {
    id,
    job_id: jobId,
    work_date: workDate,
    visit_id: visitId,
    plant_id: id,
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    plant: { id, plant_id: id, nickname, make: null, model: null, status: 'active' },
  };
}

describe('loadSchedulingSelf assignment isolation', () => {
  it('returns only the authenticated employee exact job, date, and visit', async () => {
    const calls: QueryCall[] = [];
    const admin = recordingAdmin({
      schedule_employee_assignments: [
        employeeRow('mine', 'employee-1', 'job-ok', '2026-08-11', 'visit-mine'),
        employeeRow('untimed', 'employee-1', 'job-ok', '2026-08-15', null),
        employeeRow('completed', 'employee-1', 'job-done', '2026-08-13', 'visit-done'),
        employeeRow('cancelled-visit', 'employee-1', 'job-ok', '2026-08-11', 'visit-cancelled'),
        employeeRow('queued', 'employee-1', 'job-ok', '2026-08-12', 'visit-queued'),
        employeeRow('missing', 'employee-1', 'job-ok', '2026-08-11', 'visit-missing'),
        employeeRow('cancelled-job', 'employee-1', 'job-cancelled', '2026-08-14', 'visit-cancelled-job'),
        employeeRow('other-person', 'employee-2', 'job-secret', '2026-08-11', 'visit-secret'),
      ],
      schedule_jobs: [
        job('job-ok', 'scheduled'),
        job('job-done', 'completed'),
        job('job-cancelled', 'cancelled'),
        job('job-secret', 'scheduled'),
      ],
      schedule_visits: [
        visit('visit-mine', 'job-ok', 'planned', '2026-08-11T08:00:00.000Z'),
        visit('visit-other', 'job-ok', 'planned', '2026-08-11T12:00:00.000Z'),
        visit('visit-cancelled', 'job-ok', 'cancelled', '2026-08-11T09:00:00.000Z'),
        visit('visit-queued', 'job-ok', 'planned', '2026-08-12T08:00:00.000Z'),
        visit('visit-done', 'job-done', 'completed', '2026-08-13T08:00:00.000Z'),
        visit('visit-cancelled-job', 'job-cancelled', 'planned', '2026-08-14T08:00:00.000Z'),
        visit('visit-secret', 'job-secret', 'planned', '2026-08-11T08:00:00.000Z'),
      ],
      schedule_visit_backlog: [
        { visit_id: 'visit-queued' },
        { visit_id: 'visit-unrelated-backlog' },
      ],
      schedule_plant_assignments: [
        plantRow('plant-mine', 'job-ok', '2026-08-11', 'visit-mine', 'Loader'),
        plantRow('plant-other-visit', 'job-ok', '2026-08-11', 'visit-other', 'Wrong visit'),
        plantRow('plant-untimed-mismatch', 'job-ok', '2026-08-11', null, 'Wrong slot'),
        plantRow('plant-untimed', 'job-ok', '2026-08-15', null, 'Chipper'),
        plantRow('plant-secret', 'job-secret', '2026-08-11', 'visit-secret', 'Secret plant'),
      ],
    }, calls);

    const schedule = await loadSchedulingSelf(admin, 'employee-1', '2026-08-10', '2026-08-16');

    expect(schedule.assignments.map((assignment) => assignment.id)).toEqual([
      'mine',
      'untimed',
      'completed',
    ]);
    expect(schedule.visits.map((item) => item.id)).toEqual(['visit-mine', 'visit-done']);
    expect(schedule.jobs.map((item) => item.id).sort()).toEqual(['job-done', 'job-ok']);
    expect(schedule.plant_assignments.map((item) => item.plant?.nickname).sort()).toEqual([
      'Chipper',
      'Loader',
    ]);
    expect(calls).toContainEqual({
      table: 'schedule_employee_assignments',
      method: 'eq',
      column: 'profile_id',
      value: 'employee-1',
    });
    const visitQuery = calls.find((call) => call.table === 'schedule_visits' && call.method === 'in');
    expect(visitQuery?.column).toBe('id');
    expect(visitQuery?.value).toEqual(expect.not.arrayContaining(['visit-other', 'visit-secret']));
    expect(visitQuery?.value).toEqual(expect.arrayContaining(['visit-mine', 'visit-done']));
    const plantQuery = calls.find((call) => call.table === 'schedule_plant_assignments' && call.method === 'or');
    expect(String(plantQuery?.value)).toContain('visit_id.eq.visit-mine');
    expect(String(plantQuery?.value)).toContain('visit_id.is.null');
    expect(String(plantQuery?.value)).not.toContain('visit-other');
    const backlogQuery = calls.find((call) => call.table === 'schedule_visit_backlog' && call.method === 'in');
    expect(backlogQuery?.column).toBe('visit_id');
    expect(backlogQuery?.value).toEqual(expect.not.arrayContaining(['visit-secret']));
  });
});
