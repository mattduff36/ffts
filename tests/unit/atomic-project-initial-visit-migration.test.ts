import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260724000500_atomic_project_initial_visit.sql'),
  'utf8'
);

describe('atomic Project initial visit migration', () => {
  it('locks the open project and calls project creation before inserting the visit', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('public.create_project_schedule_job');
    expect(migration).toContain('INSERT INTO public.schedule_visits');
    expect(migration).toContain('Invalid initial visit window.');
  });

  it('restricts execution to service_role with a safe search path', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});
