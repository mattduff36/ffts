import { afterEach, describe, expect, it, vi } from 'vitest';

describe('loadClientAuthSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('dedupes concurrent in-flight auth session requests', async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();

      return new Response(
        JSON.stringify({
          authenticated: true,
          user: { id: 'user-123', email: 'test@example.com' },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const [first, second] = await Promise.all([
      loadClientAuthSession(),
      loadClientAuthSession(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.status).toBe('authenticated');
  });

  it('returns an unauthenticated result for a 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({
          authenticated: false,
          user: null,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ))
    );

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const result = await loadClientAuthSession();

    expect(result.status).toBe('unauthenticated');
    expect(result.responseStatus).toBe(401);
  });

  it('reports and clears auth session outage state around 5xx recovery', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({ error: 'Temporary failure' }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ))
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({
          authenticated: true,
          user: { id: 'user-123', email: 'restored@example.com' },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ));

    vi.stubGlobal('fetch', fetchMock);

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const { getClientServiceOutage } = await import('@/lib/app-auth/client-service-health');

    const failedResult = await loadClientAuthSession();
    expect(failedResult.status).toBe('error');
    expect(getClientServiceOutage()).toMatchObject({
      source: 'auth-session',
      status: 503,
    });

    const recoveredResult = await loadClientAuthSession();
    expect(recoveredResult.status).toBe('authenticated');
    expect(getClientServiceOutage()).toBeNull();
  });

  it('preserves an existing outage when a later transport error has no status', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({ error: 'Temporary failure' }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ))
      .mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch');
      });

    vi.stubGlobal('fetch', fetchMock);

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const { getClientServiceOutage } = await import('@/lib/app-auth/client-service-health');

    const failedResult = await loadClientAuthSession();
    expect(failedResult.status).toBe('error');
    expect(getClientServiceOutage()).toMatchObject({
      source: 'auth-session',
      status: 503,
    });

    const transportErrorResult = await loadClientAuthSession();
    expect(transportErrorResult.status).toBe('error');
    expect(transportErrorResult.responseStatus).toBeNull();
    expect(getClientServiceOutage()).toMatchObject({
      source: 'auth-session',
      status: 503,
    });
  });

  it('does not latch outage state for transient transport failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const { getClientServiceOutage } = await import('@/lib/app-auth/client-service-health');

    const failedResult = await loadClientAuthSession();

    expect(failedResult.status).toBe('error');
    expect(failedResult.responseStatus).toBeNull();
    expect(getClientServiceOutage()).toBeNull();
  });
});
