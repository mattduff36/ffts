import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { normalizeTeamSettingsSaveInput } from '@/lib/server/scheduling-team-settings';
import {
  SCHEDULE_DAY_TEAM_DATE_LOCK_PREFIX,
  SCHEDULE_TEAM_SETTINGS_LOCK_KEY,
  isVisibleScheduleDayTeamSlotIndex,
} from '@/lib/utils/scheduling-day-teams';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260904120000_schedule_team_settings.sql'),
  'utf8'
);

describe('schedule team settings SQL contract', () => {
  it('sched-team-migration-upgrade widens slots and creates settings tables', () => {
    expect(sql).toContain('CHECK (slot_index BETWEEN 1 AND 10)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.schedule_team_settings');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.schedule_team_slot_leaders');
    expect(sql).toContain('save_schedule_team_settings_v1');
  });

  it('sched-team-settings-concurrency locks settings before the per-date lock', () => {
    expect(sql).toContain(`hashtextextended('${SCHEDULE_TEAM_SETTINGS_LOCK_KEY}', 0)`);
    expect(sql).toContain(`hashtextextended('${SCHEDULE_DAY_TEAM_DATE_LOCK_PREFIX}'`);
    const sharedLock = sql.indexOf('pg_advisory_xact_lock_shared(v_settings_lock)');
    const dateLock = sql.indexOf('pg_advisory_xact_lock(v_lock_key)');
    const exclusiveSave = sql.indexOf('PERFORM pg_advisory_xact_lock(v_settings_lock);');
    expect(sharedLock).toBeGreaterThan(-1);
    expect(dateLock).toBeGreaterThan(sharedLock);
    expect(exclusiveSave).toBeGreaterThan(-1);
  });

  it('sched-team-settings-atomic validates shrink and leaders before mutation', () => {
    const shrinkCheck = sql.indexOf('TEAM_SLOT_IN_USE');
    const saveFn = sql.indexOf('save_schedule_team_settings_v1');
    const saveCapacity = sql.indexOf("RAISE EXCEPTION 'TEAM_SLOT_FULL'", saveFn);
    const deleteLeaders = sql.indexOf('DELETE FROM public.schedule_team_slot_leaders');
    expect(shrinkCheck).toBeGreaterThan(-1);
    expect(saveCapacity).toBeGreaterThan(saveFn);
    expect(deleteLeaders).toBeGreaterThan(saveCapacity);
    expect(sql).toContain('v_profile = ANY (v_seen)');
    expect(sql).toContain('v_effective_count := v_target_count + CASE WHEN v_slot_has_leader THEN 1 ELSE 0 END');
    expect(sql).toContain('IF v_effective_count >= 6 THEN');
  });

  it('revokes authenticated writes on team settings tables and RPC', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.schedule_team_settings FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID)');
    expect(sql.replace(/\s+/g, ' ')).toContain(
      'GRANT EXECUTE ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID) TO service_role'
    );
  });

  it('sched-team-slot-range hides slots above the visible count', () => {
    expect(isVisibleScheduleDayTeamSlotIndex(5, 5)).toBe(true);
    expect(isVisibleScheduleDayTeamSlotIndex(6, 5)).toBe(false);
    expect(isVisibleScheduleDayTeamSlotIndex(11, 10)).toBe(false);
    expect((sql.match(/IF p_slot_index > v_visible THEN/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes five leader slots for a settings save', () => {
    expect(normalizeTeamSettingsSaveInput({
      visible_slot_count: 7,
      leaders: [{ slot_index: 2, profile_id: '22222222-2222-4222-8222-222222222222' }],
    })).toEqual({
      visible_slot_count: 7,
      leaders: [
        { slot_index: 1, profile_id: null },
        { slot_index: 2, profile_id: '22222222-2222-4222-8222-222222222222' },
        { slot_index: 3, profile_id: null },
        { slot_index: 4, profile_id: null },
        { slot_index: 5, profile_id: null },
      ],
    });
  });
});
