import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clampVisibleScheduleDayTeamSlotCount,
  defaultScheduleTeamSettings,
  isScheduleDayTeamSlotIndex,
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
    return { status: 409, error: 'Remove employees from extra teams before hiding those buckets.' };
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
    return { status: 400, error: 'Choose between 5 and 10 teams, with leaders on the first five only.' };
  }
  if (message.includes('TEAM_PROFILE_INVALID')) {
    return { status: 400, error: 'Choose distinct active employees as team leaders.' };
  }
  return null;
}

function mapLeaderRow(
  row: Record<string, unknown>,
  employeesById: Map<string, ScheduleEmployeeResource>
): ScheduleTeamSlotLeader | null {
  const slotIndex = Number(row.slot_index);
  if (!isScheduleDayTeamSlotIndex(slotIndex) || slotIndex > 5) return null;
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
      .select('visible_slot_count, updated_by, updated_at')
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
      Number(settings.visible_slot_count || 5)
    ),
    leaders,
    updated_by: typeof settings.updated_by === 'string' ? settings.updated_by : null,
    updated_at: typeof settings.updated_at === 'string' ? settings.updated_at : null,
  };
}

export function normalizeTeamSettingsSaveInput(input: {
  visible_slot_count: number;
  leaders: Array<{ slot_index: number; profile_id: string | null }>;
}): {
  visible_slot_count: number;
  leaders: Array<{ slot_index: number; profile_id: string | null }>;
} {
  return {
    visible_slot_count: clampVisibleScheduleDayTeamSlotCount(input.visible_slot_count),
    leaders: [1, 2, 3, 4, 5].map((slotIndex) => ({
      slot_index: slotIndex,
      profile_id:
        input.leaders.find((leader) => leader.slot_index === slotIndex)?.profile_id || null,
    })),
  };
}
