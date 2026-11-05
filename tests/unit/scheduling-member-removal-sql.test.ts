import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve('supabase', 'migrations', '20261105120000_schedule_team_member_assignment_removal.sql'), 'utf8');

describe('atomic confirmed team removal SQL contract (not a database execution)', () => {
  it('reuses membership authorization/leader protection and rejects stale confirmation sets', () => {
    expect(sql).toContain('public.remove_schedule_day_team_member_v1(');
    expect(sql).toContain("RAISE EXCEPTION 'TEAM_MEMBER_CHANGED'");
    expect(sql.match(/RAISE EXCEPTION 'TEAM_ASSIGNMENTS_CHANGED'/g)).toHaveLength(3);
    expect(sql.indexOf('FOR UPDATE')).toBeLessThan(sql.indexOf('PERFORM pg_advisory_xact_lock('));
    expect(sql).toContain('v_current IS DISTINCT FROM v_expected');
    expect(sql).toContain('v_deleted IS DISTINCT FROM v_expected');
  });
  it('scopes deletion to the confirmed employee/day/IDs and exposes no public execution', () => {
    const deletion = sql.slice(sql.indexOf('DELETE FROM'));
    expect(deletion).toContain('assignment.profile_id = p_profile_id');
    expect(deletion).toContain('assignment.work_date = p_work_date');
    expect(deletion).toContain('assignment.id = ANY(v_current)');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('TO service_role');
    expect(sql).not.toContain('DELETE FROM public.schedule_plant_assignments');
  });
});
