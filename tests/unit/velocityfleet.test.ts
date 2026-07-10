import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findVelocityfleetLocationByRegistration,
  getVelocityfleetLocations,
  normalizeVelocityfleetRegistration,
  parseVelocityfleetCustomerIds,
  parseVelocityfleetPositions,
  resolveVelocityfleetBaseUrl,
} from '@/lib/services/velocityfleet';

interface TestVelocityfleetCache {
  accessToken: string | null;
  accessTokenCachedAt: number;
  customerIds: string[] | null;
  customerIdsCachedAt: number;
  positions: unknown[] | null;
  positionsCachedAt: number;
  lastRequestAt: number;
}

const originalEnv = {
  VELOCITYFLEET_API_KEY: process.env.VELOCITYFLEET_API_KEY,
  VELOCITYFLEET_BASE_URL: process.env.VELOCITYFLEET_BASE_URL,
  VELOCITYFLEET_CLIENT_ID: process.env.VELOCITYFLEET_CLIENT_ID,
};

function getTestCache(): TestVelocityfleetCache {
  return (globalThis as unknown as { __velocityfleetCache: TestVelocityfleetCache }).__velocityfleetCache;
}

function resetTestCache(): void {
  const cache = getTestCache();
  cache.accessToken = null;
  cache.accessTokenCachedAt = 0;
  cache.customerIds = null;
  cache.customerIdsCachedAt = 0;
  cache.positions = null;
  cache.positionsCachedAt = 0;
  cache.lastRequestAt = 0;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  resetTestCache();
  process.env.VELOCITYFLEET_API_KEY = 'test-api-key';
  process.env.VELOCITYFLEET_BASE_URL = 'https://velocity.example';
  process.env.VELOCITYFLEET_CLIENT_ID = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.VELOCITYFLEET_API_KEY = originalEnv.VELOCITYFLEET_API_KEY;
  process.env.VELOCITYFLEET_BASE_URL = originalEnv.VELOCITYFLEET_BASE_URL;
  process.env.VELOCITYFLEET_CLIENT_ID = originalEnv.VELOCITYFLEET_CLIENT_ID;
  resetTestCache();
});

describe('Velocityfleet service helpers', () => {
  it('normalizes vehicle registrations for matching', () => {
    expect(normalizeVelocityfleetRegistration(' ab12 cde ')).toBe('AB12CDE');
    expect(normalizeVelocityfleetRegistration(null)).toBe('');
  });

  it('falls back to the documented base URL when env value is blank or invalid', () => {
    expect(resolveVelocityfleetBaseUrl('')).toBe('https://www.velocityfleet.com');
    expect(resolveVelocityfleetBaseUrl('xxxx')).toBe('https://www.velocityfleet.com');
    expect(resolveVelocityfleetBaseUrl('https://example.com/path')).toBe('https://example.com');
  });

  it('parses customer ids from Velocityfleet keyed customer responses', () => {
    expect(
      parseVelocityfleetCustomerIds({
        '2204736670001': { name: 'Customer A', number: 'A001', product: 'telematics' },
        '23716537500001': { name: 'Customer B', number: 'B001', product: 'telematics' },
      })
    ).toEqual(['2204736670001', '23716537500001']);
  });

  it('parses live device positions into map-compatible locations', () => {
    const locations = parseVelocityfleetPositions(
      {
        devices: [
          {
            id: 123,
            lat: 52.1,
            lon: -1.2,
            vehicle_registration: 'AB12 CDE',
            speed: 31,
            direction: 180,
            timestamp: '2026-05-07T18:35:00Z',
          },
          {
            id: 456,
            lat: null,
            lon: -1.3,
            vehicle_registration: 'INVALID',
          },
        ],
      },
      'customer-1'
    );

    expect(locations).toEqual([
      {
        vehicleId: '123',
        name: 'AB12 CDE',
        vrn: 'AB12 CDE',
        lat: 52.1,
        lng: -1.2,
        speed: 31,
        heading: 180,
        updatedAt: '2026-05-07T18:35:00.000Z',
        customerId: 'customer-1',
      },
    ]);
  });

  it('normalizes Velocityfleet numeric timestamps before exposing map data', () => {
    const [location] = parseVelocityfleetPositions({
      devices: [
        {
          id: 123,
          lat: 52.1,
          lon: -1.2,
          vehicle_registration: 'AB12 CDE',
          timestamp: 1_778_178_900,
        },
      ],
    });

    expect(location.updatedAt).toBe('2026-05-07T18:35:00.000Z');
  });

  it('matches locations by normalized registration', () => {
    const [location] = parseVelocityfleetPositions({
      devices: [
        {
          id: 123,
          lat: '52.1',
          lon: '-1.2',
          vehicle_registration: 'AB12 CDE',
          speed: '0',
          direction: '90',
          time: '2026-05-07T18:35:00Z',
        },
      ],
    });

    expect(findVelocityfleetLocationByRegistration([location], 'ab12cde')).toBe(location);
    expect(findVelocityfleetLocationByRegistration([location], 'zz99 zzz')).toBeNull();
  });

  it('invalidates a stale cached access token and retries once after downstream auth failure', async () => {
    const cache = getTestCache();
    cache.accessToken = 'stale-token';
    cache.accessTokenCachedAt = Date.now();
    cache.customerIds = ['customer-1'];
    cache.customerIdsCachedAt = Date.now();

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(url);

      if (requestUrl.includes('/api/mobile/kinesis/device-live-positions/') && init?.headers) {
        const headers = init.headers as Record<string, string>;
        if (headers.Authorization === 'Bearer stale-token') return jsonResponse({ detail: 'expired' }, 401);
      }

      if (requestUrl.includes('/vapi/v1/accounts/users/oauth2/refresh/')) {
        return jsonResponse({ token: 'fresh-token' });
      }

      if (requestUrl.includes('/vapi/v1/accounts/users/customers')) {
        return jsonResponse({ 'customer-1': { name: 'Customer 1', product: 'telematics' } });
      }

      if (requestUrl.includes('/api/mobile/kinesis/device-live-positions/')) {
        return jsonResponse({
          devices: [
            {
              id: 123,
              lat: 52.1,
              lon: -1.2,
              vehicle_registration: 'AB12 CDE',
              timestamp: '2026-05-07T18:35:00Z',
            },
          ],
        });
      }

      return jsonResponse({ detail: 'unexpected request' }, 500);
    });

    vi.stubGlobal('fetch', fetchMock);

    const locations = await getVelocityfleetLocations();

    expect(locations).toHaveLength(1);
    expect(locations[0].vrn).toBe('AB12 CDE');
    expect(cache.accessToken).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
