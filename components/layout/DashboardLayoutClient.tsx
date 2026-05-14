'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { MessageBlockingCheck } from '@/components/messages/MessageBlockingCheck';
import { MobileNavBar } from '@/components/layout/MobileNavBar';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAccentFromRoute } from '@/lib/theme/getAccentFromRoute';
import { TabletModeProvider, useTabletMode } from '@/components/layout/tablet-mode-context';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClientServiceOutage } from '@/lib/hooks/useClientServiceOutage';
import { fetchWithAuth } from '@/lib/utils/fetch-with-auth';

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
  const { profile, loading: authLoading, locked } = useAuth();
  const clientServiceOutage = useClientServiceOutage();
  const { tabletModeEnabled, tabletModeInfoOpen, dismissTabletModeInfo } = useTabletMode();
  const lastTrackedPathRef = useRef<string>('');
  const lastPageVisitRef = useRef<{ path: string; trackedAt: number }>({ path: '', trackedAt: 0 });
  const heartbeatIntervalRef = useRef<number | null>(null);
  const heartbeatOwnerTabIdRef = useRef<string>(createPageVisitTabId());
  
  const getCurrentTrackedPath = useCallback(() => {
    if (!pathname) return '';
    const query = searchParams?.toString() || '';
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const trackPageVisit = useCallback((path: string, minimumGapMs = 0) => {
    if (!path || authLoading || locked || clientServiceOutage || !profile?.id) return;

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
  }, [authLoading, clientServiceOutage, locked, profile?.id]);

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
    if (document.hidden || authLoading || locked || clientServiceOutage || !profile?.id) return;
    const currentPath = getCurrentTrackedPath();
    if (!currentPath) return;
    trackPageVisit(currentPath, PAGE_VISIT_RESUME_MIN_GAP_MS);
  }, [authLoading, clientServiceOutage, getCurrentTrackedPath, locked, profile?.id, trackPageVisit]);

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
    const nextPath = getCurrentTrackedPath();
    if (!nextPath) return;
    if (lastTrackedPathRef.current === nextPath) return;
    lastTrackedPathRef.current = nextPath;

    const timer = window.setTimeout(() => {
      trackPageVisit(nextPath);
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
  }, [releaseHeartbeatOwnership, sendHeartbeat, startHeartbeat, stopHeartbeat]);

  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 relative"
      data-accent={accent}
      data-tablet-mode={tabletModeEnabled ? 'on' : undefined}
    >
      {/* Plain gradient background - no grid pattern */}
      
      {/* Blocking Message Check (Password Change → Toolbox Talks → Reminders) */}
      <MessageBlockingCheck />
      
      <Navbar />
      <PullToRefresh />
      <DashboardContent>
        {children}
      </DashboardContent>
      
      {/* Mobile Navigation Bar - Bottom of screen on mobile only */}
      <MobileNavBar />

      <Dialog open={tabletModeInfoOpen} onOpenChange={(open) => !open && dismissTabletModeInfo()}>
        <DialogContent className="max-w-lg border-border text-white p-7 sm:p-8 gap-5">
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

