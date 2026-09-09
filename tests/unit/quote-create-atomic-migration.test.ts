import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const first = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260910120000_required_staff_and_quote_create.sql'),
  'utf8'
);
const second = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260910123000_quote_create_atomic_and_staff_tx.sql'),
  'utf8'
);

describe('quote create atomic and required-staff transaction migration', () => {
  it('reserves a quote id under an advisory lock before insert', () => {
    expect(second).toContain('FUNCTION public.quote_create_request_claim_v1');
    expect(second).toContain('FUNCTION public.quote_create_request_complete_v1');
    expect(second).toContain('ALTER COLUMN quote_id DROP NOT NULL');
    expect(second).toContain('reserved_quote_id');
    expect(second).toContain('pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0))');
    expect(second).toContain('REQUEST_ID_ACTOR_MISMATCH');
    expect(second).toContain('REQUEST_ID_REUSED');
    expect(second).toContain('RETURNING quote_create_requests.reserved_quote_id');
    expect(second).toContain('v_existing.quote_id IS NOT NULL');
  });

  it('updates job and quote required staff in one function', () => {
    expect(second).toContain('FUNCTION public.set_schedule_job_required_staff_v1');
    expect(second).toContain('UPDATE public.schedule_jobs');
    expect(second).toContain('UPDATE public.quotes');
    expect(second).toContain('FUNCTION public.quick_add_schedule_project_with_staff_v1');
    expect(second).toContain('schedule_quick_add_requests');
    expect(second).toContain('input_hash');
    expect(second).toContain('REQUEST_ID_ACTOR_MISMATCH');
    expect(second).toContain('REQUEST_ID_REUSED');
    expect(second).toContain('FUNCTION public.create_project_schedule_job_with_staff_v1');
    expect(second).toContain('FUNCTION public.schedule_project_with_initial_visit_with_staff_v1');
    expect(second).toContain('PERFORM public.set_schedule_job_required_staff_v1');
  });

  it('keeps the quote-to-job staff sync from the first migration', () => {
    expect(first).toContain('required_staff_count');
    expect(first).toContain('sync_operational_quote_schedule_job');
    expect(first).toContain('quote_create_requests');
  });
});
