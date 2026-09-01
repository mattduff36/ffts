import { describe, expect, it } from 'vitest';
import {
  buildScheduleDayTeams,
  emptyScheduleDayTeamSlots,
  removeScheduleDayTeamMember,
  SCHEDULE_DAY_TEAM_SLOT_CAPACITY,
  SCHEDULE_DAY_TEAM_SLOT_INDEXES,
  slotsForScheduleDate,
  upsertScheduleDayTeamMember,
} from '@/lib/utils/scheduling-day-teams';
import type { ScheduleDayTeamMember, SchedulingBoardPayload } from '@/types/scheduling';

const member = (profileId: string, slot: 1 | 2 | 3): ScheduleDayTeamMember => ({
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
});

function boardWithTeams(members: ScheduleDayTeamMember[]): SchedulingBoardPayload {
  return {
    week: { start: '2026-08-31', end: '2026-09-06' },
    jobs: [],
    tags: [],
    visits: [],
    assignments: [],
    resources: { employees: [], plant: [] },
    employee_capacity: [],
    plant_unavailability: [],
    day_teams: buildScheduleDayTeams(['2026-09-01'], members),
  };
}

describe('schedule day team helpers', () => {
  it('SCH-TEAM-TYPE-001 exports three bounded slot indexes', () => {
    expect(SCHEDULE_DAY_TEAM_SLOT_INDEXES).toEqual([1, 2, 3]);
    expect(SCHEDULE_DAY_TEAM_SLOT_CAPACITY).toBe(6);
  });
  it('synthesizes three empty slots when a date is missing', () => {
    expect(emptyScheduleDayTeamSlots('2026-09-01').map((slot) => slot.slot_index)).toEqual([1, 2, 3]);
    expect(slotsForScheduleDate([], '2026-09-01')).toHaveLength(3);
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
