import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireDebugConsoleAccess = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/debug-console-access', () => ({
  requireDebugConsoleAccess,
  createDebugAccessErrorBody: (access: { error: string | null }) => ({
    error: access.error,
  }),
}));

import {
  DELETE,
  GET,
  POST,
} from '@/app/api/debug/test-vehicles/route';

describe('retired broad Test Fleet route', () => {
  beforeEach(() => {
    requireDebugConsoleAccess.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      profileId: 'super-admin',
    });
  });

  it('still requires Debug PIN access', async () => {
    requireDebugConsoleAccess.mockResolvedValue({
      ok: false,
      status: 428,
      error: 'PIN required',
    });
    const response = await GET(
      new NextRequest('http://localhost/api/debug/test-vehicles?prefix=ZZ99')
    );
    expect(response.status).toBe(428);
  });

  it.each([
    ['GET', GET],
    ['POST', POST],
    ['DELETE', DELETE],
  ] as const)('returns 410 for retired %s functionality', async (method, handler) => {
    const response = await handler(
      new NextRequest('http://localhost/api/debug/test-vehicles', {
        method,
        headers: { Origin: 'http://localhost' },
        body:
          method === 'GET'
            ? undefined
            : JSON.stringify({
                prefix: 'ANY-CLIENT-PREFIX',
                vehicle_ids: ['arbitrary-id'],
              }),
      })
    );
    const payload = await response.json();
    expect(response.status).toBe(410);
    expect(payload).toMatchObject({
      retired: true,
      replacement: '/debug?tab=sample-data',
    });
  });
});
