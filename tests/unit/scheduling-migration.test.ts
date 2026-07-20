import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260720_quote_scheduling_visits.sql'),
  'utf8'
);

describe('quote scheduling visits migration', () => {
  it('preserves legacy assignments while adding visit-scoped uniqueness', () => {
    expect(migration).toContain('WHERE visit_id IS NULL');
    expect(migration).toContain('WHERE visit_id IS NOT NULL');
    expect(migration).toContain('validate_schedule_assignment_visit');
  });

  it('upserts active latest Quotes idempotently and soft-cancels inactive Quotes', () => {
    expect(migration).toContain("NEW.status IN ('po_received', 'in_progress')");
    expect(migration).toContain("NEW.commercial_status = 'open'");
    expect(migration).toContain('NEW.is_latest_version = TRUE');
    expect(migration).toContain('ON CONFLICT (job_reference) DO UPDATE');
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain("WHERE public.schedule_jobs.source_type = 'quote'");
  });

  it('uses the base Quote reference as the scheduling job number', () => {
    expect(migration).toContain("NULLIF(BTRIM(NEW.base_quote_reference), '')");
    expect(migration).toContain('resolved_reference');
  });
});
