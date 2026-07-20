'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useEffect, useState } from 'react';
import {
  APP_WIDESCREEN_CHANGED_EVENT,
  readAppWidescreenPreference,
} from '@/lib/config/layout-preferences';

interface DashboardContentProps {
  children: React.ReactNode;
  isFullWidth?: boolean;
}

export function DashboardContent({ children, isFullWidth = false }: DashboardContentProps) {
  const { isManager, isActualSuperAdmin } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const [appWidescreenEnabled, setAppWidescreenEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPreference = () => {
      setAppWidescreenEnabled(readAppWidescreenPreference());
    };

    syncPreference();
    window.addEventListener('storage', syncPreference);
    window.addEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);

    return () => {
      window.removeEventListener('storage', syncPreference);
      window.removeEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('app-widescreen-enabled', appWidescreenEnabled);
    return () => document.body.classList.remove('app-widescreen-enabled');
  }, [appWidescreenEnabled]);

  const shouldApplySidebarOffset = !tabletModeEnabled && (isManager || isActualSuperAdmin);
  const contentWidthClassName = appWidescreenEnabled
    ? 'max-w-none mx-0'
    : isFullWidth
      ? 'max-w-none mx-0 px-4 sm:px-6 lg:px-8'
      : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8';

  return (
    <div className={`transition-all duration-300 ${shouldApplySidebarOffset ? 'md:pl-16' : ''}`}>
      <main
        className={`app-content relative pt-[calc(68px+2rem)] pb-8 md:py-8 ${contentWidthClassName}`}
        style={
          appWidescreenEnabled
            ? {
                paddingLeft: shouldApplySidebarOffset ? '64px' : '65px',
                paddingRight: '65px',
              }
            : undefined
        }
      >
        {children}
      </main>
    </div>
  );
}

