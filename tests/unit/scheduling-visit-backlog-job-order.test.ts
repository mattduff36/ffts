import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadScheduleVisitBacklog } from '@/lib/server/scheduling-visit-backlog';

interface QueryResult {
  data: unknown[];
  error: null;
}

class FakeQuery implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}

  select() { return this; }
  order() { return this; }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

describe('schedule visit backlog job order', () => {
  it('JOB-ORDER-011: backlog projections propagate board_sequence', async () => {
    const admin = {
      from: () =>
        new FakeQuery({
          data: [{
            visit_id: 'visit-1',
            original_starts_at: '2026-09-02T08:00:00.000Z',
            original_ends_at: '2026-09-02T12:00:00.000Z',
            queued_at: '2026-09-02T13:00:00.000Z',
            visit: {
              id: 'visit-1',
              job_id: 'job-a',
              sequence_number: 1,
              title: 'Returned',
              notes: null,
              starts_at: '2026-09-02T08:00:00.000Z',
              ends_at: '2026-09-02T12:00:00.000Z',
              status: 'planned',
              created_by: null,
              updated_by: null,
              created_at: '2026-09-01T00:00:00.000Z',
              updated_at: '2026-09-02T13:00:00.000Z',
              job: {
                id: 'job-a',
                job_reference: '10000-AA',
                title: 'Job A',
                description: null,
                site_address: null,
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
                created_by: null,
                updated_by: null,
                created_at: '2026-08-02T00:00:00.000Z',
                updated_at: '2026-08-02T00:00:00.000Z',
                board_sequence: 2,
                customer: { company_name: 'Acme' },
              },
            },
          }],
          error: null,
        }),
    } as unknown as SupabaseClient;

    const items = await loadScheduleVisitBacklog(admin);
    expect(items).toHaveLength(1);
    expect(items[0].job.board_sequence).toBe(2);
    expect(items[0].job.id).toBe('job-a');
  });
});
