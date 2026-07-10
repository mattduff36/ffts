import { NextResponse } from 'next/server';
import { enrichTrackerLocationsWithVanNicknames } from '@/lib/server/fleet-tracker-enrichment';

const BASE = process.env.FLEETSMART_BASE_URL ?? 'https://www.fleetsmartlive.com';
const CLIENT_ID = process.env.FLEETSMART_CLIENT_ID ?? '';
const API_KEY = process.env.FLEETSMART_API_KEY ?? '';

/* ---------- types ---------- */
interface FleetVehicle {
  id: string;
  name: string;
  vrn: string;
  [key: string]: unknown;
}

interface FleetLocationAttributes {
  latitude: string;
  longitude: string;
  speed: number;
  heading: number;
  date_time: string;
  [key: string]: unknown;
}

interface FleetLocationResource {
  id: string;
  type: string;
  attributes: FleetLocationAttributes;
}

interface VehicleWithLocation {
  vehicleId: string;
  name: string;
  vrn: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  updatedAt: string;
}

/* ---------- persistent cache (survives HMR in dev) ---------- */
interface AllLocationsCache {
  vehicles: FleetVehicle[] | null;
  vehiclesCachedAt: number;
  /** Completed result of all vehicle locations */
  allLocations: VehicleWithLocation[] | null;
  allLocationsCachedAt: number;
  /** Per-vehicle location cache (shared for efficiency) */
  perVehicle: Map<string, { lat: number; lng: number; speed: number; heading: number; updatedAt: string } | null>;
  /** Is a background fetch currently running? */
  bgFetchInProgress: boolean;
  lastRequestAt: number;
}

const g = globalThis as unknown as { __fleetsmartAllLocCache2?: AllLocationsCache };
if (!g.__fleetsmartAllLocCache2) {
  g.__fleetsmartAllLocCache2 = {
    vehicles: null,
    vehiclesCachedAt: 0,
    allLocations: null,
    allLocationsCachedAt: 0,
    perVehicle: new Map(),
    bgFetchInProgress: false,
    lastRequestAt: 0,
  };
}
const cache = g.__fleetsmartAllLocCache2;

const VEHICLES_TTL_MS = 5 * 60_000;   // cache vehicle list for 5 min
const ALL_LOC_TTL_MS = 5 * 60_000;    // cache combined result for 5 min
const MIN_INTERVAL_MS = 2_500;         // 2.5 s between FleetSmart requests
const REQUEST_TIMEOUT_MS = 15_000;

/* ---------- helpers ---------- */
function fleetsmartHeaders(): HeadersInit {
  return {
    'X-CLIENT-ID': CLIENT_ID,
    'X-API-KEY': API_KEY,
    'Content-Type': 'application/vnd.api+json',
  };
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - cache.lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  cache.lastRequestAt = Date.now();
}

async function fetchVehicles(): Promise<FleetVehicle[]> {
  const now = Date.now();
  if (cache.vehicles && now - cache.vehiclesCachedAt < VEHICLES_TTL_MS) {
    return cache.vehicles;
  }

  await throttle();
  const url = `${BASE}/api/vehicles.json?page%5Bsize%5D=200`;
  const res = await fetch(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`FleetSmart vehicles: ${res.status}`);

  const json = await res.json();
  const vehicles: FleetVehicle[] = json.data ?? json ?? [];
  cache.vehicles = vehicles;
  cache.vehiclesCachedAt = Date.now();
  return vehicles;
}

/**
 * Fetch the latest location for a single vehicle.
 * Uses the filtered + sorted endpoint which is fast and reliable.
 */
