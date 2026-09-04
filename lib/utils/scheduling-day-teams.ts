import type {
  ScheduleDayTeamMember,
  ScheduleDayTeamSlot,
  ScheduleDayTeamSlotIndex,
  ScheduleDayTeams,
  ScheduleEmployeeResource,
  ScheduleTeamSettings,
  ScheduleTeamSlotLeader,
  SchedulingBoardPayload,
} from '@/types/scheduling';

export const SCHEDULE_DAY_TEAM_SLOT_INDEXES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const SCHEDULE_DAY_TEAM_SLOT_CAPACITY = 6;
export const SCHEDULE_DAY_TEAM_MIN_VISIBLE_SLOT_COUNT = 5;
export const SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT = 10;
export const SCHEDULE_DAY_TEAM_DEFAULT_VISIBLE_SLOT_COUNT = 5;
export const SCHEDULE_TEAM_SETTINGS_LOCK_KEY = 'schedule-team-settings';
export const SCHEDULE_DAY_TEAM_DATE_LOCK_PREFIX = 'schedule-day-team:';

export function defaultScheduleTeamSettings(): ScheduleTeamSettings {
  return {
    visible_slot_count: SCHEDULE_DAY_TEAM_DEFAULT_VISIBLE_SLOT_COUNT,
    leaders: [],
    updated_by: null,
    updated_at: null,
  };
}

export function teamSettingsFromBoard(
  board: Pick<SchedulingBoardPayload, 'team_settings'> | undefined
): ScheduleTeamSettings {
  return board?.team_settings || defaultScheduleTeamSettings();
}

export function isScheduleDayTeamSlotIndex(
  value: unknown
): value is ScheduleDayTeamSlotIndex {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT
  );
}

export function isVisibleScheduleDayTeamSlotIndex(
  value: unknown,
  visibleSlotCount: number
): value is ScheduleDayTeamSlotIndex {
  return (
    isScheduleDayTeamSlotIndex(value)
    && value <= clampVisibleScheduleDayTeamSlotCount(visibleSlotCount)
  );
}

export function clampVisibleScheduleDayTeamSlotCount(value: number): number {
  if (!Number.isFinite(value)) return SCHEDULE_DAY_TEAM_DEFAULT_VISIBLE_SLOT_COUNT;
  return Math.min(
    SCHEDULE_DAY_TEAM_MAX_SLOT_COUNT,
    Math.max(SCHEDULE_DAY_TEAM_MIN_VISIBLE_SLOT_COUNT, Math.trunc(value))
  );
}

export function visibleScheduleDayTeamSlotIndexes(
  visibleSlotCount = SCHEDULE_DAY_TEAM_DEFAULT_VISIBLE_SLOT_COUNT
): ScheduleDayTeamSlotIndex[] {
  const count = clampVisibleScheduleDayTeamSlotCount(visibleSlotCount);
  return SCHEDULE_DAY_TEAM_SLOT_INDEXES.slice(0, count);
}

export function leaderBySlotIndex(
  settings: ScheduleTeamSettings | undefined,
  slotIndex: ScheduleDayTeamSlotIndex
): ScheduleTeamSlotLeader | undefined {
  return (settings?.leaders || []).find((leader) => leader.slot_index === slotIndex);
}

export function standingLeaderProfileIds(
  settings: ScheduleTeamSettings | undefined
): Set<string> {
  return new Set(
    (settings?.leaders || [])
      .map((leader) => leader.profile_id)
      .filter(Boolean)
  );
}

export function emptyScheduleDayTeamSlots(
  workDate: string,
  visibleSlotCount = SCHEDULE_DAY_TEAM_DEFAULT_VISIBLE_SLOT_COUNT
): ScheduleDayTeamSlot[] {
  return visibleScheduleDayTeamSlotIndexes(visibleSlotCount).map((slotIndex) => ({
    work_date: workDate,
    slot_index: slotIndex,
    members: [],
  }));
}

function implicitLeaderMember(
  workDate: string,
  leader: ScheduleTeamSlotLeader,
  createdAt: string
): ScheduleDayTeamMember {
  return {
    work_date: workDate,
    slot_index: leader.slot_index,
    profile_id: leader.profile_id,
    employee: leader.employee,
    added_by: null,
    created_at: createdAt,
    is_leader: true,
  };
}

