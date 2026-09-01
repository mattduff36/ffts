import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260901210000_schedule_assignment_mutation_requests.sql'
  ),
  'utf8'
);

describe('schedule assignment mutation request migration (DB-CONTRACT-001)', () => {
  it('adds a request table without cascading from assignment rows', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.schedule_assignment_mutation_requests'
    );
    expect(migration).toContain('request_id UUID PRIMARY KEY');
    expect(migration).toContain('input_hash TEXT NOT NULL');
    expect(migration).toContain('result JSONB NOT NULL');
    expect(migration).not.toMatch(
      /assignment_id UUID[^\n]*REFERENCES public\.schedule_/
    );
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT ALL ON TABLE public.schedule_assignment_mutation_requests TO service_role');
  });

  it('wraps proven v1 create/move/bulk and adds delete v2', () => {
    expect(migration).toContain('FUNCTION public.create_schedule_assignment_v2');
    expect(migration).toContain('FUNCTION public.create_schedule_assignments_bulk_v2');
    expect(migration).toContain('FUNCTION public.move_schedule_assignment_v2');
    expect(migration).toContain('FUNCTION public.delete_schedule_assignment_v2');
    expect(migration).toContain('public.create_schedule_assignment_v1(');
    expect(migration).toContain('public.create_schedule_assignments_bulk_v1(');
    expect(migration).toContain('public.move_schedule_assignment_v1(');
    expect(migration).toContain(
      'pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0))'
    );
    expect(migration).toContain('REQUEST_ID_REUSED');
    expect(migration).not.toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\(\s*p_resource_type/
    );
    expect(migration).not.toContain("COALESCE(array_to_string(p_conflict_codes, ','), '')");
    expect(migration).not.toContain("COALESCE(p_conflict_codes_by_date::TEXT, '{}')");
  });

  it('does not store overlap failures as replayable success', () => {
    expect(migration).toContain('FROM public.create_schedule_assignment_v1(');
    expect(migration).not.toContain('RESOURCE_OVERLAP');
  });
});
