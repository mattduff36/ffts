'use client';

/**
 * DeploymentVersionChecker
 *
 * Compares the deployment ID baked into the running JavaScript bundle
 * (NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID, set at build time by Vercel) against
 * the deployment ID currently reported by the server (/api/version).
 *
 * If they differ it means a new Vercel deployment has gone live while this
 * tab was open.  We force a full page reload so the user always runs the
 * current bundle.
 *
 * Checks are triggered:
 *   - On component mount
 *   - On document.visibilitychange → visible (tab re-focus)
 *   - On every pathname change (client-side navigation)
 *   - Every 10 minutes via setInterval (catches idle open tabs)
 *
 * Does nothing in local development (no NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID).
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { forceAppRefresh } from '@/lib/client/force-app-refresh';
import { hasWorkshopDirtyDrafts } from '@/lib/client/workshop-draft-activity';

// Baked in at build time by Vercel's system env vars.
// Will be undefined in local dev → checker is a no-op.
const CLIENT_DEPLOYMENT_ID = process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID;

// Rate-limit: don't hit /api/version more than once per 5 minutes.
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;
// Periodic background check: catch idle open tabs every 10 minutes.
const PERIODIC_CHECK_MS = 10 * 60 * 1000;

export function DeploymentVersionChecker() {
  const pathname = usePathname();
  const lastCheckRef = useRef<number>(0);
  const reloadingRef = useRef(false);

  const checkVersion = async (reason: string) => {
    if (!CLIENT_DEPLOYMENT_ID || reloadingRef.current) return;

    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;

    try {
      const res = await fetch('/api/version', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;

      const { deploymentId } = await res.json() as { deploymentId: string };

      if (deploymentId && deploymentId !== 'local' && deploymentId !== CLIENT_DEPLOYMENT_ID) {
        if (hasWorkshopDirtyDrafts()) {
          console.info(
            `[DeploymentChecker] Stale bundle detected (running=${CLIENT_DEPLOYMENT_ID}, server=${deploymentId}, reason=${reason}) but workshop drafts are dirty. Deferring reload.`
          );
          return;
        }

        console.info(
          `[DeploymentChecker] Stale bundle detected (running=${CLIENT_DEPLOYMENT_ID}, server=${deploymentId}, reason=${reason}). Reloading…`
        );
        reloadingRef.current = true;
        await forceAppRefresh();
      }
    } catch {
      // Network error – don't reload, silently skip
    }
  };

  // Mount + visibility + periodic interval
  useEffect(() => {
    void checkVersion('mount');

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkVersion('visibility');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Periodic check — catches idle open tabs that never get a focus/nav event
    const intervalId = setInterval(() => {
      void checkVersion('interval');
    }, PERIODIC_CHECK_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(intervalId);
    };
  }, []);

  // Route-change check (client-side navigation)
  useEffect(() => {
    void checkVersion('navigation');
  }, [pathname]);

  return null;
}
