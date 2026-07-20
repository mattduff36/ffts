'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { MessageBlockingCheck } from '@/components/messages/MessageBlockingCheck';
import { MobileNavBar } from '@/components/layout/MobileNavBar';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAccentFromRoute } from '@/lib/theme/getAccentFromRoute';
import { TabletModeProvider, useTabletMode } from '@/components/layout/tablet-mode-context';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClientServiceOutage } from '@/lib/hooks/useClientServiceOutage';
import { fetchWithAuth } from '@/lib/utils/fetch-with-auth';
import { trackUsageEvent } from '@/lib/analytics/client';
import { templateConfig } from '@/lib/config/template-config';
import {
  MOBILE_TEXT_SIZE_CHANGED_EVENT,
  applyMobileTextSizePreference,
  readMobileTextSizePreference,
} from '@/lib/config/mobile-text-size-preference';

const PAGE_VISIT_DEBOUNCE_MS = 250;
const PAGE_VISIT_HEARTBEAT_MS = 5 * 60_000;
const PAGE_VISIT_RESUME_MIN_GAP_MS = 60_000;
const PAGE_VISIT_HEARTBEAT_OWNER_STORAGE_KEY = 'dashboard_page_visit_heartbeat_owner';
const PAGE_VISIT_HEARTBEAT_OWNER_TTL_MS = PAGE_VISIT_HEARTBEAT_MS + 30_000;

interface HeartbeatOwnerRecord {
  tabId: string;
  expiresAt: number;
}

function createPageVisitTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readHeartbeatOwner(): HeartbeatOwnerRecord | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(PAGE_VISIT_HEARTBEAT_OWNER_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<HeartbeatOwnerRecord>;
    if (typeof parsed.tabId !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return {
      tabId: parsed.tabId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function DashboardLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TabletModeProvider>
      <DashboardLayoutShell>{children}</DashboardLayoutShell>
    </TabletModeProvider>
  );
}

function DashboardLayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile, loading: authLoading } = useAuth();
  const clientServiceOutage = useClientServiceOutage();
  const { tabletModeEnabled, tabletModeInfoOpen, dismissTabletModeInfo } = useTabletMode();
  const lastTrackedPathRef = useRef<string>('');
  const lastPageVisitRef = useRef<{ path: string; trackedAt: number }>({ path: '', trackedAt: 0 });
  const heartbeatIntervalRef = useRef<number | null>(null);
  const heartbeatOwnerTabIdRef = useRef<string>(createPageVisitTabId());
  const sessionStartedRef = useRef(false);
  const showLoadingOnly = authLoading || !profile?.id;
  
  const getCurrentTrackedPath = useCallback(() => {
    if (!pathname) return '';
    const query = searchParams?.toString() || '';
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const trackPageVisit = useCallback((path: string, minimumGapMs = 0) => {
    if (!path || authLoading || clientServiceOutage || !profile?.id) return;

    const now = Date.now();
    const lastVisit = lastPageVisitRef.current;
    if (lastVisit.path === path && now - lastVisit.trackedAt < minimumGapMs) {
      return;
    }

    lastPageVisitRef.current = {
      path,
      trackedAt: now,
    };

    fetchWithAuth('/api/me/page-visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {
      // Avoid noisy console logs for non-critical tracking telemetry.
    });
  }, [authLoading, clientServiceOutage, profile?.id]);

  const stopHeartbeat = useCallback(() => {
    if (!heartbeatIntervalRef.current) return;
    window.clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = null;
  }, []);

  const releaseHeartbeatOwnership = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const owner = readHeartbeatOwner();
    if (owner?.tabId !== heartbeatOwnerTabIdRef.current) {
      return;
    }

    window.localStorage.removeItem(PAGE_VISIT_HEARTBEAT_OWNER_STORAGE_KEY);
  }, []);

  const claimHeartbeatOwnership = useCallback(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    const now = Date.now();
    const owner = readHeartbeatOwner();
    if (owner && owner.tabId !== heartbeatOwnerTabIdRef.current && owner.expiresAt > now) {
      return false;
    }

    const nextOwner: HeartbeatOwnerRecord = {
      tabId: heartbeatOwnerTabIdRef.current,
      expiresAt: now + PAGE_VISIT_HEARTBEAT_OWNER_TTL_MS,
    };
    window.localStorage.setItem(PAGE_VISIT_HEARTBEAT_OWNER_STORAGE_KEY, JSON.stringify(nextOwner));
    return true;
  }, []);

  const sendHeartbeat = useCallback(() => {
    if (document.hidden || authLoading || clientServiceOutage || !profile?.id) return;
    const currentPath = getCurrentTrackedPath();
    if (!currentPath) return;
    trackPageVisit(currentPath, PAGE_VISIT_RESUME_MIN_GAP_MS);
    trackUsageEvent({
      eventName: 'session_heartbeat',
      path: currentPath,
      metadata: {
        source: 'dashboard_layout',
      },
    });
  }, [authLoading, clientServiceOutage, getCurrentTrackedPath, profile?.id, trackPageVisit]);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    if (document.hidden || clientServiceOutage || !claimHeartbeatOwnership()) return;

    heartbeatIntervalRef.current = window.setInterval(() => {
      if (document.hidden || clientServiceOutage || !claimHeartbeatOwnership()) {
        stopHeartbeat();
        return;
      }

      sendHeartbeat();
    }, PAGE_VISIT_HEARTBEAT_MS);
  }, [claimHeartbeatOwnership, clientServiceOutage, sendHeartbeat, stopHeartbeat]);
  
  // Determine the accent color based on current route
  const accent = getAccentFromRoute(pathname, searchParams);

  useEffect(() => {
    if (authLoading || clientServiceOutage || !profile?.id || sessionStartedRef.current) return;
    const currentPath = getCurrentTrackedPath();
    if (!currentPath) return;

    sessionStartedRef.current = true;
    trackUsageEvent({
      eventName: 'session_started',
      path: currentPath,
      referrerPath: typeof document !== 'undefined' ? document.referrer || null : null,
      metadata: {
        source: 'dashboard_layout',
      },
    });
  }, [authLoading, clientServiceOutage, getCurrentTrackedPath, profile?.id]);

  useEffect(() => {
    const nextPath = getCurrentTrackedPath();
    if (!nextPath) return;
    if (lastTrackedPathRef.current === nextPath) return;
    const previousPath = lastTrackedPathRef.current;
    lastTrackedPathRef.current = nextPath;

    const timer = window.setTimeout(() => {
      trackPageVisit(nextPath);
      if (previousPath) {
        trackUsageEvent({
          eventName: 'route_changed',
          path: nextPath,
          referrerPath: previousPath,
          metadata: {
            source: 'dashboard_layout',
          },
        });
      }
      trackUsageEvent({
        eventName: 'page_view',
        path: nextPath,
        referrerPath: previousPath || (typeof document !== 'undefined' ? document.referrer || null : null),
        metadata: {
          source: 'dashboard_layout',
        },
      });
    }, PAGE_VISIT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [getCurrentTrackedPath, trackPageVisit]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopHeartbeat();
        releaseHeartbeatOwnership();
        return;
      }

      trackUsageEvent({
        eventName: 'visibility_resume',
        path: getCurrentTrackedPath(),
        metadata: {
          source: 'dashboard_layout',
        },
      });
      sendHeartbeat();
      startHeartbeat();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PAGE_VISIT_HEARTBEAT_OWNER_STORAGE_KEY || document.hidden) {
        return;
      }

      if (!heartbeatIntervalRef.current) {
        startHeartbeat();
      }
    };

    startHeartbeat();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorage);
      stopHeartbeat();
      releaseHeartbeatOwnership();
    };
  }, [getCurrentTrackedPath, releaseHeartbeatOwnership, sendHeartbeat, startHeartbeat, stopHeartbeat]);

  useEffect(() => {
    const syncMobileTextSizePreference = () => {
      applyMobileTextSizePreference(readMobileTextSizePreference());
    };

    syncMobileTextSizePreference();
    window.addEventListener('storage', syncMobileTextSizePreference);
    window.addEventListener(MOBILE_TEXT_SIZE_CHANGED_EVENT, syncMobileTextSizePreference);

    return () => {
      window.removeEventListener('storage', syncMobileTextSizePreference);
      window.removeEventListener(MOBILE_TEXT_SIZE_CHANGED_EVENT, syncMobileTextSizePreference);
      document.documentElement.removeAttribute('data-mobile-text-size');
    };
  }, []);

  if (showLoadingOnly) {
    return <PageLoader message={`Loading ${templateConfig.branding.shortAppName}`} />;
  }

  return (
    <div 
      className="min-h-dvh bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 relative"
      data-accent={accent}
      data-tablet-mode={tabletModeEnabled ? 'on' : undefined}
    >
      {/* Plain gradient background - no grid pattern */}
      
      {/* Blocking Message Check (Password Change → Toolbox Talks → Reminders) */}
      <MessageBlockingCheck />
      
      <Navbar />
      <PullToRefresh />
      <DashboardContent isFullWidth={pathname === '/scheduling'}>
        {children}
      </DashboardContent>
      
      {/* Mobile Navigation Bar - Bottom of screen on mobile only */}
      <MobileNavBar />

      <Dialog open={tabletModeInfoOpen} onOpenChange={(open) => !open && dismissTabletModeInfo()}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto border-border text-white p-7 sm:p-8 gap-5">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-xl">Information</DialogTitle>
            <DialogDescription className="text-base leading-relaxed">
              Tablet mode is still under development. You might notice incomplete layouts or interactions while
              we continue improving it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2 sm:justify-center">
            <Button
              type="button"
              onClick={dismissTabletModeInfo}
              className="w-full sm:w-auto min-h-12 text-base px-10 font-semibold bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

