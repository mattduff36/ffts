import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SCHEDULE_DAY_TEAM_DEFAULT_VISIBLE_SLOT_COUNT,
  SCHEDULE_TEAM_SLOT_NAME_MAX_LENGTH,
  clampVisibleScheduleDayTeamSlotCount,
  defaultScheduleTeamSettings,
  isScheduleDayTeamSlotIndex,
  visibleScheduleDayTeamSlotIndexes,
} from '@/lib/utils/scheduling-day-teams';
import type {
  ScheduleEmployeeResource,
  ScheduleTeamSettings,
  ScheduleTeamSlotLeader,
} from '@/types/scheduling';

export function isMissingTeamSettingsRelation(error: unknown): boolean {
  const normalized = error as { code?: string; message?: string };
  const message = normalized?.message?.toLowerCase() || '';
  return (
    normalized?.code === '42P01'
    || normalized?.code === 'PGRST205'
    || (
      (message.includes('schedule_team_settings') || message.includes('schedule_team_slot_leaders'))
      && (message.includes('does not exist') || message.includes('schema cache'))
    )
  );
}

export function mapTeamSettingsRpcError(error: { code?: string; message?: string }): {
  status: number;
  error: string;
} | null {
  const message = error.message || '';
  if (message.includes('TEAM_SLOT_IN_USE')) {
    return { status: 409, error: 'Remove employees and plant from extra teams before hiding those buckets.' };
  }
  if (message.includes('TEAM_SLOT_FULL')) {
    return {
      status: 409,
      error: 'This team already has six employees on at least one day. Remove a member before adding a standing leader.',
    };
  }
  if (message.includes('TEAM_LEADER_LOCKED')) {
    return { status: 409, error: 'Change this team leader in Settings instead.' };
  }
  if (message.includes('TEAM_SLOT_INVALID')) {
    return {
      status: 400,
      error: 'Choose between 8 and 16 teams. Leaders and custom names must use visible teams.',
    };
  }
  if (message.includes('TEAM_PROFILE_INVALID')) {
    return { status: 400, error: 'Choose distinct active employees as team leaders.' };
  }
  return null;
}

export class ScheduleTeamSettingsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleTeamSettingsInputError';
  }
}

const CANONICAL_SLOT_KEY = /^(?:[1-9]|1[0-6])$/;

function mapLeaderRow(
  row: Record<string, unknown>,
  employeesById: Map<string, ScheduleEmployeeResource>
): ScheduleTeamSlotLeader | null {
  const slotIndex = Number(row.slot_index);
  if (!isScheduleDayTeamSlotIndex(slotIndex)) return null;
  const profileId = String(row.profile_id || '');
  if (!profileId) return null;
  return {
    slot_index: slotIndex,
    profile_id: profileId,
    employee: employeesById.get(profileId) || null,
  };
}

export async function loadScheduleTeamSettings(
  admin: SupabaseClient,
  employeesById: Map<string, ScheduleEmployeeResource>
): Promise<ScheduleTeamSettings> {
  const [settingsResult, leadersResult] = await Promise.all([
    admin
      .from('schedule_team_settings')
      .select('visible_slot_count, names, updated_by, updated_at')
      .eq('id', true)
      .maybeSingle(),
    admin
      .from('schedule_team_slot_leaders')
      .select('slot_index, profile_id')
      .order('slot_index'),
  ]);
  if (settingsResult.error) {
    if (isMissingTeamSettingsRelation(settingsResult.error)) {
      return defaultScheduleTeamSettings();
    }
    throw settingsResult.error;
  }
  if (leadersResult.error) {
    if (isMissingTeamSettingsRelation(leadersResult.error)) {
      return defaultScheduleTeamSettings();
    }
    throw leadersResult.error;
  }

  const settings = (settingsResult.data || {}) as Record<string, unknown>;
  const leaders = ((leadersResult.data || []) as Array<Record<string, unknown>>)
    .map((row) => mapLeaderRow(row, employeesById))
    .filter((row): row is ScheduleTeamSlotLeader => Boolean(row));

  return {
    visible_slot_count: clampVisibleScheduleDayTeamSlotCount(
      Number(settings.visible_slot_count ?? SCHEDULE_DAY_TEAM_DEFAULT_VISIBLE_SLOT_COUNT)
    ),
    leaders,
    names: mapStoredTeamNames(settings.names),
    updated_by: typeof settings.updated_by === 'string' ? settings.updated_by : null,
    updated_at: typeof settings.updated_at === 'string' ? settings.updated_at : null,
  };
}

function mapStoredTeamNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const names: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!CANONICAL_SLOT_KEY.test(key) || typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, SCHEDULE_TEAM_SLOT_NAME_MAX_LENGTH);
    if (!trimmed) continue;
    names[key] = trimmed;
  }
  return names;
}

export function normalizeTeamSettingsSaveInput(input: {
  visible_slot_count: number;
  leaders: Array<{ slot_index: number; profile_id: string | null }>;
  names?: Record<string, string> | null;
}): {
  visible_slot_count: number;
  leaders: Array<{ slot_index: number; profile_id: string | null }>;
  names: Record<string, string> | null;
} {
  const visibleSlotCount = clampVisibleScheduleDayTeamSlotCount(input.visible_slot_count);
  const seenSlots = new Set<number>();
  const seenProfiles = new Set<string>();
  const leadersBySlot = new Map<number, string | null>();

  for (const leader of input.leaders) {
    if (!isScheduleDayTeamSlotIndex(leader.slot_index) || leader.slot_index > visibleSlotCount) {
      throw new ScheduleTeamSettingsInputError('Leaders can only be set on visible teams.');
    }
    if (seenSlots.has(leader.slot_index)) {
      throw new ScheduleTeamSettingsInputError('Each team slot can have only one leader.');
    }
    seenSlots.add(leader.slot_index);
    const profileId = leader.profile_id || null;
    if (profileId) {
      if (seenProfiles.has(profileId)) {
        throw new ScheduleTeamSettingsInputError('Choose distinct active employees as team leaders.');
      }
      seenProfiles.add(profileId);
    }
    leadersBySlot.set(leader.slot_index, profileId);
  }

  return {
    visible_slot_count: visibleSlotCount,
    leaders: visibleScheduleDayTeamSlotIndexes(visibleSlotCount).map((slotIndex) => ({
      slot_index: slotIndex,
      profile_id: leadersBySlot.get(slotIndex) || null,
    })),
    names: input.names === undefined || input.names === null
      ? null
      : normalizeTeamSlotNames(input.names, visibleSlotCount),
  };
}

function normalizeTeamSlotNames(
  names: Record<string, string>,
  visibleSlotCount: number
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(names)) {
    if (!CANONICAL_SLOT_KEY.test(key) || Number(key) > visibleSlotCount) {
      throw new ScheduleTeamSettingsInputError('Custom team names must use a visible team slot.');
    }
    if (typeof raw !== 'string') {
      throw new ScheduleTeamSettingsInputError('Custom team names must be text.');
    }
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > SCHEDULE_TEAM_SLOT_NAME_MAX_LENGTH) {
      throw new ScheduleTeamSettingsInputError('Custom team names must be 80 characters or fewer.');
    }
    normalized[key] = trimmed;
  }
  return normalized;
}
