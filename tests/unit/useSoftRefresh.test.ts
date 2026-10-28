/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOFT_REFRESH_INTERVAL_MS, useSoftRefresh } from '@/lib/hooks/useSoftRefresh';
import { isSoftRefreshPaused, pauseSoftRefresh } from '@/lib/client/soft-refresh';

function visibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}
async function tick() {
  await act(() => vi.advanceTimersByTimeAsync(SOFT_REFRESH_INTERVAL_MS));
}
beforeEach(() => {
  vi.useFakeTimers();
  visibility('visible');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('soft refresh', () => {
  it('updates an already open page periodically without remounting it', async () => {
    const refresh = vi.fn();
    renderHook(() => useSoftRefresh(refresh));
    expect(refresh).not.toHaveBeenCalled();
    await tick();
    await tick();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('pauses hidden/offline pages and catches up on return', async () => {
    const refresh = vi.fn();
    renderHook(() => useSoftRefresh(refresh));
    visibility('hidden');
    await tick();
    expect(refresh).not.toHaveBeenCalled();
    visibility('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('protects multiple drafts and resumes after all close', async () => {
    const refresh = vi.fn();
    renderHook(() => useSoftRefresh(refresh));
    const releaseA = pauseSoftRefresh();
    const releaseB = pauseSoftRefresh();
    await tick();
    releaseA();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
    releaseB();
    expect(isSoftRefreshPaused()).toBe(false);
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not overlap slow requests and retries a failed read', async () => {
    let finish!: () => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    renderHook(() => useSoftRefresh(refresh));
    await tick();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => finish());
    await tick();
    await tick();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('uses current filters, honours access/draft disable and cleans up', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ refresh, enabled }) => useSoftRefresh(refresh, enabled), {
      initialProps: { refresh: first, enabled: false },
    });
    await tick();
    expect(first).not.toHaveBeenCalled();
    rerender({ refresh: second, enabled: true });
    await tick();
    expect(second).toHaveBeenCalledOnce();
    unmount();
    await tick();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(second).toHaveBeenCalledOnce();
  });
});
