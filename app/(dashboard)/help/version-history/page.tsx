import Link from 'next/link';
import { ArrowLeft, History } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import releaseHistoryJson from '@/lib/config/release-history.json';
import {
  getRecentReleaseHistoryMonths,
  type ReleaseHistoryEntry,
} from '@/lib/config/release-version-logic';
import { getPublicReleaseVersionLabel } from '@/lib/config/release-version';
import { VersionHistoryTabs } from './components/VersionHistoryTabs';

const releaseHistory = releaseHistoryJson as ReleaseHistoryEntry[];

export default function HelpVersionHistoryPage() {
  const months = getRecentReleaseHistoryMonths(releaseHistory);
  const latestMonth = months[0]?.key ?? '';

  return (
    <AppPageShell>
      <AppPageHeader
        title="Version History"
        description="See the main app updates in plain English, including when each update was pushed."
        icon={<History className="h-5 w-5" />}
        actions={(
          <>
          <Button asChild variant="outline" size="sm">
            <Link href="/help">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Help
            </Link>
          </Button>
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-sm tabular-nums text-amber-700 dark:text-amber-200">
            {getPublicReleaseVersionLabel()}
          </Badge>
          </>
        )}
      />

      <VersionHistoryTabs months={months} initialMonthKey={latestMonth} />
    </AppPageShell>
  );
}
