'use client';

import { Loader2 } from 'lucide-react';

interface PageLoaderProps {
  message?: string;
}

export function PageLoader({ message = 'Loading...' }: PageLoaderProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]" data-testid="page-loader" role="status" aria-live="polite">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-brand-yellow" />
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

