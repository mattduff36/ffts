'use client';

import { useEffect, useRef } from 'react';
import { isSoftRefreshPaused } from '@/lib/client/soft-refresh';

export const SOFT_REFRESH_INTERVAL_MS = 15_000;

/** Refresh saved data only. Callers must disable this while a refresh could replace a draft. */
export function useSoftRefresh(refresh: () => unknown | Promise<unknown>, enabled = true) {
  const refreshRef = useRef(refresh);
  const runningRef = useRef(false);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let lastStarted = 0;
    const run = async () => {
      if (disposed || runningRef.current || isSoftRefreshPaused() || document.visibilityState === 'hidden' || !navigator.onLine) return;
      if (Date.now() - lastStarted < 2_000) return;
      lastStarted = Date.now();
      runningRef.current = true;
      try {
        await refreshRef.current();
      } catch {
        // Keep the last successful data; the next tick/reconnect retries.
      } finally {
        runningRef.current = false;
      }
    };
    const timer = window.setInterval(() => void run(), SOFT_REFRESH_INTERVAL_MS);
    const resume = () => void run();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled]);
}
