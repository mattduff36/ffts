'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { getAccentFromRoute, type AccentType } from '@/lib/theme/getAccentFromRoute';
import styles from './page-loading-screen.module.css';

export type LoaderAccent =
  | 'brand'
  | 'timesheet'
  | 'timesheets'
  | 'inspection'
  | 'inspections'
  | 'plant-inspection'
  | 'plant-inspections'
  | 'hgv-inspection'
  | 'hgv-inspections'
  | 'rams'
  | 'absence'
  | 'maintenance'
  | 'fleet'
  | 'workshop'
  | 'inventory'
  | 'reminders'
  | 'scheduling'
  | 'reports'
  | 'debug';

type LoaderVariant = 'fullscreen' | 'compact';

interface PageLoadingScreenProps {
  message?: string;
  accent?: LoaderAccent;
  className?: string;
  variant?: LoaderVariant;
}

const ROUTE_ACCENT_TO_LOADER_ACCENT: Record<AccentType, LoaderAccent> = {
  timesheets: 'timesheet',
  inspections: 'inspection',
  'plant-inspections': 'plant-inspection',
  'hgv-inspections': 'hgv-inspection',
  rams: 'rams',
  absence: 'absence',
  maintenance: 'maintenance',
  fleet: 'fleet',
  workshop: 'workshop',
  inventory: 'inventory',
  reminders: 'reminders',
  scheduling: 'scheduling',
  reports: 'reports',
  debug: 'debug',
  brand: 'brand',
};

function isModuleAccent(accent: LoaderAccent): boolean {
  return accent !== 'brand';
}

export function PageLoadingScreen({
  message = 'Loading...',
  accent,
  className,
  variant = 'fullscreen',
}: PageLoadingScreenProps) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeAccent = pathname ? getAccentFromRoute(pathname, searchParams) : 'brand';
  const loaderAccent = accent ?? ROUTE_ACCENT_TO_LOADER_ACCENT[routeAccent] ?? 'brand';
  const palette = isModuleAccent(loaderAccent) ? 'module' : 'multicolor';
  const shouldPortal = variant === 'fullscreen';

  useEffect(() => {
    if (!shouldPortal) return;

    const frame = window.requestAnimationFrame(() => {
      setPortalRoot(document.body);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [shouldPortal]);

  const screen = (
    <div
      className={cn(variant === 'fullscreen' ? styles.screen : styles.compact, className)}
      data-loader-accent={loaderAccent}
      data-loader-palette={palette}
      data-testid="page-loader"
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className={variant === 'fullscreen' ? styles.content : styles.compactContent}>
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressBar} />
        </div>
        <p className={styles.label}>{message}</p>
      </div>
    </div>
  );

  if (!shouldPortal) {
    return screen;
  }

  return portalRoot ? createPortal(screen, portalRoot) : screen;
}
