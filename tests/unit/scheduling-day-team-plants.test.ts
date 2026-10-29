import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildScheduleDayTeams,
  mapDayTeamPlantRow,
  removeScheduleDayTeamMember,
  scheduleDayTeamPlantsOccupyHiddenSlots,
  slotsForScheduleDate,
  upsertScheduleDayTeamMember,
} from '@/lib/utils/scheduling-day-teams';
import type {
  ScheduleDayTeamMember,
  ScheduleDayTeamPlant,
  ScheduleDayTeamSlotIndex,
  SchedulePlantResource,
  ScheduleTeamSettings,
  SchedulingBoardPayload,
} from '@/types/scheduling';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261028224000_schedule_day_team_plants.sql'),
  'utf8'
);

const settings = (visible = 8): ScheduleTeamSettings => ({
  visible_slot_count: visible,
  leaders: [],
  names: {},
  updated_by: null,
  updated_at: '2026-09-01T08:00:00.000Z',
});

const digger: SchedulePlantResource = {
  id: 'plant-1',
  plant_id: 'P-1',
  nickname: 'Digger',
  make: 'JCB',
  model: '3CX',
  status: 'active',
};

function member(profileId: string, slot: ScheduleDayTeamSlotIndex): ScheduleDayTeamMember {
  return {
    work_date: '2026-09-01',
    slot_index: slot,
    profile_id: profileId,
    employee: {
      id: profileId,
      full_name: profileId,
      employee_id: null,
      team_id: null,
      team_name: null,
      kind: 'employee',
    },
    added_by: 'manager-1',
    created_at: '2026-09-01T08:00:00.000Z',
    is_leader: false,
  };
}

function plant(slot: ScheduleDayTeamSlotIndex, plantId = 'plant-1'): ScheduleDayTeamPlant {
  return {
    work_date: '2026-09-01',
    slot_index: slot,
    plant_id: plantId,
    plant: plantId === digger.id ? digger : { ...digger, id: plantId },
    added_by: 'manager-1',
    created_at: '2026-09-01T09:00:00.000Z',
  };
}

function boardWith(
  members: ScheduleDayTeamMember[],
  plants: ScheduleDayTeamPlant[],
  teamSettings: ScheduleTeamSettings = settings()
): SchedulingBoardPayload {
  return {
    week: { start: '2026-08-31', end: '2026-09-06' },
    jobs: [],
    tags: [],
    visits: [],
    assignments: [],
    resources: { employees: [], plant: [digger] },
    employee_capacity: [],
    plant_unavailability: [],
    team_settings: teamSettings,
    day_teams: buildScheduleDayTeams(['2026-09-01'], members, teamSettings, plants),
  };
}

