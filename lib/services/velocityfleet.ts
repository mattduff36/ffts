import { normalizeTrackerTimestamp } from '@/lib/utils/tracker-dates';

const DEFAULT_BASE_URL = 'https://www.velocityfleet.com';
const TOKEN_TTL_MS = 50 * 60_000;
const CUSTOMER_IDS_TTL_MS = 15 * 60_000;
const POSITIONS_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_INTERVAL_MS = 500;

interface VelocityfleetCache {
  accessToken: string | null;
  accessTokenCachedAt: number;
  customerIds: string[] | null;
  customerIdsCachedAt: number;
  positions: VelocityfleetVehicleLocation[] | null;
  positionsCachedAt: number;
  lastRequestAt: number;
}

interface VelocityfleetAuthResponse {
  token?: unknown;
  access?: unknown;
  access_token?: unknown;
}

interface VelocityfleetDevicePosition {
  id?: unknown;
  service_id?: unknown;
  lat?: unknown;
  lon?: unknown;
  vehicle_registration?: unknown;
  driver_name?: unknown;
  speed?: unknown;
  direction?: unknown;
  time?: unknown;
  timestamp?: unknown;
}

interface VelocityfleetPositionsResponse {
  devices?: unknown;
  results?: unknown;
  data?: unknown;
  positions?: unknown;
}

export interface VelocityfleetVehicleLocation {
  vehicleId: string;
  name: string;
  vrn: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  updatedAt: string;
  customerId: string;
}

export interface VelocityfleetError {
  code: 'auth_error' | 'rate_limited' | 'server_error';
  message: string;
  status: number;
}

interface VelocityfleetErrorShape extends Error {
  velocityfleet?: VelocityfleetError;
}

const g = globalThis as unknown as { __velocityfleetCache?: VelocityfleetCache };
if (!g.__velocityfleetCache) {
  g.__velocityfleetCache = {
    accessToken: null,
    accessTokenCachedAt: 0,
    customerIds: null,
    customerIdsCachedAt: 0,
    positions: null,
    positionsCachedAt: 0,
    lastRequestAt: 0,
  };
}

const cache = g.__velocityfleetCache;

export function normalizeVelocityfleetRegistration(registration: string | null | undefined): string {
  return (registration ?? '').replace(/\s/g, '').toUpperCase();
}

