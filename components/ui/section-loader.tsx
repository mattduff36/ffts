'use client';

import { PanelLoader } from '@/components/ui/panel-loader';
import { cn } from '@/lib/utils/cn';
import type { LoaderAccent } from '@/components/ui/page-loading-screen';

interface SectionLoaderProps {
  message?: string;
  className?: string;
  iconClassName?: string;
  accent?: LoaderAccent;
}

export function SectionLoader({
  message = 'Loading...',
  className,
  accent,
}: SectionLoaderProps) {
  return <PanelLoader message={message} accent={accent} className={cn('border border-border py-12', className)} />;
}
