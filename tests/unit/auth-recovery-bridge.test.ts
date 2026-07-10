import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('auth recovery bridge', () => {
  it('dedupes concurrent recovery requests through the registered handler', async () => {
    const recoverFromAuthFailure = vi.fn(async () => {
      await Promise.resolve();
      return true;
    });
    const forceAuthRedirect = vi.fn(async () => undefined);

    const {
      handleAuthFailureStatus,
      registerAuthRecoveryHandlers,
    } = await import('@/lib/app-auth/recovery-bridge');

    const unregister = registerAuthRecoveryHandlers({
      recoverFromAuthFailure,
      forceAuthRedirect,
    });

    const [first, second] = await Promise.all([
      handleAuthFailureStatus(401),
      handleAuthFailureStatus(401),
    ]);

    unregister();

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(recoverFromAuthFailure).toHaveBeenCalledTimes(1);
    expect(forceAuthRedirect).not.toHaveBeenCalled();
  });

  it('ignores removed locked-session responses', async () => {
    const replace = vi.fn();
    vi.stubGlobal('window', {
      location: {
        replace,
      },
    } as unknown as Window);

    const { handleAuthFailureStatus } = await import('@/lib/app-auth/recovery-bridge');
    const recovered = await handleAuthFailureStatus(423);

    expect(recovered).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to redirect instead of rejecting when recovery handler throws', async () => {
    const replace = vi.fn();
    vi.stubGlobal('window', {
      location: {
        replace,
      },
    } as unknown as Window);

    const recoverFromAuthFailure = vi.fn(async () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });
    const forceAuthRedirect = vi.fn(async () => undefined);

    const {
      handleAuthFailureStatus,
      registerAuthRecoveryHandlers,
    } = await import('@/lib/app-auth/recovery-bridge');

    const unregister = registerAuthRecoveryHandlers({
      recoverFromAuthFailure,
      forceAuthRedirect,
    });

    await expect(handleAuthFailureStatus(401)).resolves.toBe(false);

    unregister();

    expect(recoverFromAuthFailure).toHaveBeenCalledTimes(1);
    expect(forceAuthRedirect).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
