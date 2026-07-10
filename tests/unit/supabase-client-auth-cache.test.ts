import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  createSupabaseClientMock,
  loadClientAuthSessionMock,
  getViewAsRoleIdMock,
  getViewAsTeamIdMock,
} = vi.hoisted(() => ({
  createSupabaseClientMock: vi.fn(),
  loadClientAuthSessionMock: vi.fn(),
  getViewAsRoleIdMock: vi.fn(),
  getViewAsTeamIdMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createSupabaseClientMock,
}));

vi.mock('@/lib/app-auth/client-session', () => ({
  loadClientAuthSession: loadClientAuthSessionMock,
}));

vi.mock('@/lib/utils/view-as-cookie', () => ({
  getViewAsRoleId: getViewAsRoleIdMock,
  getViewAsTeamId: getViewAsTeamIdMock,
}));

function setupClientEnv(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  vi.stubGlobal('window', {
    location: {
      origin: 'https://app.example.com',
    },
  } as unknown as Window);
}

function createMockBaseClient() {
  return {
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    },
    realtime: {
      setAuth: vi.fn(),
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('supabase browser client', () => {
  it('creates a singleton browser client and exposes synthetic auth state', async () => {
    setupClientEnv();

    const baseClient = createMockBaseClient();
    createSupabaseClientMock.mockImplementation((_url, _key, options) => ({
      ...baseClient,
      options,
    }));
    loadClientAuthSessionMock.mockResolvedValue({
      payload: {
        authenticated: true,
        user: {
          id: 'user-123',
          email: 'worker@example.com',
        },
      },
    });

    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      token: 'data-token-123',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const {
      createClient,
      getLastDataTokenFailureStatus,
      invalidateCachedDataToken,
    } = await import('@/lib/supabase/client');

    const client = createClient() as unknown as typeof baseClient & {
      options: {
        accessToken: () => Promise<string | null>;
      };
    };

    expect(createClient()).toBe(client);
    expect(createSupabaseClientMock).toHaveBeenCalledTimes(1);

    const {
      data: { user },
    } = await client.auth.getUser();
    expect(user?.id).toBe('user-123');
    expect(user?.email).toBe('worker@example.com');

    const {
      data: { session },
    } = await client.auth.getSession();
    expect(session?.access_token).toBe('data-token-123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getLastDataTokenFailureStatus()).toBeNull();

    invalidateCachedDataToken();
    expect(getLastDataTokenFailureStatus()).toBeNull();
  });

  it('injects view-as headers into Supabase fetches', async () => {
    setupClientEnv();
    getViewAsRoleIdMock.mockReturnValue('role-123');
    getViewAsTeamIdMock.mockReturnValue('team-456');

    const fetchSpy = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit
    ) => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    createSupabaseClientMock.mockImplementation((_url, _key, options) => ({
      ...createMockBaseClient(),
      options,
    }));
    loadClientAuthSessionMock.mockResolvedValue({
      payload: {
        authenticated: true,
        user: {
          id: 'user-123',
          email: 'worker@example.com',
        },
      },
    });

    const { createClient } = await import('@/lib/supabase/client');
    const client = createClient() as unknown as {
      options: {
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
        };
      };
    };

    await client.options.global.fetch('https://example.supabase.co/rest/v1/profiles', {});

    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('x-view-as-role-id')).toBe('role-123');
    expect(headers.get('x-view-as-team-id')).toBe('team-456');
  });

  it('records data-token failures for auth-aware callers', async () => {
    setupClientEnv();

    const baseClient = createMockBaseClient();
    createSupabaseClientMock.mockImplementation((_url, _key, options) => ({
      ...baseClient,
      options,
    }));
    loadClientAuthSessionMock.mockResolvedValue({
      payload: {
        authenticated: true,
        user: {
          id: 'user-123',
          email: 'worker@example.com',
        },
      },
    });

    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      error: 'No active access token',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const { createClient, getLastDataTokenFailureStatus } = await import('@/lib/supabase/client');
    const client = createClient() as unknown as typeof baseClient & {
      options: {
        accessToken: () => Promise<string | null>;
      };
    };

    const {
      data: { session },
    } = await client.auth.getSession();

    expect(session).toBeNull();
    expect(getLastDataTokenFailureStatus()).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await expect(client.options.accessToken()).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
