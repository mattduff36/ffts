import { config } from 'dotenv';
import { resolve } from 'path';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeTeamSettingsSaveInput } from '@/lib/server/scheduling-team-settings';

config({ path: resolve(process.cwd(), '.env.local') });

const NAMED_LEADERS = [
  { slot_index: 1, name: 'Paul Braddow' },
  { slot_index: 2, name: 'Tom Newman-Bownes' },
  { slot_index: 3, name: 'Rich Waldron' },
  { slot_index: 4, name: 'Duncan Russell' },
  { slot_index: 5, name: 'Danny Shaw' },
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readFlagValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const actorUserId = readFlagValue('--actor');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, is_placeholder')
    .eq('is_placeholder', false);
  if (error) throw error;

  const profiles = (data || []) as Array<{ id: string; full_name: string | null }>;
  const matches = NAMED_LEADERS.map((leader) => {
    const exact = profiles.filter((profile) =>
      normalizeName(profile.full_name || '') === normalizeName(leader.name)
    );
    return {
      ...leader,
      matches: exact.map((profile) => ({ id: profile.id, full_name: profile.full_name })),
    };
  });

  console.log(JSON.stringify({ apply, actorUserId, matches }, null, 2));

  const unresolved = matches.filter((item) => item.matches.length !== 1);
  if (unresolved.length > 0) {
    console.log('Skipping Settings write: one or more names are missing or ambiguous.');
    process.exit(apply ? 2 : 0);
  }

  if (!apply) {
    console.log('Lookup complete. Re-run with --apply --actor <live profile uuid> to save these five leaders.');
    return;
  }

  if (!actorUserId || !UUID_PATTERN.test(actorUserId)) {
    console.error('--apply requires --actor <live profile uuid>. Do not reuse a team-leader id as a default actor.');
    process.exit(1);
  }

  const actor = profiles.find((profile) => profile.id === actorUserId);
  if (!actor) {
    console.error('Actor is not a live non-placeholder profile.');
    process.exit(1);
  }

  const settingsResult = await admin
    .from('schedule_team_settings')
    .select('visible_slot_count')
    .eq('id', true)
    .maybeSingle();
  if (settingsResult.error) throw settingsResult.error;

  const payload = normalizeTeamSettingsSaveInput({
    visible_slot_count: Number(settingsResult.data?.visible_slot_count || 5),
    leaders: matches.map((item) => ({
      slot_index: item.slot_index,
      profile_id: item.matches[0].id,
    })),
  });
  const { error: saveError } = await admin.rpc('save_schedule_team_settings_v1', {
    p_visible_slot_count: payload.visible_slot_count,
    p_leaders: payload.leaders,
    p_actor_user_id: actorUserId,
  });
  if (saveError) throw saveError;
  console.log('Saved named leaders on teams 1-5.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
