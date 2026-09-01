import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260901170000_schedule_day_teams.sql'),
  'utf8'
);
const runner = readFileSync(
  resolve(process.cwd(), 'scripts/migrations/run-schedule-day-teams-migration.ts'),
  'utf8'
);

describe('schedule day teams migration (SCH-TEAM-SQL-001)', () => {
  it('creates the membership table with exclusive date/profile uniqueness and slot bounds', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.schedule_day_team_members');
    expect(migration).toContain('UNIQUE (work_date, profile_id)');
    expect(migration).toContain('slot_index BETWEEN 1 AND 3');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain("effective_module_access_level('scheduling') >= 4");
  });

  it('locks add and remove RPCs per date and enforces six-member capacity', () => {
    expect(migration).toContain('FUNCTION public.add_schedule_day_team_member_v1');
    expect(migration).toContain('FUNCTION public.remove_schedule_day_team_member_v1');
    expect(migration).toContain("hashtextextended('schedule-day-team:' || p_work_date::TEXT, 0)");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('TEAM_SLOT_FULL');
    expect(migration).toContain('v_target_count >= 6');
    expect(migration).toContain('is_placeholder');
  });

  it('revokes default authenticated DML and execute, then grants service_role only', () => {
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.schedule_day_team_members FROM PUBLIC, anon, authenticated'
    );
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.schedule_day_team_members TO authenticated'
    );
    expect(migration).toContain(
      'GRANT ALL ON TABLE public.schedule_day_team_members TO service_role'
    );
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.add_schedule_day_team_member_v1');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.add_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID)'
    );
    expect(migration).toContain('TO service_role');
  });

  it('requires the non-pooling connection and does not fall back to POSTGRES_URL', () => {
    expect(runner).toContain('POSTGRES_URL_NON_POOLING');
    expect(runner).not.toContain('process.env.POSTGRES_URL)');
  });
});
