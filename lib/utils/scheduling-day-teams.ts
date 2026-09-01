import type {
  ScheduleDayTeamMember,
  ScheduleDayTeamSlot,
  ScheduleDayTeamSlotIndex,
  ScheduleDayTeams,
  ScheduleEmployeeResource,
  SchedulingBoardPayload,
} from '@/types/scheduling';

export const SCHEDULE_DAY_TEAM_SLOT_INDEXES = [1, 2, 3] as const;
export const SCHEDULE_DAY_TEAM_SLOT_CAPACITY = 6;
export const SCHEDULE_DAY_TEAM_SLOT_COUNT = 3;

export function isScheduleDayTeamSlotIndex(
  value: unknown
): value is ScheduleDayTeamSlotIndex {
  return value === 1 || value === 2 || value === 3;
}

export function emptyScheduleDayTeamSlots(workDate: string): ScheduleDayTeamSlot[] {
  return SCHEDULE_DAY_TEAM_SLOT_INDEXES.map((slotIndex) => ({
    work_date: workDate,
    slot_index: slotIndex,
    members: [],
  }));
}

export function buildScheduleDayTeams(
  dates: string[],
  members: ScheduleDayTeamMember[]
): ScheduleDayTeams[] {
  return dates.map((date) => {
    const slots = emptyScheduleDayTeamSlots(date);
    for (const member of members) {
      if (member.work_date !== date) continue;
      const slot = slots.find((item) => item.slot_index === member.slot_index);
      if (!slot) continue;
      if (slot.members.length >= SCHEDULE_DAY_TEAM_SLOT_CAPACITY) continue;
      slot.members.push(member);
    }
    return { date, slots };
  });
}

export function slotsForScheduleDate(
  dayTeams: ScheduleDayTeams[] | undefined,
  workDate: string
): ScheduleDayTeamSlot[] {
  return dayTeams?.find((entry) => entry.date === workDate)?.slots
    || emptyScheduleDayTeamSlots(workDate);
}

export function mapDayTeamMemberRow(
  row: Record<string, unknown>,
  employeesById: Map<string, ScheduleEmployeeResource>
): ScheduleDayTeamMember | null {
  const slotIndex = Number(row.slot_index);
  if (!isScheduleDayTeamSlotIndex(slotIndex)) return null;
  const profileId = String(row.profile_id || '');
  if (!profileId) return null;
  const workDate = String(row.work_date || '').slice(0, 10);
  if (!workDate) return null;
  return {
    work_date: workDate,
    slot_index: slotIndex,
    profile_id: profileId,
    employee: employeesById.get(profileId) || null,
    added_by: typeof row.added_by === 'string' ? row.added_by : null,
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

export function upsertScheduleDayTeamMember(
  board: SchedulingBoardPayload,
  member: ScheduleDayTeamMember
): SchedulingBoardPayload {
  const currentTeams = board.day_teams || [];
  const dates = currentTeams.some((entry) => entry.date === member.work_date)
    ? currentTeams.map((entry) => entry.date)
    : [...currentTeams.map((entry) => entry.date), member.work_date].sort();
  const existingMembers = currentTeams.flatMap((entry) =>
    entry.slots.flatMap((slot) => slot.members)
  ).filter(
    (item) =>
      !(item.work_date === member.work_date && item.profile_id === member.profile_id)
  );
  return {
    ...board,
    day_teams: buildScheduleDayTeams(dates, [...existingMembers, member]),
  };
}

export function removeScheduleDayTeamMember(
  board: SchedulingBoardPayload,
  workDate: string,
  slotIndex: ScheduleDayTeamSlotIndex,
  profileId: string
): SchedulingBoardPayload {
  const currentTeams = board.day_teams || [];
  const dates = currentTeams.map((entry) => entry.date);
  const remaining = currentTeams.flatMap((entry) =>
    entry.slots.flatMap((slot) => slot.members)
  ).filter(
    (item) =>
      !(
        item.work_date === workDate
        && item.slot_index === slotIndex
        && item.profile_id === profileId
      )
  );
  return {
    ...board,
    day_teams: buildScheduleDayTeams(dates, remaining),
  };
}
