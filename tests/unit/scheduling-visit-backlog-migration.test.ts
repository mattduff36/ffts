import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260811001500_schedule_visit_backlog.sql'
  ),
  'utf8'
);

describe('schedule visit backlog migration', () => {
  it('keeps the visit identity and Quick Add receipt valid', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.schedule_visit_backlog');
    expect(migration).toContain(
      'visit_id UUID PRIMARY KEY REFERENCES public.schedule_visits(id) ON DELETE CASCADE'
    );
    expect(migration).toContain('original_starts_at TIMESTAMPTZ NOT NULL');
    expect(migration).not.toMatch(/DELETE FROM public\.schedule_visits/);
  });

  it('serializes idempotent enqueue and schedule transitions', () => {
    expect(migration).toContain('public.schedule_visit_transition_requests');
    expect(migration).toContain('FUNCTION public.enqueue_schedule_visit_v1');
    expect(migration).toContain('FUNCTION public.schedule_queued_visit_v1');
    expect(migration).toContain(
      'pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0))'
    );
    expect(migration).toContain('STALE_VISIT_PREVIEW');
    expect(migration).toContain('REQUEST_ID_REUSED');
    expect(migration).toContain('job.updated_at::TEXT');
    expect(migration).toContain("COALESCE(quote.updated_at::TEXT, '')");
    expect(migration).toContain(
      "v_quote.commercial_status IS DISTINCT FROM 'open'"
    );
  });

  it('removes only visit assignments and blocks new queued assignments', () => {
    expect(migration).toContain('guard_employee_assignment_backlog');
    expect(migration).toContain('guard_plant_assignment_backlog');
    expect(migration).toContain('VALUES (v_old_visit_id), (v_new_visit_id)');
    expect(migration).toContain('VISIT_QUEUED');
    expect(migration).toContain(
      'DELETE FROM public.schedule_employee_assignments AS employee'
    );
    expect(migration).toContain(
      'DELETE FROM public.schedule_plant_assignments AS plant'
    );
    expect(migration).toContain('guard_queued_schedule_visit_mutation');
    expect(migration).toContain(
      'FUNCTION public.sync_operational_quote_schedule_job'
    );
    expect(migration).toContain(
      'WHERE backlog.visit_id = visit.id'
    );
    expect(migration).not.toContain(
      "current_setting('ffts.allow_queued_visit_transition'"
    );
  });

  it('expands quote and non-quote planning ranges without contraction', () => {
    expect(migration).toContain(
      'v_new_start := LEAST(v_quote.start_date, v_target_date)'
    );
    expect(migration).toContain('v_new_end := GREATEST(');
    expect(migration).toContain(
      'v_new_start := LEAST(v_job.start_date, v_target_date)'
    );
    expect(migration).toContain(
      'v_new_end := GREATEST(v_job.end_date, v_target_date)'
    );
    expect(migration).toContain('QUOTE_NOT_SCHEDULABLE');
    expect(migration).toContain("v_job.status IN ('completed', 'cancelled')");
    expect(migration).toContain(
      'v_backlog.original_ends_at - v_backlog.original_starts_at'
    );
    expect(migration).toContain(
      'DELETE FROM public.schedule_visit_backlog AS backlog'
    );
  });

  it('keeps transition data private to the service role', () => {
    expect(migration).toContain(
      'ALTER TABLE public.schedule_visit_backlog ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enqueue_schedule_visit_v1\([\s\S]*?FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.schedule_queued_visit_v1\([\s\S]*?TO service_role/
    );
  });
});
