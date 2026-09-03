'use client';

import Link from 'next/link';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, RefreshCw } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import { fetchSchedulingContext } from '@/lib/client/scheduling';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { cn } from '@/lib/utils/cn';
import { SchedulingManagerBoard } from './components/SchedulingManagerBoard';
import { schedulingControlStyles } from './components/scheduling-control-styles';
import {
  getRemainingViewportHeight,
  getSchedulingViewportFit,
  measureSchedulingMinContentWidth,
  readMainBottomInset,
  SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
  SCHEDULING_MOBILE_MAX_WIDTH_PX,
} from './components/scheduling-viewport-fit';

function SchedulingWiderScreenMessage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="schedule-wide-screen-layout">
      <AppPageHeader
        title="Job Scheduling"
        description="Plan work across the week and allocate employees and plant with clear availability warnings."
        icon={<CalendarDays className="h-5 w-5" />}
        className="shrink-0"
      />
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <Card className="w-fit max-w-md border-amber-500/30" data-testid="schedule-wide-screen-required">
          <CardContent className="flex w-fit flex-col items-center gap-4 px-6 py-8 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Job Scheduling needs a wider screen
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This page is built for a desktop-width browser. Open it on a larger display, or widen this window, to use the job board.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SchedulingManagerViewport({
  userId,
}: {
  userId: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(0);
  const [minContentWidth, setMinContentWidth] = useState(SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX);
  const [isMobile, setIsMobile] = useState(false);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof window === 'undefined') return;

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(`(max-width: ${SCHEDULING_MOBILE_MAX_WIDTH_PX}px)`)
        : null;
    const syncViewport = () => {
      setIsMobile(Boolean(media?.matches));
      setAvailableWidth(viewport.clientWidth);
      setAvailableHeight(
        getRemainingViewportHeight({
          top: viewport.getBoundingClientRect().top,
          viewportHeight: window.innerHeight,
          bottomInset: readMainBottomInset(viewport),
        })
      );
      const content = contentRef.current;
      if (content) {
        setMinContentWidth(measureSchedulingMinContentWidth(content));
      }
      setReady(true);
    };

    syncViewport();
    media?.addEventListener('change', syncViewport);
    window.addEventListener('resize', syncViewport);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncViewport);
    observer?.observe(viewport);

    return () => {
      media?.removeEventListener('change', syncViewport);
      window.removeEventListener('resize', syncViewport);
      observer?.disconnect();
    };
  }, []);

  const fit = useMemo(
    () =>
      getSchedulingViewportFit({
        availableWidth,
        minContentWidth,
        isMobile,
      }),
    [availableWidth, isMobile, minContentWidth]
  );

  useLayoutEffect(() => {
    if (!ready || fit.mode === 'blocked') return;
    const content = contentRef.current;
    if (!content) return;
    const syncMinWidth = () => {
      setMinContentWidth(measureSchedulingMinContentWidth(content));
    };
    syncMinWidth();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncMinWidth);
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [fit.mode, ready]);

  const canvasHeight = availableHeight > 0
    ? (fit.mode === 'scaled' ? availableHeight / fit.scale : availableHeight)
    : undefined;
  const scaledStyle: CSSProperties = {
    height: canvasHeight,
    ...(ready && fit.mode === 'scaled'
      ? {
          width: minContentWidth,
          transform: `scale(${fit.scale})`,
          transformOrigin: 'top left',
        }
      : {}),
  };

  return (
    <div
      ref={viewportRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="scheduling-viewport"
      data-fit-mode={ready ? fit.mode : 'pending'}
      style={availableHeight > 0 ? { height: availableHeight } : undefined}
    >
      {!ready ? (
        <PageLoader message="Loading scheduling..." />
      ) : fit.mode === 'blocked' ? (
        <SchedulingWiderScreenMessage />
      ) : (
        <div
          ref={contentRef}
          className="flex min-h-0 flex-1 flex-col [&>*]:flex [&>*]:h-full [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex-col"
          data-testid="scheduling-scaled-content"
          style={scaledStyle}
        >
          <SchedulingManagerBoard userId={userId} />
        </div>
      )}
    </div>
  );
}

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
              <Button variant="outline" className={schedulingControlStyles.outline} onClick={() => window.location.reload()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload
              </Button>
            ) : (
              <Button asChild variant="outline" className={schedulingControlStyles.outline}>
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
            <Button
              variant="outline"
              className={schedulingControlStyles.outline}
              onClick={() => void contextQuery.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      </AppPageShell>
    );
  }

  const isManagerBoard = Boolean(contextQuery.data?.is_manager_or_admin);

  return (
    <AppPageShell
      width="full"
      className={cn(
        isManagerBoard
          && 'flex h-[calc(100dvh-var(--top-nav-h,68px)-4rem)] min-h-0 flex-col overflow-hidden space-y-0'
      )}
      data-testid="scheduling-page-shell"
    >
      {isManagerBoard ? (
        <div className="flex h-full min-h-0 flex-1 flex-col">
          <NuqsClientAdapter>
            <div className="flex h-full min-h-0 flex-1 flex-col">
              <SchedulingManagerViewport userId={contextQuery.data!.user_id} />
            </div>
          </NuqsClientAdapter>
        </div>
      ) : (
        <>
          <AppPageHeader
            title="Job Scheduling"
            description="Plan work across the week and allocate employees and plant with clear availability warnings."
            icon={<CalendarDays className="h-5 w-5" />}
            className="shrink-0"
          />
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
              <Button asChild className={schedulingControlStyles.primary}>
                <Link href="/scheduling/my">View my schedule</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </AppPageShell>
  );
}