async function fetchSingleLocation(
  vehicleId: string
): Promise<{ lat: number; lng: number; speed: number; heading: number; updatedAt: string } | null> {
  // Check per-vehicle cache first (no TTL — these are populated during the batch)
  const cached = cache.perVehicle.get(vehicleId);
  if (cached !== undefined) return cached;

  await throttle();
  const url = `${BASE}/api/vehicle_locations?filter%5Bvehicle_id%5D=${vehicleId}&sort=-date_time&page%5Bsize%5D=1`;
  const res = await fetch(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    cache.perVehicle.set(vehicleId, null);
    return null;
  }

  const json = await res.json();
  const resources: FleetLocationResource[] = json.data ?? [];
  if (resources.length === 0) {
    cache.perVehicle.set(vehicleId, null);
    return null;
  }

  const attrs = resources[0].attributes;
  const lat = parseFloat(attrs.latitude);
  const lng = parseFloat(attrs.longitude);
  if (isNaN(lat) || isNaN(lng)) {
    cache.perVehicle.set(vehicleId, null);
    return null;
  }

  const result = {
    lat,
    lng,
    speed: attrs.speed ?? 0,
    heading: attrs.heading ?? 0,
    updatedAt: attrs.date_time,
  };

  cache.perVehicle.set(vehicleId, result);
  return result;
}

/**
 * Fetch all vehicle locations by iterating through each vehicle.
 * The FleetSmart bulk location endpoint is unreliable (timeouts), so we
 * fetch individually with per-vehicle filtering which is fast (~500ms each).
 *
 * Results are cached for 5 minutes. Background fetch is non-blocking for
 * subsequent requests.
 */
async function fetchAllLocations(): Promise<VehicleWithLocation[]> {
  // Return cached if fresh
  if (cache.allLocations && Date.now() - cache.allLocationsCachedAt < ALL_LOC_TTL_MS) {
    return cache.allLocations;
  }

  const vehicles = await fetchVehicles();
  const results: VehicleWithLocation[] = [];

  console.log(`[FleetSmart All-Locations] Fetching locations for ${vehicles.length} vehicles individually...`);
  const start = Date.now();

  for (const vehicle of vehicles) {
    try {
      const loc = await fetchSingleLocation(vehicle.id);
      if (loc) {
        results.push({
          vehicleId: vehicle.id,
          name: vehicle.name,
          vrn: vehicle.vrn,
          ...loc,
        });
      }
    } catch (err) {
      // Skip vehicles that fail (timeout, rate limit, etc.)
      console.warn(`[FleetSmart All-Locations] Failed for ${vehicle.name}:`, err instanceof Error ? err.message : err);
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`[FleetSmart All-Locations] Done: ${results.length}/${vehicles.length} vehicles in ${elapsed}s`);

  cache.allLocations = results;
  cache.allLocationsCachedAt = Date.now();
  return results;
}

/**
 * Kick off a background fetch (non-blocking). The first request that
 * triggers this will get a partial/empty result, but subsequent requests
 * within the cache window will get the full dataset instantly.
 */
function startBackgroundFetch(): void {
  if (cache.bgFetchInProgress) return;
  cache.bgFetchInProgress = true;

  fetchAllLocations()
    .catch((err) => {
      console.error('[FleetSmart All-Locations BG] Error:', err instanceof Error ? err.message : err);
    })
    .finally(() => {
      cache.bgFetchInProgress = false;
    });
}

/* ---------- route handler ---------- */
export async function GET() {
  if (!CLIENT_ID || !API_KEY) {
    return NextResponse.json(
      { error: 'missing_credentials', message: 'FleetSmart API credentials not configured' },
      { status: 500 }
    );
  }

  // If we have cached data, return it immediately
  if (cache.allLocations && Date.now() - cache.allLocationsCachedAt < ALL_LOC_TTL_MS) {
    const vehicles = await enrichTrackerLocationsWithVanNicknames(cache.allLocations);
    return NextResponse.json({
      vehicles,
      count: vehicles.length,
      cached: true,
    });
  }

  // No cached data — start background fetch and return what we have
  // (which may be empty on the very first call)
  startBackgroundFetch();

  // If the background fetch is still running, build a partial result
  // from whatever per-vehicle locations we already have cached
  const vehicles = cache.vehicles ?? [];
  const partial: VehicleWithLocation[] = [];
  for (const v of vehicles) {
    const loc = cache.perVehicle.get(v.id);
    if (loc) {
      partial.push({
        vehicleId: v.id,
        name: v.name,
        vrn: v.vrn,
        ...loc,
      });
    }
  }

  const enrichedVehicles = await enrichTrackerLocationsWithVanNicknames(partial);

  return NextResponse.json({
    vehicles: enrichedVehicles,
    count: enrichedVehicles.length,
    totalVehicles: vehicles.length,
    loading: cache.bgFetchInProgress,
    cached: false,
  });
}
