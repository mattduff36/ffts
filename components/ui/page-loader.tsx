'use client';

import { PageLoadingScreen, type LoaderAccent } from '@/components/ui/page-loading-screen';

interface PageLoaderProps {
  message?: string;
  accent?: LoaderAccent;
}

export function PageLoader({ message = 'Loading...', accent }: PageLoaderProps) {
  return <PageLoadingScreen message={message} accent={accent} />;
}