function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION', start + 10);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe('schedule day team plants', () => {
  it('maps a plant membership row onto its resource and rejects a hidden slot index', () => {
    const plantsById = new Map([[digger.id, digger]]);
    expect(mapDayTeamPlantRow({
      work_date: '2026-09-01T00:00:00.000Z',
      slot_index: 12,
      plant_id: digger.id,
      added_by: 'manager-1',
      created_at: '2026-09-01T09:00:00.000Z',
    }, plantsById)).toEqual({
      work_date: '2026-09-01',
      slot_index: 12,
      plant_id: digger.id,
      plant: digger,
      added_by: 'manager-1',
      created_at: '2026-09-01T09:00:00.000Z',
    });
    expect(mapDayTeamPlantRow({
      work_date: '2026-09-01',
      slot_index: 17,
      plant_id: digger.id,
    }, plantsById)).toBeNull();
    expect(mapDayTeamPlantRow({
      work_date: '2026-09-01',
      slot_index: 2,
      plant_id: '',
    }, plantsById)).toBeNull();
  });

  it('drops plants on buckets above the visible count and reports that shrink as occupied', () => {
    const built = buildScheduleDayTeams(
      ['2026-09-01'],
      [],
      settings(8),
      [plant(12), plant(3, 'plant-2')]
    );
    expect(built[0].slots.map((slot) => slot.slot_index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(built[0].slots.find((slot) => slot.slot_index === 3)?.plants?.map((item) => item.plant_id))
      .toEqual(['plant-2']);
    expect(built[0].slots.some((slot) => slot.slot_index === 12)).toBe(false);
    expect(scheduleDayTeamPlantsOccupyHiddenSlots([plant(12), plant(3)], 8)).toBe(true);
    expect(scheduleDayTeamPlantsOccupyHiddenSlots([plant(8)], 8)).toBe(false);
    expect(scheduleDayTeamPlantsOccupyHiddenSlots([plant(9)], 16)).toBe(false);
  });

  it('keeps plant membership when employee optimistic add, move, and remove rebuild the day', () => {
    const teamSettings = settings(8);
    const starting = boardWith([member('e1', 1)], [plant(1), plant(4, 'plant-2')], teamSettings);
    const added = upsertScheduleDayTeamMember(starting, member('e2', 1));
    const moved = upsertScheduleDayTeamMember(added, { ...member('e1', 2), profile_id: 'e1' });
    const removed = removeScheduleDayTeamMember(moved, '2026-09-01', 1, 'e2');
    const slots = slotsForScheduleDate(removed.day_teams, '2026-09-01', teamSettings);
    expect(slots.find((slot) => slot.slot_index === 1)?.plants?.map((item) => item.plant_id))
      .toEqual(['plant-1']);
    expect(slots.find((slot) => slot.slot_index === 4)?.plants?.map((item) => item.plant_id))
      .toEqual(['plant-2']);
    expect(slots.find((slot) => slot.slot_index === 2)?.members.map((item) => item.profile_id))
      .toEqual(['e1']);
  });

  it('keeps a plant on a bucket that already holds six employees', () => {
    const members = [1, 2, 3, 4, 5, 6].map((index) => member(`e${index}`, 1));
    const slots = buildScheduleDayTeams(['2026-09-01'], members, settings(8), [plant(1)])[0].slots;
    expect(slots[0].members).toHaveLength(6);
    expect(slots[0].plants?.map((item) => item.plant_id)).toEqual(['plant-1']);
  });

  it('stores plant membership separately and blocks hidden buckets before settings update', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.schedule_day_team_plants');
    expect(sql).toContain('PRIMARY KEY (work_date, slot_index, plant_id)');
    expect(sql).toContain('UNIQUE (work_date, plant_id)');
    expect(sql).toContain('REFERENCES public.plant(id)');
    expect(sql).toContain("CHECK (slot_index BETWEEN 1 AND 16)");
    expect(sql).toContain(
      "USING (public.effective_module_access_level('scheduling') >= 4)"
    );
    expect(sql).toContain(
      'GRANT SELECT ON TABLE public.schedule_day_team_plants TO authenticated'
    );
    expect(sql).toContain(
      'GRANT ALL ON TABLE public.schedule_day_team_plants TO service_role'
    );

    const addPlant = functionBody('add_schedule_day_team_plant_v1');
    const removePlant = functionBody('remove_schedule_day_team_plant_v1');
    const save = functionBody('save_schedule_team_settings_v1');
    expect(addPlant).toContain('SECURITY DEFINER');
    expect(addPlant).toContain('SET search_path = pg_catalog, public');
    expect(addPlant.indexOf('pg_advisory_xact_lock_shared(v_settings_lock)'))
      .toBeLessThan(addPlant.indexOf('pg_advisory_xact_lock(v_lock_key)'));
    expect(addPlant).toContain("v_status = 'retired'");
    expect(addPlant).toContain('IF p_slot_index > v_visible THEN');
    expect(addPlant).not.toContain('>= 6');
    expect(removePlant).toContain('SECURITY DEFINER');
    expect(removePlant).not.toContain('>= 6');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.add_schedule_day_team_plant_v1(DATE, SMALLINT, UUID, UUID)'
    );
    expect(sql).toContain('TO service_role');

    const employeeGuard = save.indexOf('FROM public.schedule_day_team_members AS members');
    const plantGuard = save.indexOf('FROM public.schedule_day_team_plants AS plants');
    const settingsWrite = save.indexOf('INSERT INTO public.schedule_team_settings');
    expect(employeeGuard).toBeGreaterThan(-1);
    expect(plantGuard).toBeGreaterThan(employeeGuard);
    expect(settingsWrite).toBeGreaterThan(plantGuard);
    expect(save).toContain('plants.slot_index > p_visible_slot_count');
    expect(save).toContain('members.slot_index > p_visible_slot_count');
    expect(save).toContain('HAVING COUNT(*) > 5');
    expect(save.indexOf('pg_advisory_xact_lock(v_settings_lock)')).toBeLessThan(employeeGuard);
  });
});
