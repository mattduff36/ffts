import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenWakeLock } from '@/lib/hooks/useScreenWakeLock';

class MockWakeLockSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    value,
    configurable: true,
  });
}

function setWakeLockRequest(request?: (type: 'screen') => Promise<MockWakeLockSentinel>) {
  Object.defineProperty(navigator, 'wakeLock', {
    value: request ? { request } : undefined,
    configurable: true,
  });
}

function WakeLockHarness({ enabled }: { enabled: boolean }) {
  const wakeLock = useScreenWakeLock(enabled);
  return <div data-testid="wake-lock-status">{wakeLock.status}</div>;
}

describe('useScreenWakeLock', () => {
  beforeEach(() => {
    setVisibilityState('visible');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setWakeLockRequest(undefined);
  });

  it('requests and releases a screen wake lock when enabled changes', async () => {
    const sentinel = new MockWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    setWakeLockRequest(request);

    const { rerender } = render(<WakeLockHarness enabled />);

    await waitFor(() => expect(screen.getByTestId('wake-lock-status')).toHaveTextContent('active'));
    expect(request).toHaveBeenCalledWith('screen');

    rerender(<WakeLockHarness enabled={false} />);

    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
    expect(screen.getByTestId('wake-lock-status')).toHaveTextContent('inactive');
  });

  it('reacquires the wake lock after visibility returns', async () => {
    const firstSentinel = new MockWakeLockSentinel();
    const secondSentinel = new MockWakeLockSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(firstSentinel)
      .mockResolvedValueOnce(secondSentinel);
    setWakeLockRequest(request);

    render(<WakeLockHarness enabled />);

    await waitFor(() => expect(screen.getByTestId('wake-lock-status')).toHaveTextContent('active'));
    await firstSentinel.release();
    expect(screen.getByTestId('wake-lock-status')).toHaveTextContent('interrupted');

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('wake-lock-status')).toHaveTextContent('active'));
  });

  it('reports unsupported browsers without crashing', async () => {
    setWakeLockRequest(undefined);

    render(<WakeLockHarness enabled />);

    await waitFor(() => expect(screen.getByTestId('wake-lock-status')).toHaveTextContent('unsupported'));
  });
});
