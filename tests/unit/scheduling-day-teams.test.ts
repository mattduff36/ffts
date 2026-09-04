import { describe, expect, it } from 'vitest';
import {
  buildScheduleDayTeams,
  emptyScheduleDayTeamSlots,
  extraSlotHasDailyMembers,
  profileIdsHiddenFromScheduleResources,
  removeScheduleDayTeamMember,
  SCHEDULE_DAY_TEAM_SLOT_CAPACITY,
  SCHEDULE_DAY_TEAM_SLOT_INDEXES,
  slotsForScheduleDate,
  upsertScheduleDayTeamMember,
  visibleScheduleDayTeamSlotIndexes,
} from '@/lib/utils/scheduling-day-teams';
import { formatScheduleTeamName } from '@/lib/utils/scheduling';
import type { ScheduleDayTeamMember, ScheduleTeamSettings, SchedulingBoardPayload } from '@/types/scheduling';

const settings = (overrides: Partial<ScheduleTeamSettings> = {}): ScheduleTeamSettings => ({
  visible_slot_count: 5,
  leaders: [],
  updated_by: null,
  updated_at: '2026-09-01T08:00:00.000Z',
  ...overrides,
});

const member = (profileId: string, slot: 1 | 2 | 3 | 4 | 5 | 6, isLeader = false): ScheduleDayTeamMember => ({
  work_date: '2026-09-01',
  slot_index: slot,
  profile_id: profileId,
  employee: {
    id: profileId,
    full_name: profileId,
    employee_id: null,
    team_id: null,
    team_name: null,
  },
  added_by: 'manager-1',
  created_at: '2026-09-01T08:00:00.000Z',
  is_leader: isLeader,
});

function boardWithTeams(
  members: ScheduleDayTeamMember[],
  teamSettings: ScheduleTeamSettings = settings()
): SchedulingBoardPayload {
  return {
    week: { start: '2026-08-31', end: '2026-09-06' },
    jobs: [],
    tags: [],
    visits: [],
    assignments: [],
    resources: { employees: [], plant: [] },
    employee_capacity: [],
    plant_unavailability: [],
    team_settings: teamSettings,
    day_teams: buildScheduleDayTeams(['2026-09-01'], members, teamSettings),
  };
}

