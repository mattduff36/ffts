'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, RefreshCw } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import { fetchSchedulingContext } from '@/lib/client/scheduling';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { SchedulingManagerBoard } from './components/SchedulingManagerBoard';

export default function SchedulingPage() {
  const {
    hasPermission,
    loading: permissionLoading,
    serviceUnavailable: permissionServiceUnavailable,
  } = usePermissionCheck('scheduling', false);
  const contextQuery = useQuery({
    queryKey: ['scheduling-context'],
    queryFn: fetchSchedulingContext,
    enabled: !permissionLoading && hasPermission,
  });

  if (permissionLoading || contextQuery.isLoading) {
    return <PageLoader message="Loading scheduling..." />;
  }
  if (!hasPermission) {
    return (
      <AppPageShell width="full">
        <AppPageHeader
          title="Job Scheduling"
          description="Plan work across the week and allocate employees and plant."
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <Card className="border-amber-500/30">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {permissionServiceUnavailable
                  ? 'Scheduling permissions are temporarily unavailable'
                  : 'Scheduling is not enabled for your account'}
              </h2>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                {permissionServiceUnavailable
                  ? 'Reload the page to try the permission check again.'
                  : 'Ask an administrator to review your team and individual scheduling permissions.'}
              </p>
            </div>
            {permissionServiceUnavailable ? (
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/dashboard">Return to dashboard</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </AppPageShell>
    );
  }
  if (contextQuery.isError) {
    return (
      <AppPageShell width="full">
        <AppPageHeader
          title="Job Scheduling"
          description="Plan work across the week and allocate employees and plant."
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <Card className="border-amber-500/30">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Scheduling access could not be checked</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {contextQuery.error instanceof Error
                  ? contextQuery.error.message
                  : 'The scheduling service is temporarily unavailable.'}
              </p>
            </div>
            <Button variant="outline" onClick={() => void contextQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="full">
      <AppPageHeader
        title="Job Scheduling"
        description="Plan work across the week and allocate employees and plant with clear availability warnings."
        icon={<CalendarDays className="h-5 w-5" />}
      />
      {contextQuery.data?.is_manager_or_admin ? (
        <NuqsClientAdapter>
          <SchedulingManagerBoard userId={contextQuery.data.user_id} />
        </NuqsClientAdapter>
      ) : (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            {contextQuery.data?.role_class === 'manager' || contextQuery.data?.role_class === 'admin' ? (
              <AlertTriangle className="h-10 w-10 text-amber-400" />
            ) : (
              <CalendarDays className="h-10 w-10 text-scheduling" />
            )}
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {contextQuery.data?.role_class === 'manager' || contextQuery.data?.role_class === 'admin'
                  ? 'Management access is not enabled'
                  : 'Your schedule is ready'}
              </h2>
              {contextQuery.data?.role_class === 'manager' || contextQuery.data?.role_class === 'admin' ? (
                <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                  The management board requires Level 4 scheduling access. Ask an administrator to review your team or individual scheduling permission.
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  The management board is restricted to users with manager-level scheduling access.
                </p>
              )}
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
