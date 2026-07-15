'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { fetchSchedulingContext } from '@/lib/client/scheduling';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { SchedulingManagerBoard } from './components/SchedulingManagerBoard';

export default function SchedulingPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('scheduling');
  const contextQuery = useQuery({
    queryKey: ['scheduling-context'],
    queryFn: fetchSchedulingContext,
    enabled: !permissionLoading && hasPermission,
  });

  if (permissionLoading || contextQuery.isLoading) {
    return <PageLoader message="Loading scheduling..." />;
  }
  if (!hasPermission) return null;

  return (
    <AppPageShell width="full">
      <AppPageHeader
        title="Job Scheduling"
        description="Plan work across the week and allocate employees and plant with clear availability warnings."
        icon={<CalendarDays className="h-5 w-5" />}
      />
      {contextQuery.data?.is_manager_or_admin ? (
        <SchedulingManagerBoard />
      ) : (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <CalendarDays className="h-10 w-10 text-scheduling" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Your schedule is ready</h2>
              <p className="text-sm text-muted-foreground">
                The management board is restricted to managers and administrators.
              </p>
            </div>
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/scheduling/my">View my schedule</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </AppPageShell>
  );
}