export function resolveVelocityfleetBaseUrl(value = process.env.VELOCITYFLEET_BASE_URL): string {
  if (!isUsableEnvValue(value)) return DEFAULT_BASE_URL;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_BASE_URL;
    return url.origin;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function parseVelocityfleetCustomerIds(payload: unknown): string[] {
  if (Array.isArray(payload)) return uniqueStrings(payload.map(readCustomerId));

  if (!isRecord(payload)) return [];

  for (const key of ['results', 'data', 'customers', 'items']) {
    const value = payload[key];
    if (Array.isArray(value)) return uniqueStrings(value.map(readCustomerId));
  }

  return uniqueStrings(
    Object.entries(payload)
      .filter(([, value]) => isRecord(value))
      .map(([key]) => key)
  );
}

export function parseVelocityfleetPositions(
  payload: unknown,
  customerId = ''
): VelocityfleetVehicleLocation[] {
  const rows = extractPositionRows(payload);
  const locations: VelocityfleetVehicleLocation[] = [];

  for (const row of rows) {
    const location = mapVelocityfleetDevicePosition(row, customerId);
    if (location) locations.push(location);
  }

  return dedupeLocationsByRegistration(locations);
}

export function findVelocityfleetLocationByRegistration(
  locations: VelocityfleetVehicleLocation[],
  registration: string
): VelocityfleetVehicleLocation | null {
  const target = normalizeVelocityfleetRegistration(registration);
  if (!target) return null;

  return locations.find((location) => normalizeVelocityfleetRegistration(location.vrn) === target) ?? null;
}

export function isVelocityfleetError(error: unknown): error is VelocityfleetErrorShape {
  return error instanceof Error && isRecord(error) && isRecord(error.velocityfleet);
}

function isInvalidAccessTokenError(error: unknown): boolean {
  return isVelocityfleetError(error)
    && error.velocityfleet?.code === 'auth_error'
    && error.velocityfleet.status === 401;
}

function invalidateVelocityfleetAuthCache(): void {
  cache.accessToken = null;
  cache.accessTokenCachedAt = 0;
  cache.customerIds = null;
  cache.customerIdsCachedAt = 0;
  cache.positions = null;
  cache.positionsCachedAt = 0;
}

export async function getVelocityfleetLocationByRegistration(
  registration: string
): Promise<VelocityfleetVehicleLocation | null> {
  const locations = await getVelocityfleetLocations();
  return findVelocityfleetLocationByRegistration(locations, registration);
}

export async function getVelocityfleetLocations(): Promise<VelocityfleetVehicleLocation[]> {
  if (cache.positions && Date.now() - cache.positionsCachedAt < POSITIONS_TTL_MS) {
    return cache.positions;
  }

  return getVelocityfleetLocationsWithAuthRetry(false);
}

async function getVelocityfleetLocationsWithAuthRetry(
  hasRetried: boolean
): Promise<VelocityfleetVehicleLocation[]> {
  try {
    const token = await getAccessToken();
    const customerIds = await getCustomerIds(token);
    const allLocations: VelocityfleetVehicleLocation[] = [];

    for (const customerId of customerIds) {
      const locations = await fetchCustomerPositions(token, customerId);
      allLocations.push(...locations);
    }

    cache.positions = dedupeLocationsByRegistration(allLocations);
    cache.positionsCachedAt = Date.now();
    return cache.positions;
  } catch (error) {
    if (!hasRetried && isInvalidAccessTokenError(error)) {
      invalidateVelocityfleetAuthCache();
      return getVelocityfleetLocationsWithAuthRetry(true);
    }
    throw error;
  }
}

function isUsableEnvValue(value: string | undefined): value is string {
  const normalized = value?.trim();
  if (!normalized) return false;
  return !['[blank]', 'blank', 'xxxx', 'undefined', 'null'].includes(normalized.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readCustomerId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!isRecord(value)) return '';

  for (const key of ['id', 'customer_id', 'uuid', 'pk', 'number']) {
    const raw = value[key];
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
  }

  return '';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractPositionRows(payload: unknown): VelocityfleetDevicePosition[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  const positionKeys: Array<keyof VelocityfleetPositionsResponse> = ['devices', 'results', 'data', 'positions'];
  const positionsPayload = payload as VelocityfleetPositionsResponse;

  for (const key of positionKeys) {
    const value = positionsPayload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [];
}

function mapVelocityfleetDevicePosition(
  row: VelocityfleetDevicePosition,
  customerId: string
): VelocityfleetVehicleLocation | null {
  const vrn = stringValue(row.vehicle_registration);
  const lat = numberValue(row.lat);
  const lng = numberValue(row.lon);
  if (!vrn || lat === null || lng === null) return null;

  return {
    vehicleId: stringValue(row.id) || stringValue(row.service_id) || vrn,
    name: vrn,
    vrn,
    lat,
    lng,
    speed: numberValue(row.speed) ?? 0,
    heading: numberValue(row.direction) ?? 0,
    updatedAt: normalizeTrackerTimestamp(row.timestamp) || normalizeTrackerTimestamp(row.time) || new Date().toISOString(),
    customerId,
  };
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dedupeLocationsByRegistration(
  locations: VelocityfleetVehicleLocation[]
): VelocityfleetVehicleLocation[] {
  const byRegistration = new Map<string, VelocityfleetVehicleLocation>();

  for (const location of locations) {
    const key = normalizeVelocityfleetRegistration(location.vrn);
    if (!key) continue;

    const existing = byRegistration.get(key);
    if (!existing || timestampValue(location.updatedAt) >= timestampValue(existing.updatedAt)) {
      byRegistration.set(key, location);
    }
  }

  return [...byRegistration.values()];
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getAccessToken(): Promise<string> {
  if (cache.accessToken && Date.now() - cache.accessTokenCachedAt < TOKEN_TTL_MS) {
    return cache.accessToken;
  }

  const apiKey = process.env.VELOCITYFLEET_API_KEY?.trim();
  if (!apiKey) {
    throw createVelocityfleetError('auth_error', 'Velocityfleet API token is not configured', 500);
  }

  const payload = await requestJson<VelocityfleetAuthResponse>(
    `${resolveVelocityfleetBaseUrl()}/vapi/v1/accounts/users/oauth2/refresh/`,
    {
      method: 'POST',
      body: JSON.stringify({ token: apiKey }),
    }
  );

  const token = stringValue(payload.token) || stringValue(payload.access) || stringValue(payload.access_token);
  if (!token) {
    throw createVelocityfleetError('auth_error', 'Velocityfleet authentication response did not include a token', 401);
  }

  cache.accessToken = token;
  cache.accessTokenCachedAt = Date.now();
  return token;
}

async function getCustomerIds(token: string): Promise<string[]> {
  const configuredCustomerId = process.env.VELOCITYFLEET_CLIENT_ID?.trim();
  if (isUsableEnvValue(configuredCustomerId)) return [configuredCustomerId];

  if (cache.customerIds && Date.now() - cache.customerIdsCachedAt < CUSTOMER_IDS_TTL_MS) {
    return cache.customerIds;
  }

  const payload = await requestJson<unknown>(
    `${resolveVelocityfleetBaseUrl()}/vapi/v1/accounts/users/customers`,
    {
      headers: authorizationHeaders(token),
    }
  );

  const customerIds = parseVelocityfleetCustomerIds(payload);
  if (customerIds.length === 0) {
    throw createVelocityfleetError('server_error', 'Velocityfleet did not return any customer ids', 502);
  }

  cache.customerIds = customerIds;
  cache.customerIdsCachedAt = Date.now();
  return customerIds;
}

async function fetchCustomerPositions(
  token: string,
  customerId: string
): Promise<VelocityfleetVehicleLocation[]> {
  const url = `${resolveVelocityfleetBaseUrl()}/api/mobile/kinesis/device-live-positions/?customer=${encodeURIComponent(customerId)}`;

  try {
    const payload = await requestJson<unknown>(url, {
      method: 'POST',
      headers: authorizationHeaders(token),
      body: JSON.stringify({}),
    });
    return parseVelocityfleetPositions(payload, customerId);
  } catch (error) {
    if (isVelocityfleetError(error) && error.velocityfleet?.code === 'server_error') return [];
    throw error;
  }
}

function authorizationHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  await throttle();

  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      invalidateVelocityfleetAuthCache();
      throw createVelocityfleetError('auth_error', 'Velocityfleet authentication failed', 401);
    }
    if (res.status === 429) {
      throw createVelocityfleetError('rate_limited', 'Velocityfleet rate limit exceeded', 429);
    }
    throw createVelocityfleetError('server_error', `Velocityfleet request failed: ${res.status}`, res.status);
  }

  return (await res.json()) as T;
}

async function throttle(): Promise<void> {
  const elapsed = Date.now() - cache.lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  cache.lastRequestAt = Date.now();
}

function createVelocityfleetError(
  code: VelocityfleetError['code'],
  message: string,
  status: number
): VelocityfleetErrorShape {
  const error = new Error(message) as VelocityfleetErrorShape;
  error.velocityfleet = { code, message, status };
  return error;
}
