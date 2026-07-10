'use client';

import { useEffect } from 'react';
import { setWorkshopWorkflowActive } from '@/lib/client/workshop-draft-activity';
import { useScreenWakeLock, type ScreenWakeLockStatus } from '@/lib/hooks/useScreenWakeLock';

interface UseWorkshopActiveWakeLockResult {
  status: ScreenWakeLockStatus;
  error: string | null;
  isSupported: boolean;
}

const WORKSHOP_KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;

export function useWorkshopActiveWakeLock(
  workflowId: string,
  enabled: boolean
): UseWorkshopActiveWakeLockResult {
  const wakeLock = useScreenWakeLock(enabled);

  useEffect(() => {
    setWorkshopWorkflowActive(workflowId, enabled);
    return () => setWorkshopWorkflowActive(workflowId, false);
  }, [enabled, workflowId]);

  useEffect(() => {
    if (!enabled) return undefined;

    const keepAlive = () => {
      void fetch('/api/auth/session', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      }).catch(() => undefined);
    };

    keepAlive();
    const intervalId = window.setInterval(keepAlive, WORKSHOP_KEEPALIVE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [enabled]);

  return wakeLock;
}