describe('schedule day team helpers', () => {
  it('exports ten bounded slot indexes and five visible by default', () => {
    expect(SCHEDULE_DAY_TEAM_SLOT_INDEXES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(SCHEDULE_DAY_TEAM_SLOT_CAPACITY).toBe(6);
    expect(visibleScheduleDayTeamSlotIndexes()).toEqual([1, 2, 3, 4, 5]);
  });

  it('synthesizes five empty slots when a date is missing', () => {
    expect(emptyScheduleDayTeamSlots('2026-09-01').map((slot) => slot.slot_index)).toEqual([1, 2, 3, 4, 5]);
    expect(slotsForScheduleDate([], '2026-09-01')).toHaveLength(5);
  });

  it('rebuilds implicit leaders and visible slots from incomplete stored payload', () => {
    const teamSettings = settings({
      visible_slot_count: 6,
      leaders: [{
        slot_index: 1,
        profile_id: 'leader-1',
        employee: {
          id: 'leader-1',
          full_name: 'Tom Reed',
          employee_id: null,
          team_id: null,
          team_name: null,
        },
      }],
    });
    const slots = slotsForScheduleDate(
      [{
        date: '2026-09-01',
        slots: [{
          work_date: '2026-09-01',
          slot_index: 1,
          members: [member('e1', 1)],
        }],
      }],
      '2026-09-01',
      teamSettings
    );
    expect(slots.map((slot) => slot.slot_index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(slots[0].members.map((item) => item.profile_id)).toEqual(['leader-1', 'e1']);
    expect(slots[0].members[0].is_leader).toBe(true);
  });

  it('sched-team-leader-implicit prepends a standing leader without a daily row', () => {
    const teamSettings = settings({
      leaders: [{
        slot_index: 1,
        profile_id: 'leader-1',
        employee: {
          id: 'leader-1',
          full_name: 'Tom Reed',
          employee_id: null,
          team_id: null,
          team_name: null,
        },
      }],
    });
    const slots = slotsForScheduleDate(
      buildScheduleDayTeams(['2026-09-01'], [], teamSettings),
      '2026-09-01',
      teamSettings
    );
    expect(slots[0].members.map((item) => ({ id: item.profile_id, leader: item.is_leader }))).toEqual([
      { id: 'leader-1', leader: true },
    ]);
  });

  it('sched-team-cache-leader-preservation keeps the implicit leader after add and remove', () => {
    const teamSettings = settings({
      leaders: [{
        slot_index: 1,
        profile_id: 'leader-1',
        employee: {
          id: 'leader-1',
          full_name: 'Tom Reed',
          employee_id: null,
          team_id: null,
          team_name: null,
        },
      }],
    });
    const added = upsertScheduleDayTeamMember(boardWithTeams([], teamSettings), member('e1', 1));
    expect(
      slotsForScheduleDate(added.day_teams, '2026-09-01', teamSettings)[0].members.map((item) => item.profile_id)
    ).toEqual(['leader-1', 'e1']);
    const removed = removeScheduleDayTeamMember(added, '2026-09-01', 1, 'e1');
    expect(
      slotsForScheduleDate(removed.day_teams, '2026-09-01', teamSettings)[0].members.map((item) => item.profile_id)
    ).toEqual(['leader-1']);
  });

  it('sched-team-cross-source-unique ignores a stored daily row for the standing leader', () => {
    const teamSettings = settings({
      leaders: [{
        slot_index: 1,
        profile_id: 'leader-1',
        employee: {
          id: 'leader-1',
          full_name: 'Tom Reed',
          employee_id: null,
          team_id: null,
          team_name: null,
        },
      }],
    });
    const slots = slotsForScheduleDate(
      buildScheduleDayTeams(['2026-09-01'], [member('leader-1', 1)], teamSettings),
      '2026-09-01',
      teamSettings
    );
    expect(slots[0].members.filter((item) => item.profile_id === 'leader-1')).toHaveLength(1);
    expect(slots[0].members[0].is_leader).toBe(true);
  });

  it('sched-team-resource-once hides leaders and that day’s members', () => {
    const teamSettings = settings({
      leaders: [{
        slot_index: 2,
        profile_id: 'leader-2',
        employee: {
          id: 'leader-2',
          full_name: 'Pat Lee',
          employee_id: null,
          team_id: null,
          team_name: null,
        },
      }],
    });
    const board = boardWithTeams([member('e1', 1)], teamSettings);
    const hidden = profileIdsHiddenFromScheduleResources(board, '2026-09-01');
    expect([...hidden].sort()).toEqual(['e1', 'leader-2']);
  });

  it('sched-team-shrink-safety reports occupied extra slots', () => {
    expect(extraSlotHasDailyMembers(
      boardWithTeams([member('e6', 6)], settings({ visible_slot_count: 6 })),
      6
    )).toBe(true);
    expect(extraSlotHasDailyMembers(boardWithTeams([member('e1', 1)]), 6)).toBe(false);
  });

  it('sched-team-name formats a compact possessive team title', () => {
    expect(formatScheduleTeamName('Tom Reed', 1)).toBe("Tom R's team");
    expect(formatScheduleTeamName(null, 6)).toBe('Team 6');
  });

  it('moves an employee between slots instead of duplicating them', () => {
    const board = upsertScheduleDayTeamMember(
      boardWithTeams([member('e1', 1)]),
      member('e1', 2)
    );
    const slots = slotsForScheduleDate(board.day_teams, '2026-09-01');
    expect(slots[0].members).toHaveLength(0);
    expect(slots[1].members.map((item) => item.profile_id)).toEqual(['e1']);
  });

  it('removes a member from one slot only', () => {
    const board = removeScheduleDayTeamMember(
      boardWithTeams([member('e1', 1), member('e2', 1)]),
      '2026-09-01',
      1,
      'e1'
    );
    expect(
      slotsForScheduleDate(board.day_teams, '2026-09-01')[0].members.map((item) => item.profile_id)
    ).toEqual(['e2']);
  });
});