export function buildScheduleDayTeams(
  dates: string[],
  members: ScheduleDayTeamMember[],
  settings: ScheduleTeamSettings = defaultScheduleTeamSettings()
): ScheduleDayTeams[] {
  const visibleCount = clampVisibleScheduleDayTeamSlotCount(settings.visible_slot_count);
  const leaders = (settings.leaders || []).filter((leader) =>
    isVisibleScheduleDayTeamSlotIndex(leader.slot_index, visibleCount)
  );
  const leaderIds = new Set(leaders.map((leader) => leader.profile_id));
  const createdAt = settings.updated_at || '1970-01-01T00:00:00.000Z';

  return dates.map((date) => {
    const slots = emptyScheduleDayTeamSlots(date, visibleCount);
    for (const leader of leaders) {
      const slot = slots.find((item) => item.slot_index === leader.slot_index);
      if (!slot) continue;
      slot.members.push(implicitLeaderMember(date, leader, createdAt));
    }
    for (const member of members) {
      if (member.work_date !== date) continue;
      if (leaderIds.has(member.profile_id) || member.is_leader) continue;
      const slot = slots.find((item) => item.slot_index === member.slot_index);
      if (!slot) continue;
      if (slot.members.length >= SCHEDULE_DAY_TEAM_SLOT_CAPACITY) continue;
      slot.members.push({ ...member, is_leader: false });
    }
    return { date, slots };
  });
}

function storedMembersForScheduleDate(
  dayTeams: ScheduleDayTeams[] | undefined,
  workDate: string
): ScheduleDayTeamMember[] {
  return (dayTeams || [])
    .filter((entry) => entry.date === workDate)
    .flatMap((entry) => entry.slots.flatMap((slot) => slot.members))
    .filter((member) => member.is_leader !== true)
    .map((member) => ({ ...member, work_date: workDate, is_leader: false }));
}

export function slotsForScheduleDate(
  dayTeams: ScheduleDayTeams[] | undefined,
  workDate: string,
  settings: ScheduleTeamSettings = defaultScheduleTeamSettings()
): ScheduleDayTeamSlot[] {
  return buildScheduleDayTeams(
    [workDate],
    storedMembersForScheduleDate(dayTeams, workDate),
    settings
  )[0].slots;
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
    is_leader: false,
  };
}

function storedMembersFromBoard(board: SchedulingBoardPayload): ScheduleDayTeamMember[] {
  return (board.day_teams || []).flatMap((entry) =>
    entry.slots.flatMap((slot) => slot.members)
  ).filter((item) => item.is_leader !== true);
}

export function upsertScheduleDayTeamMember(
  board: SchedulingBoardPayload,
  member: ScheduleDayTeamMember
): SchedulingBoardPayload {
  const settings = teamSettingsFromBoard(board);
  if (standingLeaderProfileIds(settings).has(member.profile_id) || member.is_leader) {
    return {
      ...board,
      team_settings: settings,
      day_teams: buildScheduleDayTeams(
        board.day_teams?.map((entry) => entry.date) || [member.work_date],
        storedMembersFromBoard(board),
        settings
      ),
    };
  }
  const currentTeams = board.day_teams || [];
  const dates = currentTeams.some((entry) => entry.date === member.work_date)
    ? currentTeams.map((entry) => entry.date)
    : [...currentTeams.map((entry) => entry.date), member.work_date].sort();
  const existingMembers = storedMembersFromBoard(board).filter(
    (item) =>
      !(item.work_date === member.work_date && item.profile_id === member.profile_id)
  );
  return {
    ...board,
    team_settings: settings,
    day_teams: buildScheduleDayTeams(dates, [...existingMembers, { ...member, is_leader: false }], settings),
  };
}

export function removeScheduleDayTeamMember(
  board: SchedulingBoardPayload,
  workDate: string,
  slotIndex: ScheduleDayTeamSlotIndex,
  profileId: string
): SchedulingBoardPayload {
  const settings = teamSettingsFromBoard(board);
  if (standingLeaderProfileIds(settings).has(profileId)) {
    return {
      ...board,
      team_settings: settings,
      day_teams: buildScheduleDayTeams(
        board.day_teams?.map((entry) => entry.date) || [workDate],
        storedMembersFromBoard(board),
        settings
      ),
    };
  }
  const currentTeams = board.day_teams || [];
  const dates = currentTeams.map((entry) => entry.date);
  const remaining = storedMembersFromBoard(board).filter(
    (item) =>
      !(
        item.work_date === workDate
        && item.slot_index === slotIndex
        && item.profile_id === profileId
      )
  );
  return {
    ...board,
    team_settings: settings,
    day_teams: buildScheduleDayTeams(dates, remaining, settings),
  };
}

export function profileIdsHiddenFromScheduleResources(
  board: Pick<SchedulingBoardPayload, 'day_teams' | 'team_settings'> | undefined,
  workDate: string
): Set<string> {
  const settings = teamSettingsFromBoard(board);
  const hidden = standingLeaderProfileIds(settings);
  for (const member of slotsForScheduleDate(board?.day_teams, workDate, settings)
    .flatMap((slot) => slot.members)) {
    hidden.add(member.profile_id);
  }
  return hidden;
}

export function extraSlotHasDailyMembers(
  board: Pick<SchedulingBoardPayload, 'day_teams'> | undefined,
  slotIndex: number
): boolean {
  return (board?.day_teams || []).some((entry) =>
    entry.slots.some(
      (slot) =>
        slot.slot_index === slotIndex
        && slot.members.some((member) => member.is_leader !== true)
    )
  );
}
