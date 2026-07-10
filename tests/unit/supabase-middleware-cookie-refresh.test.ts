import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { APP_SESSION_COOKIE_NAME } from '@/lib/server/app-auth/constants';

const { createServerClientMock, verifyJwtHS256Mock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  verifyJwtHS256Mock: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}));

vi.mock('@/lib/server/app-auth/jwt', () => ({
  verifyJwtHS256: verifyJwtHS256Mock,
}));

import { updateSession } from '@/lib/supabase/middleware';

interface MockMiddlewareOptions {
  user: { id: string } | null;
  cookiesToSet?: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }>;
}

function mockSupabaseMiddlewareAuth(options: MockMiddlewareOptions): void {
  createServerClientMock.mockImplementation((_url, _key, config) => ({
    auth: {
      getUser: vi.fn(async () => {
        if (options.cookiesToSet) {
          config.cookies.setAll(options.cookiesToSet);
        }

        return {
          data: {
            user: options.user,
          },
          error: null,
        };
      }),
    },
  }));
}

function createRequest(url: string, cookieHeader?: string): NextRequest {
  return new NextRequest(url, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
  });
}

describe('supabase middleware cookie refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('APP_SESSION_SECRET', 'test-app-session-secret');
    verifyJwtHS256Mock.mockResolvedValue({
      sid: 'session-1',
      secret: 'secret-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      v: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves refreshed cookies on root redirects for authenticated users', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: 'rotated-root-token',
          options: { path: '/', httpOnly: true },
        },
      ],
    });

    const response = await updateSession(
      createRequest('http://localhost/', `${APP_SESSION_COOKIE_NAME}=valid-app-session`)
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('rotated-root-token');
  });

  it('preserves refreshed cookies on authenticated /login redirects', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: 'rotated-login-token',
          options: { path: '/', httpOnly: true },
        },
      ],
    });

    const response = await updateSession(
      createRequest('http://localhost/login', `${APP_SESSION_COOKIE_NAME}=valid-app-session`)
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('rotated-login-token');
  });

  it('preserves full workshop task route and query when redirecting to login', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });

    const response = await updateSession(
      new NextRequest('http://localhost/workshop-tasks?taskId=task-123&tab=all')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?redirect=%2Fworkshop-tasks%3FtaskId%3Dtask-123%26tab%3Dall'
    );
  });

  it('returns authenticated users from login to the requested workshop task route', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });

    const response = await updateSession(
      createRequest(
        'http://localhost/login?redirect=%2Fworkshop-tasks%3FtaskId%3Dtask-123%26tab%3Dall',
        `${APP_SESSION_COOKIE_NAME}=valid-app-session`
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/workshop-tasks?taskId=task-123&tab=all');
  });

  it('preserves refreshed cookies on protected page redirects to login', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: '',
          options: { path: '/', maxAge: 0 },
        },
      ],
    });

    const response = await updateSession(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fdashboard');
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('');
  });

  it('allows the workshop display board shell without an app session', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const localResponse = await updateSession(new NextRequest('http://localhost/displayboard-workshop'));
    const productionResponse = await updateSession(new NextRequest('https://example.test/displayboard-workshop'));

    expect(localResponse.status).toBe(200);
    expect(localResponse.headers.get('x-middleware-next')).toBe('1');
    expect(productionResponse.status).toBe(200);
    expect(productionResponse.headers.get('x-middleware-next')).toBe('1');
  });

  it('redirects legacy Samsung TV display board browsers to the fallback route', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(new NextRequest('http://localhost/displayboard-workshop', {
      headers: {
        'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1',
      },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/displayboard-workshop-tv');
  });

  it('allows the legacy TV display board fallback without an app session', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(new NextRequest('http://localhost/displayboard-workshop-tv'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('redirects stale login display board redirects back to the public display board shell', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(
      new NextRequest('http://localhost/login?redirect=%2Fdisplayboard-workshop')
    );
    const productionResponse = await updateSession(
      new NextRequest('https://example.test/login?redirect=%2Fdisplayboard-workshop')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/displayboard-workshop');
    expect(productionResponse.status).toBe(307);
    expect(productionResponse.headers.get('location')).toBe('https://example.test/displayboard-workshop');
  });

  it('redirects stale login display board redirects to the fallback route on legacy TVs', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(
      new NextRequest('http://localhost/login?redirect=%2Fdisplayboard-workshop', {
        headers: {
          'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1',
        },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/displayboard-workshop-tv');
  });

  it('clears stale legacy cookies while redirecting legacy TV display board browsers', async () => {
    mockSupabaseMiddlewareAuth({
      user: { id: 'legacy-user' },
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(
      new NextRequest('http://localhost/displayboard-workshop', {
        headers: {
          Cookie: 'sb-project-auth-token=legacy-token',
          'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1',
        },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/displayboard-workshop-tv');
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('');
  });

  it('allows display board token APIs without an app session', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const dataResponse = await updateSession(new NextRequest('http://localhost/api/display-board/workshop/data'));
    const pairingResponse = await updateSession(new NextRequest('http://localhost/api/display-board/workshop/pairing'));

    expect(dataResponse.status).toBe(200);
    expect(dataResponse.headers.get('x-middleware-next')).toBe('1');
    expect(pairingResponse.status).toBe(200);
    expect(pairingResponse.headers.get('x-middleware-next')).toBe('1');
  });

  it('clears stale legacy cookies but still allows display board token APIs through', async () => {
    mockSupabaseMiddlewareAuth({
      user: { id: 'legacy-user' },
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(
      createRequest('http://localhost/api/display-board/workshop/data', 'sb-project-auth-token=legacy-token')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('');
  });

  it('preserves refreshed cookies on unauthorized API json responses', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: '',
          options: { path: '/', maxAge: 0 },
        },
      ],
    });

    const response = await updateSession(new NextRequest('http://localhost/api/private'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('');
  });

  it('clears legacy Supabase cookies and redirects protected pages to login', async () => {
    mockSupabaseMiddlewareAuth({
      user: { id: 'legacy-user' },
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(
      createRequest('http://localhost/dashboard', 'sb-project-auth-token=legacy-token')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fdashboard');
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('');
  });

  it('returns a 401 for auth session requests that still rely on legacy cookies', async () => {
    mockSupabaseMiddlewareAuth({
      user: { id: 'legacy-user' },
    });
    verifyJwtHS256Mock.mockResolvedValue(null);

    const response = await updateSession(
      createRequest('http://localhost/api/auth/session', 'sb-project-auth-token=legacy-token')
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Legacy session expired',
      code: 'LEGACY_SESSION_EXPIRED',
    });
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('');
  });
});
