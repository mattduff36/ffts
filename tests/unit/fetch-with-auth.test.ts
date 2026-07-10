import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('fetchWithAuth helpers', () => {
  it('forwards protected API auth failures into the recovery bridge', async () => {
    const handleAuthFailureStatus = vi.fn(async () => false);
    vi.doMock('@/lib/app-auth/recovery-bridge', () => ({
      handleAuthFailureStatus,
    }));

    vi.stubGlobal('window', {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window);

    const { createAuthAwareFetch } = await import('@/lib/utils/fetch-with-auth');
    const baseFetch = vi.fn(async () => new Response('{}', { status: 401 }));
    const wrappedFetch = createAuthAwareFetch(baseFetch as unknown as typeof fetch);

    await wrappedFetch('/api/messages/pending');

    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(handleAuthFailureStatus).toHaveBeenCalledWith(401);
  });

  it('skips auth recovery for auth routes and explicit opt-outs', async () => {
    const handleAuthFailureStatus = vi.fn(async () => false);
    vi.doMock('@/lib/app-auth/recovery-bridge', () => ({
      handleAuthFailureStatus,
    }));

    vi.stubGlobal('window', {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window);

    const { createAuthAwareFetch } = await import('@/lib/utils/fetch-with-auth');
    const baseFetch = vi.fn(async () => new Response('{}', { status: 401 }));
    const wrappedFetch = createAuthAwareFetch(baseFetch as unknown as typeof fetch);

    await wrappedFetch('/api/auth/login');
    await wrappedFetch('/api/auth/change-password');
    await wrappedFetch('/api/dashboard/summary', { skipAuthRecovery: true });

    expect(handleAuthFailureStatus).not.toHaveBeenCalled();
  });
});
