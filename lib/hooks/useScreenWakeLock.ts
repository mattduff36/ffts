'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ScreenWakeLockStatus = 'inactive' | 'requesting' | 'active' | 'unsupported' | 'interrupted' | 'error';

interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release: () => Promise<void>;
}

interface NavigatorWithOptionalWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

interface UseScreenWakeLockResult {
  status: ScreenWakeLockStatus;
  error: string | null;
  isSupported: boolean;
}

export function useScreenWakeLock(enabled: boolean): UseScreenWakeLockResult {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  const [status, setStatus] = useState<ScreenWakeLockStatus>('inactive');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (!sentinel || sentinel.released) return;

    await sentinel.release().catch(() => undefined);
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
    const wakeLock = (navigator as unknown as NavigatorWithOptionalWakeLock).wakeLock;

    if (!wakeLock) {
      setStatus('unsupported');
      setError(null);
      return;
    }

    if (!enabledRef.current || document.visibilityState !== 'visible') return;
    if (sentinelRef.current && !sentinelRef.current.released) return;

    setStatus('requesting');
    try {
      const sentinel = await wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setError(null);
      setStatus('active');

      sentinel.addEventListener('release', () => {
        sentinelRef.current = null;
        if (enabledRef.current) setStatus('interrupted');
        else setStatus('inactive');
      }, { once: true });
    } catch (requestError) {
      setStatus('error');
      setError(requestError instanceof Error ? requestError.message : 'Screen wake lock request failed');
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      void releaseWakeLock();
      queueMicrotask(() => {
        if (!enabledRef.current) {
          setStatus('inactive');
          setError(null);
        }
      });
      return;
    }

    queueMicrotask(() => {
      if (enabledRef.current) {
        void requestWakeLock();
      }
    });
  }, [enabled, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabledRef.current) {
        void requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [releaseWakeLock, requestWakeLock]);

  return {
    status,
    error,
    isSupported: status !== 'unsupported',
  };
}

export type { ScreenWakeLockStatus };
