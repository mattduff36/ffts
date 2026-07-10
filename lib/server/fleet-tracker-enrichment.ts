import { createAdminClient } from '@/lib/supabase/admin';

function normalizeRegistration(registration: string): string {
  return registration.replace(/\s/g, '').toUpperCase();
}

interface VanNicknameRow {
  reg_number: string;
  nickname: string | null;
}

let nicknameCache: Map<string, string | null> | null = null;
let nicknameCacheAt = 0;
const NICKNAME_CACHE_TTL_MS = 5 * 60_000;

async function getVanNicknameByRegMap(): Promise<Map<string, string | null>> {
  const now = Date.now();
  if (nicknameCache && now - nicknameCacheAt < NICKNAME_CACHE_TTL_MS) {
    return nicknameCache;
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('vans')
      .select('reg_number, nickname')
      .not('reg_number', 'is', null);

    if (error) {
      console.error('[FleetTracker] Failed to load van nicknames:', error.message);
      return nicknameCache ?? new Map();
    }

    const map = new Map<string, string | null>();
    for (const van of (data ?? []) as VanNicknameRow[]) {
      if (!van.reg_number) continue;
      map.set(normalizeRegistration(van.reg_number), van.nickname?.trim() || null);
    }

    nicknameCache = map;
    nicknameCacheAt = now;
    return map;
  } catch (error) {
    console.error(
      '[FleetTracker] Failed to load van nicknames:',
      error instanceof Error ? error.message : error
    );
    return nicknameCache ?? new Map();
  }
}

function withVanNickname<T extends { vrn: string }>(
  location: T,
  nicknameMap: Map<string, string | null>
): T & { nickname?: string | null } {
  const nickname = nicknameMap.get(normalizeRegistration(location.vrn));
  return nickname ? { ...location, nickname } : location;
}

export async function enrichTrackerLocationsWithVanNicknames<T extends { vrn: string }>(
  locations: T[]
): Promise<Array<T & { nickname?: string | null }>> {
  if (locations.length === 0) return [];

  const nicknameMap = await getVanNicknameByRegMap();
  return locations.map((location) => withVanNickname(location, nicknameMap));
}

export async function enrichTrackerLocationWithVanNickname<T extends { vrn: string }>(
  location: T
): Promise<T & { nickname?: string | null }> {
  const nicknameMap = await getVanNicknameByRegMap();
  return withVanNickname(location, nicknameMap);
}
