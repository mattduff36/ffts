import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260914233000_schedule_assignment_same_visit_idempotent.sql'
  ),
  'utf8'
);

describe('schedule assignment same-visit idempotent migration', () => {
  it('migration text excludes the target visit and returns an exact existing row', () => {
    expect(migration).toContain('FUNCTION public.create_schedule_assignment_v1');
    expect(migration).toContain('PERFORM pg_advisory_xact_lock(v_lock_key)');
    expect(migration).toContain('assignment.visit_id = p_visit_id');
    expect(migration).toContain('assignment.profile_id = p_resource_id');
    expect(migration).toContain('assignment.plant_id = p_resource_id');
    expect(migration).toContain('assignment.visit_id IS DISTINCT FROM p_visit_id');
    expect(migration).toContain('assignment.visit_id IS NULL');
    expect(migration).toContain('RESOURCE_OVERLAP');
    expect(migration.match(/assignment\.visit_id IS DISTINCT FROM p_visit_id/g)?.length).toBe(2);
  });
});
