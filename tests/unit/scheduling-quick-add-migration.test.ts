import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260810214500_schedule_board_quick_add_v1.sql'
  ),
  'utf8'
);
const docs = readFileSync(
  resolve(process.cwd(), 'docs/guides/SCHEDULING_IMPLEMENTATION.md'),
  'utf8'
);

describe('schedule board quick-add migration', () => {
  it('creates an idempotent quick-add RPC that returns the visit identity', () => {
    expect(migration).toContain('schedule_quick_add_requests');
    expect(migration).toContain('FUNCTION public.quick_add_schedule_project_v1');
    expect(migration).toContain('schedule_visit_id UUID');
    expect(migration).toContain('p_request_id');
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0))');
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain('create_project_schedule_job');
    expect(migration).toContain('TO service_role');
  });

  it('serializes overlapping assignment create and move operations', () => {
    expect(migration).toContain('FUNCTION public.create_schedule_assignment_v1');
    expect(migration).toContain('FUNCTION public.create_schedule_assignments_bulk_v1');
    expect(migration).toContain('FUNCTION public.move_schedule_assignment_v1');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('RESOURCE_OVERLAP');
    expect(migration).toContain('schedule_employee_assignments%ROWTYPE');
    expect(migration).toContain('schedule_plant_assignments%ROWTYPE');
    expect(migration).not.toContain('v_row RECORD');
    expect(migration).not.toMatch(/v_row\.profile_id/);
    expect(migration).not.toMatch(/v_row\.plant_id/);
  });

  it('SCH-TEAM-DOCS-001 documents current day-team buckets and keeps templates deferred', () => {
    expect(docs).toContain('Future Enhancements (Deferred)');
    expect(docs).toContain('Expanding team-bucket editor and leaders on extra teams 6–10');
    expect(docs).toContain('Saved team templates');
    expect(docs).toContain('Weekly-view team buckets');
    expect(docs).not.toContain('Team-based booking: compose a day team once');
  });
});
