import { NextRequest, NextResponse } from 'next/server';
import { enrichTrackerLocationWithVanNickname } from '@/lib/server/fleet-tracker-enrichment';

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
  address: string;
  [key: string]: unknown;
}

interface FleetLocationResource {
  id: string;
  type: string;
  attributes: FleetLocationAttributes;
}

interface LocationResult {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  updatedAt: string;
}

/* ---------- persistent cache (survives HMR in dev) ---------- */
interface FleetsmartCache {
  vehicles: FleetVehicle[] | null;
  vehiclesCachedAt: number;
  locationCache: Map<string, { data: LocationResult; cachedAt: number }>;
  lastRequestAt: number;
}

const g = globalThis as unknown as { __fleetsmartCache?: FleetsmartCache };
if (!g.__fleetsmartCache) {
  g.__fleetsmartCache = {
    vehicles: null,
    vehiclesCachedAt: 0,
    locationCache: new Map(),
    lastRequestAt: 0,
  };
}
const cache = g.__fleetsmartCache;

const VEHICLES_TTL_MS = 30_000; // cache vehicle list for 30 s
const LOCATION_TTL_MS = 30_000; // cache per-vehicle location for 30 s
const MIN_INTERVAL_MS = 2_000;  // 2 s between FleetSmart requests (safety margin)
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 15_000;

/* ---------- helpers ---------- */
function fleetsmartHeaders(): HeadersInit {
  return {
    'X-CLIENT-ID': CLIENT_ID,
    'X-API-KEY': API_KEY,
    'Content-Type': 'application/vnd.api+json',
  };
}

function regNorm(s: string): string {
  return s.replace(/\s/g, '').toUpperCase();
}

function matchAsset(
  vehicles: FleetVehicle[],
  plantId?: string,
  regNumber?: string
): FleetVehicle | null {
  for (const v of vehicles) {
    if (
      plantId &&
      (v.name?.endsWith(`/${plantId}`) || v.name?.includes(`/${plantId}`))
    ) {
      return v;
    }
    if (
      regNumber &&
      (regNorm(v.vrn || '') === regNorm(regNumber) ||
        regNorm(v.name || '') === regNorm(regNumber))
    ) {
      return v;
    }
  }
  return null;
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - cache.lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  cache.lastRequestAt = Date.now();
}

async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    const res = await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429 && attempt < retries) {
      // Wait extra before retrying on rate limit
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    return res;
  }
  // Should not reach here, but satisfy TS
  throw new Error('FleetSmart request failed after retries');
}

async function fetchVehicles(): Promise<FleetVehicle[]> {
  const now = Date.now();
  if (cache.vehicles && now - cache.vehiclesCachedAt < VEHICLES_TTL_MS) {
    return cache.vehicles;
  }

  const url = `${BASE}/api/vehicles.json?page%5Bsize%5D=200`;
  const res = await fetchWithRetry(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`FleetSmart vehicles request failed: ${res.status}`);
  }

  const json = await res.json();
  const vehicles: FleetVehicle[] = json.data ?? json ?? [];
  cache.vehicles = vehicles;
  cache.vehiclesCachedAt = Date.now();
  return vehicles;
}

async function fetchLatestLocation(
  vehicleId: string
): Promise<LocationResult | null> {
  // Check per-vehicle location cache
  const cached = cache.locationCache.get(vehicleId);
  if (cached && Date.now() - cached.cachedAt < LOCATION_TTL_MS) {
    return cached.data;
  }

  // Use JSON:API format (not .json) for sorting/pagination support
  const url = `${BASE}/api/vehicle_locations?filter%5Bvehicle_id%5D=${vehicleId}&sort=-date_time&page%5Bsize%5D=1`;
  const res = await fetchWithRetry(url, {
    headers: fleetsmartHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`FleetSmart location request failed: ${res.status}`);
  }

  const json = await res.json();
  const resources: FleetLocationResource[] = json.data ?? [];
  if (resources.length === 0) return null;

  const attrs = resources[0].attributes;
  const result: LocationResult = {
    lat: parseFloat(attrs.latitude),
    lng: parseFloat(attrs.longitude),
    speed: attrs.speed ?? 0,
    heading: attrs.heading ?? 0,
    updatedAt: attrs.date_time,
  };

  cache.locationCache.set(vehicleId, { data: result, cachedAt: Date.now() });
  return result;
}

/* ---------- route handler ---------- */
export async function GET(request: NextRequest) {
  if (!CLIENT_ID || !API_KEY) {
    return NextResponse.json(
      { error: 'missing_credentials', message: 'FleetSmart API credentials not configured' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const plantId = searchParams.get('plantId') ?? undefined;
  const regNumber = searchParams.get('regNumber') ?? undefined;

  if (!plantId && !regNumber) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Provide either plantId or regNumber query param' },
      { status: 400 }
    );
  }

  try {
    const vehicles = await fetchVehicles();
    const matched = matchAsset(vehicles, plantId, regNumber);

    if (!matched) {
      return NextResponse.json({ error: 'not_found', message: 'Asset not found in FleetSmart' });
    }

    const location = await fetchLatestLocation(matched.id);

    if (!location) {
      return NextResponse.json({
        error: 'no_location',
        message: 'Asset found but no location data available',
        vehicleName: matched.name,
      });
    }

    return NextResponse.json(
      await enrichTrackerLocationWithVanNickname({
        vehicleId: matched.id,
        name: matched.name,
        vrn: matched.vrn,
        lat: location.lat,
        lng: location.lng,
        speed: location.speed,
        heading: location.heading,
        updatedAt: location.updatedAt,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message.includes('401') || message.includes('403')) {
      return NextResponse.json(
        { error: 'auth_error', message: 'FleetSmart authentication failed' },
        { status: 401 }
      );
    }
    if (message.includes('429')) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'FleetSmart rate limit exceeded. Try again shortly.' },
        { status: 429 }
      );
    }

    console.error('[FleetSmart API]', message);
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch FleetSmart data' },
      { status: 500 }
    );
  }
}
