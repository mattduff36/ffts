import Link from 'next/link';
import { getPublicReleaseVersionLabel } from '@/lib/config/release-version';
import { cn } from '@/lib/utils/cn';

interface ReleaseVersionLinkProps {
  className?: string;
}

export function ReleaseVersionLink({ className }: ReleaseVersionLinkProps) {
  return (
    <Link
      href="/help/version-history"
      aria-label="Open version history"
      className={cn(
        'text-xs text-muted-foreground underline-offset-4 tabular-nums transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      {getPublicReleaseVersionLabel()}
    </Link>
  );
}
