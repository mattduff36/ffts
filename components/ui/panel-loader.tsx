'use client';

import { PageLoadingScreen, type LoaderAccent } from '@/components/ui/page-loading-screen';

interface PanelLoaderProps {
  message?: string;
  accent?: LoaderAccent;
  className?: string;
}

export function PanelLoader({
  message = 'Loading...',
  accent,
  className,
}: PanelLoaderProps) {
  return (
    <PageLoadingScreen
      variant="compact"
      message={message}
      accent={accent}
      className={className}
    />
  );
}
