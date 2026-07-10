'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  clearDatabaseOutageEmulation,
  nudgeDatabaseHealthCheck,
  reportDatabaseHealthActivity,
  runDatabaseHealthProbe,
  startDatabaseHealthMonitor,
} from '@/lib/database/client-health';
import { useDatabaseHealthOutage } from '@/lib/hooks/useDatabaseHealthOutage';
import { Button } from '@/components/ui/button';

export function DatabaseOutageBlocker() {
  const state = useDatabaseHealthOutage();
  const pathname = usePathname();
  const blockerRef = useRef<HTMLDivElement | null>(null);
  const isDebugEmulationPage = state.emulatedOutageActive && pathname.startsWith('/debug');

  useEffect(() => startDatabaseHealthMonitor(), []);

  useEffect(() => {
    reportDatabaseHealthActivity();
    void runDatabaseHealthProbe('route');
  }, [pathname]);

  useEffect(() => {
    if (!state.outageActive || isDebugEmulationPage) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    blockerRef.current?.focus();

    const keepFocusOnBlocker = (event: FocusEvent) => {
      const blocker = blockerRef.current;
      if (!blocker || blocker.contains(event.target as Node | null)) {
        return;
      }

      event.preventDefault();
      blocker.focus();
    };

    const blockKeyboardNavigation = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      const blocker = blockerRef.current;
      if (state.emulatedOutageActive && blocker?.contains(event.target as Node | null)) {
        return;
      }

      event.preventDefault();
      blockerRef.current?.focus();
    };

    document.addEventListener('focusin', keepFocusOnBlocker, true);
    document.addEventListener('keydown', blockKeyboardNavigation, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('focusin', keepFocusOnBlocker, true);
      document.removeEventListener('keydown', blockKeyboardNavigation, true);
    };
  }, [isDebugEmulationPage, state.emulatedOutageActive, state.outageActive]);

  useEffect(() => {
    if (!state.outageActive) {
      return undefined;
    }

    const interval = setInterval(() => {
      nudgeDatabaseHealthCheck();
    }, 15_000);

    return () => clearInterval(interval);
  }, [state.outageActive]);

  if (!state.outageActive) {
    return null;
  }

  const shouldBlockPageInteraction = !isDebugEmulationPage;

  return (
    <div
      ref={blockerRef}
      className={`fixed inset-0 z-[190] bg-slate-950/55 backdrop-blur-[2px] ${shouldBlockPageInteraction ? '' : 'pointer-events-none'}`}
      data-testid="database-outage-blocker"
      tabIndex={0}
      onPointerDown={shouldBlockPageInteraction ? (event) => event.preventDefault() : undefined}
      onTouchStart={shouldBlockPageInteraction ? (event) => event.preventDefault() : undefined}
      onClick={shouldBlockPageInteraction ? (event) => event.preventDefault() : undefined}
    >
      <div
        role="alert"
        aria-live="polite"
        className="pointer-events-auto fixed left-1/2 top-[76px] z-[191] w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-red-300/60 bg-red-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-2xl shadow-red-950/30 sm:px-6 sm:text-base"
      >
        <div>Database connection issue. We&rsquo;re retrying automatically; the app will unlock when service is restored.</div>
        {state.emulatedOutageActive ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 border-white/60 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              clearDatabaseOutageEmulation();
            }}
          >
            End emulation
          </Button>
        ) : null}
      </div>
    </div>
  );
}
