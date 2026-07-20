'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SectionLoader } from '@/components/ui/section-loader';
import { PageLoader } from '@/components/ui/page-loader';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { MobileTextSizeDialog } from '@/components/layout/MobileTextSizeDialog';
import { ReleaseVersionLink } from '@/components/layout/ReleaseVersionLink';
import { templateConfig } from '@/lib/config/template-config';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Bug,
  FileText,
  Calendar,
  LockKeyhole,
  Loader2
} from 'lucide-react';
import { getEnabledForms, getEnabledFormsForNavigation } from '@/lib/config/forms';
import type { ModuleName } from '@/types/roles';
import {
  managerNavItems,
  adminNavItems,
  getFilteredEmployeeNav,
  getFilteredNavByPermissions,
} from '@/lib/config/navigation';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { useRamsAssignmentSummary } from '@/lib/hooks/useNavMetrics';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError, createStatusError } from '@/lib/utils/http-error';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';

type PendingApprovalCount = {
  type: 'timesheets' | 'absences';
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  href: string;
};

const sensitivePinIndicatorClass = [
  'absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full',
  'border border-slate-500/20 bg-slate-700/10 text-slate-500/60 opacity-45 shadow-none ring-0',
  'transition-all duration-200',
  'group-hover:border-amber-300/40 group-hover:bg-amber-400/15 group-hover:text-amber-200 group-hover:opacity-100 group-hover:shadow-sm group-hover:ring-1 group-hover:ring-slate-950/40',
  'group-focus-visible:border-amber-300/40 group-focus-visible:bg-amber-400/15 group-focus-visible:text-amber-200 group-focus-visible:opacity-100 group-focus-visible:shadow-sm group-focus-visible:ring-1 group-focus-visible:ring-slate-950/40',
].join(' ');

// Debug is a hidden sensitive module and is not exposed through permission metadata.
const sensitivePinDashboardHrefOverrides: ReadonlySet<string> = new Set(['/debug']);

/**
 * Safely applies alpha/opacity to an HSL color string.
 * Returns the color with 15% opacity if valid HSL, otherwise returns a fallback.
 *
 * @param color - Color string (expected to be in HSL format like 'hsl(13 37% 48%)')
 * @returns HSL color with alpha channel or fallback color
 */
function applyAlphaToHSL(color: string): string {
  // Validate that the color is in HSL format
  if (typeof color === 'string' && color.trim().startsWith('hsl(') && color.includes(')')) {
    return color.replace(')', ' / 0.15)');
  }

  // Fallback: return semi-transparent slate if invalid format
  console.warn(`Invalid HSL color format: "${color}". Using fallback color.`);
  return 'hsl(215 16% 47% / 0.15)'; // slate-600 with 15% opacity
}

function getInitials(fullName: string | null | undefined): string {
  const normalized = (fullName || '').trim();
  if (!normalized) return 'U';
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

export default function DashboardPage() {
  const {
    profile,
    isManager,
    isAdmin,
    isActualSuperAdmin,
    isViewingAs,
    effectiveRole,
    loading: authLoading,
    recoverFromAuthFailure,
    forceAuthRedirect,
  } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const formTypes = getEnabledForms();
  const recoveryAttemptedRef = useRef(false);
  const dashboardGreetingRef = useRef<HTMLHeadingElement | null>(null);
  const dashboardFullGreetingMeasureRef = useRef<HTMLSpanElement | null>(null);

  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSuggestionsCount, setNewSuggestionsCount] = useState(0);
  const [newErrorReportsCount, setNewErrorReportsCount] = useState(0);
  const [pendingQuotesCount, setPendingQuotesCount] = useState(0);
  const [errorLogsCount, setErrorLogsCount] = useState(0);
  const [approvalsTileBadgeCount, setApprovalsTileBadgeCount] = useState(0);
  const [workshopPendingCount, setWorkshopPendingCount] = useState(0);
  const [maintenanceDueSoonCount, setMaintenanceDueSoonCount] = useState(0);
  const [maintenanceOverdueCount, setMaintenanceOverdueCount] = useState(0);
  const [remindersPendingCount, setRemindersPendingCount] = useState(0);
  const [actionsUnassignedCount, setActionsUnassignedCount] = useState(0);
  const [badgesLoading, setBadgesLoading] = useState(true);
  const [metricsErrorStatus, setMetricsErrorStatus] = useState<number | null>(null);
  const [showCompactGreeting, setShowCompactGreeting] = useState(false);
  const {
    enabledModuleSet: userPermissions,
    sensitivePinModuleSet,
    effectiveTeamName,
    isLoading: permissionsLoading,
    errorStatus: permissionsErrorStatus,
    refetch: refetchPermissions,
  } = usePermissionSnapshot();
  const {
    data: ramsSummary,
    isLoading: ramsSummaryLoading,
    errorStatus: ramsErrorStatus,
    refetch: refetchRamsAssignmentSummary,
  } = useRamsAssignmentSummary(profile?.id);
  const pendingRAMSCount = ramsSummary?.pendingCount || 0;
  const hasRAMSAssignments = ramsSummary?.hasAssignments || false;

  const [mobileTextSizeDialogOpen, setMobileTextSizeDialogOpen] = useState(false);

  // useAuth flags already reflect the effective (view-as) role
  const isSuperAdmin = isActualSuperAdmin;
  const effectiveIsManager = isManager;
  const effectiveIsAdmin = isAdmin;

  const roleLabel = effectiveRole?.display_name || (isSuperAdmin ? 'SuperAdmin' : (profile?.role?.display_name || 'No Role Assigned'));
  const dashboardTeamName = effectiveTeamName || profile?.team?.name || null;
  const headerSubtitle = dashboardTeamName ? `${dashboardTeamName} · ${roleLabel}` : roleLabel;
  const dashboardDisplayName = profile?.full_name || 'there';
  const dashboardFullGreeting = `Welcome back, ${dashboardDisplayName}`;
  const dashboardGreeting = showCompactGreeting ? dashboardDisplayName : dashboardFullGreeting;

  const canViewApprovals = userPermissions.has('approvals');
  const canAccessDebugTools = canAccessDebugConsole({
    email: profile?.email,
    isActualSuperAdmin,
    isViewingAs,
  });

  function buildPendingApprovalsSummary(timesheetsCount: number, absencesCount: number): PendingApprovalCount[] {
    return [
      {
        type: 'timesheets',
        label: 'Timesheets',
        count: timesheetsCount,
        icon: FileText,
        color: 'hsl(210 90% 50%)',
        href: '/approvals?tab=timesheets',
      },
      {
        type: 'absences',
        label: 'Absences',
        count: absencesCount,
        icon: Calendar,
        color: 'hsl(260 60% 50%)',
        href: '/approvals?tab=absences',
      },
    ];
  }

  const fetchDashboardMetrics = useCallback(async () => {
    if (!navigator.onLine) {
      return {
        pendingApprovals: canViewApprovals ? buildPendingApprovalsSummary(0, 0) : [],
        approvalsTileBadgeCount: 0,
        newSuggestionsCount: 0,
        newErrorReportsCount: 0,
        pendingQuotesCount: 0,
        errorLogsCount: 0,
        workshopPendingCount: 0,
        maintenanceDueSoonCount: 0,
        maintenanceOverdueCount: 0,
        remindersPendingCount: 0,
        actionsUnassignedCount: 0,
      };
    }
    const response = await fetch('/api/dashboard/summary', { cache: 'no-store' });
    const rawPayload = await response.text();
    const payload = rawPayload ? JSON.parse(rawPayload) as {
      error?: string;
      metrics?: {
        approvals?: { timesheets?: number; absences?: number };
        badges?: {
          approvals?: number;
          workshop_pending?: number;
          maintenance_due_soon?: number;
          maintenance_overdue?: number;
          reminders_pending?: number;
          actions_unassigned?: number;
          suggestions_new?: number;
          error_reports_new?: number;
          quotes_pending_internal_approval?: number;
          error_logs?: number;
        };
      };
    } : {};

    if (!response.ok) {
      throw createStatusError(payload.error || 'Failed to load dashboard summary', response.status);
    }

    const timesheetsCount = payload.metrics?.approvals?.timesheets || 0;
    const absencesCount = payload.metrics?.approvals?.absences || 0;
    const approvalsBadgeCount = payload.metrics?.badges?.approvals ?? (timesheetsCount + absencesCount);
    const suggestionsNewCount = payload.metrics?.badges?.suggestions_new || 0;
    const errorsNewCount = payload.metrics?.badges?.error_reports_new || 0;
    const workshopPendingCount = payload.metrics?.badges?.workshop_pending || 0;
    const maintenanceDueSoonCount = payload.metrics?.badges?.maintenance_due_soon || 0;
    const maintenanceOverdueCount = payload.metrics?.badges?.maintenance_overdue || 0;
    const remindersPendingCount = payload.metrics?.badges?.reminders_pending || 0;
    const actionsUnassignedCount = payload.metrics?.badges?.actions_unassigned || 0;

    return {
      pendingApprovals: canViewApprovals ? buildPendingApprovalsSummary(timesheetsCount, absencesCount) : [],
      approvalsTileBadgeCount: approvalsBadgeCount,
      newSuggestionsCount: suggestionsNewCount,
      newErrorReportsCount: errorsNewCount,
      pendingQuotesCount: payload.metrics?.badges?.quotes_pending_internal_approval || 0,
      errorLogsCount: payload.metrics?.badges?.error_logs || 0,
      workshopPendingCount,
      maintenanceDueSoonCount,
      maintenanceOverdueCount,
      remindersPendingCount,
      actionsUnassignedCount,
    };
  }, [canViewApprovals]);

  const applyDashboardMetrics = useCallback((metrics: Awaited<ReturnType<typeof fetchDashboardMetrics>>) => {
    setPendingApprovals(metrics.pendingApprovals);
    setApprovalsTileBadgeCount(metrics.approvalsTileBadgeCount);
    setNewSuggestionsCount(metrics.newSuggestionsCount);
    setNewErrorReportsCount(metrics.newErrorReportsCount);
    setPendingQuotesCount(metrics.pendingQuotesCount);
    setErrorLogsCount(metrics.errorLogsCount);
    setWorkshopPendingCount(metrics.workshopPendingCount);
    setMaintenanceDueSoonCount(metrics.maintenanceDueSoonCount);
    setMaintenanceOverdueCount(metrics.maintenanceOverdueCount);
    setRemindersPendingCount(metrics.remindersPendingCount);
    setActionsUnassignedCount(metrics.actionsUnassignedCount);
  }, []);

  const loadDashboardMetrics = useCallback(async (): Promise<number | null> => {
    setLoading(true);
    setBadgesLoading(true);

    try {
      const metrics = await fetchDashboardMetrics();
      applyDashboardMetrics(metrics);
      setMetricsErrorStatus(null);
      return null;
    } catch (error) {
      const errorStatus = getErrorStatus(error);
      setMetricsErrorStatus(errorStatus);
      if (!isAuthErrorStatus(errorStatus) && !isNetworkFetchError(error)) {
        console.error('Error loading dashboard metrics:', error, {
          errorContextId: 'dashboard-load-metrics-error',
        });
      }

      if (!isAuthErrorStatus(errorStatus)) {
        setPendingApprovals(canViewApprovals ? buildPendingApprovalsSummary(0, 0) : []);
        setApprovalsTileBadgeCount(0);
        setNewSuggestionsCount(0);
        setNewErrorReportsCount(0);
        setPendingQuotesCount(0);
        setErrorLogsCount(0);
        setWorkshopPendingCount(0);
        setMaintenanceDueSoonCount(0);
        setMaintenanceOverdueCount(0);
        setRemindersPendingCount(0);
        setActionsUnassignedCount(0);
      }

      return errorStatus;
    } finally {
      setLoading(false);
      setBadgesLoading(false);
    }
  }, [applyDashboardMetrics, canViewApprovals, fetchDashboardMetrics]);

  useEffect(() => {
    if (authLoading || permissionsLoading || !profile?.id) {
      return;
    }

    void loadDashboardMetrics();
  }, [authLoading, loadDashboardMetrics, permissionsLoading, profile?.id]);

  useEffect(() => {
    recoveryAttemptedRef.current = false;
  }, [profile?.id]);

  useLayoutEffect(() => {
    const heading = dashboardGreetingRef.current;
    const fullGreetingMeasure = dashboardFullGreetingMeasureRef.current;

    if (!heading || !fullGreetingMeasure) {
      return;
    }

    const updateGreetingMode = () => {
      const availableWidth = heading.clientWidth;
      const fullGreetingWidth = fullGreetingMeasure.scrollWidth;
      setShowCompactGreeting(fullGreetingWidth > availableWidth);
    };

    updateGreetingMode();

    const resizeObserver = new ResizeObserver(updateGreetingMode);
    resizeObserver.observe(heading);
    resizeObserver.observe(fullGreetingMeasure);

    return () => {
      resizeObserver.disconnect();
    };
  }, [dashboardFullGreeting]);

  useEffect(() => {
    const authFailureStatus = [metricsErrorStatus, permissionsErrorStatus, ramsErrorStatus].find((status) =>
      isAuthErrorStatus(status)
    );

    if (!authFailureStatus || recoveryAttemptedRef.current || !profile?.id) {
      return;
    }

    recoveryAttemptedRef.current = true;

    let cancelled = false;

    void (async () => {
      const recovered = await recoverFromAuthFailure({
        reason: 'dashboard-initial-load',
        statusCode: authFailureStatus,
      });

      if (!recovered || cancelled) {
        return;
      }

      const [permissionsResult, ramsResult] = await Promise.allSettled([
        refetchPermissions(),
        refetchRamsAssignmentSummary(),
      ]);

      if (cancelled) {
        return;
      }

      const permissionsRetryStatus =
        permissionsResult.status === 'fulfilled'
          ? getErrorStatus(permissionsResult.value.error)
          : getErrorStatus(permissionsResult.reason);

      const ramsRetryStatus =
        ramsResult.status === 'fulfilled'
          ? getErrorStatus(ramsResult.value.error)
          : getErrorStatus(ramsResult.reason);

      const metricsRetryStatus = await loadDashboardMetrics();
      const retryFailureStatus = [permissionsRetryStatus, ramsRetryStatus, metricsRetryStatus].find((status) =>
        isAuthErrorStatus(status)
      );

      if (retryFailureStatus && !cancelled) {
        await forceAuthRedirect(retryFailureStatus);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    forceAuthRedirect,
    metricsErrorStatus,
    permissionsErrorStatus,
    profile?.id,
    recoverFromAuthFailure,
    ramsErrorStatus,
    refetchPermissions,
    refetchRamsAssignmentSummary,
    loadDashboardMetrics,
  ]);

  const visibleManagerTiles = getFilteredNavByPermissions(managerNavItems, userPermissions, effectiveIsAdmin);
  const visibleAdminTiles = getFilteredNavByPermissions(adminNavItems, userPermissions, effectiveIsAdmin);
  const renderedManagerTiles = visibleManagerTiles.filter(link => link.href !== '/absence/manage');
  const renderedManagementTiles = [...renderedManagerTiles, ...visibleAdminTiles];
  const visibleEmployeeNavigation = getFilteredEmployeeNav(
    userPermissions,
    effectiveIsManager,
    effectiveIsAdmin,
    hasRAMSAssignments
  );
  const navigationQuickActionTiles = getEnabledFormsForNavigation(visibleEmployeeNavigation);
  const remindersTile = formTypes.find(formType => formType.id === 'reminders');
  const renderedQuickActionTiles = userPermissions.has('reminders') && remindersPendingCount > 0 && remindersTile
    ? [remindersTile, ...navigationQuickActionTiles]
    : navigationQuickActionTiles;
  const managementTileBadgeCountByHref: Record<string, number> = {
    '/approvals': approvalsTileBadgeCount,
    '/actions': actionsUnassignedCount,
    '/suggestions/manage': newSuggestionsCount,
    '/admin/errors/manage': newErrorReportsCount,
    '/quotes': pendingQuotesCount,
    '/debug': errorLogsCount,
  };
  const hasManagementTileBadge = (href: string) => href in managementTileBadgeCountByHref;
  const getManagementTileBadgeCount = (href: string) => managementTileBadgeCountByHref[href] || 0;
  const hasSensitivePinIndicator = (moduleName: ModuleName | undefined, href: string) => Boolean(
    (moduleName && sensitivePinModuleSet.has(moduleName)) || sensitivePinDashboardHrefOverrides.has(href)
  );
  const isDashboardLoading = permissionsLoading || !profile?.id;

  if (isDashboardLoading) {
    return <PageLoader message={`Loading ${templateConfig.branding.shortAppName}`} />;
  }

  return (
    <AppPageShell className="space-y-8">

      {!tabletModeEnabled && !isDashboardLoading && (
        <div className="bg-slate-900 rounded-lg p-4 md:p-5 border border-slate-700 relative overflow-hidden">
          {/* Actual Content */}
          <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <Link
                href="/profile"
                aria-label="Open profile page"
                className="relative block h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-600 bg-slate-900/30 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow md:h-14 md:w-14"
              >
                {profile?.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt={`${profile?.full_name || 'User'} avatar`}
                    fill
                    unoptimized
                    loader={({ src }) => src}
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-slate-800 text-sm font-semibold text-brand-yellow">
                    {getInitials(profile?.full_name)}
                  </div>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <h1 ref={dashboardGreetingRef} className="relative truncate text-3xl font-bold text-white">
                  <span
                    ref={dashboardFullGreetingMeasureRef}
                    className="pointer-events-none absolute -z-10 whitespace-nowrap opacity-0"
                    aria-hidden="true"
                  >
                    {dashboardFullGreeting}
                  </span>
                  {dashboardGreeting}
                </h1>
                <p className="mt-1 text-slate-400">
                  {headerSubtitle}
                </p>
                <ReleaseVersionLink className="mt-2 inline-flex md:hidden" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Change mobile text size"
                onClick={() => setMobileTextSizeDialogOpen(true)}
                className="h-11 w-11 shrink-0 rounded-full border border-slate-600 bg-slate-800/80 text-brand-yellow shadow-sm hover:bg-slate-700 hover:text-brand-yellow focus-visible:ring-brand-yellow md:hidden"
              >
                <span aria-hidden className="text-base font-black tracking-tight">
                  Aa
                </span>
              </Button>
            </div>
            <div className="hidden md:flex items-end justify-end">
              <ReleaseVersionLink className="shrink-0" />
            </div>
          </div>
        </div>
      )}
      <MobileTextSizeDialog open={mobileTextSizeDialogOpen} onOpenChange={setMobileTextSizeDialogOpen} />

      {/* Quick Actions - Square Button Grid */}
      <div>
        <TooltipProvider>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {/* Active Forms */}
              {renderedQuickActionTiles.map((formType, index) => {
              const Icon = formType.icon;
              const isRemindersTile = formType.id === 'reminders';
              const tileBadgeCountById: Partial<Record<string, number>> = {
                rams: pendingRAMSCount,
                workshop: workshopPendingCount,
                reminders: remindersPendingCount,
              };
              const canHavePrimaryTileBadge = formType.id === 'maintenance' || formType.id in tileBadgeCountById;
              const showPrimaryBadgeLoading = formType.id === 'rams'
                ? ramsSummaryLoading
                : badgesLoading && canHavePrimaryTileBadge;
              const badgeCount = tileBadgeCountById[formType.id] || 0;
              const showBadge = !showPrimaryBadgeLoading && badgeCount > 0;
              const showMaintenanceBadges =
                formType.id === 'maintenance' &&
                !showPrimaryBadgeLoading &&
                (maintenanceDueSoonCount > 0 || maintenanceOverdueCount > 0);
              const showInventoryBetaBadge = formType.id === 'inventory';
              // Yellow backgrounds need dark text for contrast
              const needsDarkText = formType.color === 'brand-yellow';
              const textColorClass = needsDarkText ? 'text-slate-900' : 'text-white';

              return (
                <Link
                  key={formType.id}
                  href={formType.href}
                  className={isRemindersTile ? 'col-span-2' : undefined}
                >
                  <div
                    className={`relative overflow-hidden bg-${formType.color} hover:opacity-90 hover:scale-105 transition-all duration-200 rounded-lg p-6 text-center shadow-lg ${isRemindersTile ? 'aspect-[2/1]' : 'aspect-square'} flex flex-col items-center justify-center space-y-3 cursor-pointer animate-tile-pop ${textColorClass}`}
                    style={{ animationDelay: `${index * 75}ms` }}
                  >
                    {showPrimaryBadgeLoading ? (
                      <div className="absolute top-2 right-2 bg-slate-500/80 rounded-full h-10 w-10 flex items-center justify-center shadow-lg ring-2 ring-white animate-pulse">
                        <Loader2 className="h-5 w-5 animate-spin text-white" />
                      </div>
                    ) : showMaintenanceBadges ? (
                      <div className="absolute top-2 right-2 flex items-center gap-2">
                        {maintenanceDueSoonCount > 0 && (
                          <div className="bg-amber-500 text-white rounded-full h-10 w-10 flex items-center justify-center text-base font-bold shadow-lg ring-2 ring-white">
                            {maintenanceDueSoonCount > 99 ? '99+' : maintenanceDueSoonCount}
                          </div>
                        )}
                        {maintenanceOverdueCount > 0 && (
                          <div className="bg-red-500 text-white rounded-full h-10 w-10 flex items-center justify-center text-base font-bold shadow-lg ring-2 ring-white">
                            {maintenanceOverdueCount > 99 ? '99+' : maintenanceOverdueCount}
                          </div>
                        )}
                      </div>
                    ) : showBadge && (
                      <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-10 w-10 flex items-center justify-center text-base font-bold shadow-lg ring-2 ring-white">
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </div>
                    )}
                    <Icon className={tabletModeEnabled ? 'h-12 w-12' : 'h-8 w-8'} />
                    <div className="flex flex-col items-center gap-1">
                      <span className={`font-semibold leading-tight ${tabletModeEnabled ? 'text-base' : 'text-2xl'}`}>
                        {formType.title}
                      </span>
                      {showInventoryBetaBadge ? (
                        <Badge
                          variant="outline"
                          className="border-white/30 bg-white/10 px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white"
                        >
                          Beta
                        </Badge>
                      ) : null}
                    </div>
                    {formType.subtitle && (
                      <span
                        className={`pointer-events-none absolute bottom-2 left-2 right-2 truncate leading-tight opacity-90 max-[350px]:hidden ${tabletModeEnabled ? 'text-xs' : 'text-base'} ${textColorClass}`}
                        aria-hidden
                      >
                        {formType.subtitle}
                      </span>
                    )}
                  </div>
                </Link>
              );
              })}
          </div>
        </TooltipProvider>
      </div>

      {/* Manager/Admin Quick Access - Smaller Tiles */}
      {(renderedManagementTiles.length > 0 || canAccessDebugTools) && (
        <div className="space-y-6">
          {renderedManagerTiles.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">
                Management
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {/* Manager Links - Using shared navigation config */}
                {renderedManagerTiles.map((link, index) => {
                  const Icon = link.icon;
                  const canHaveBadge = hasManagementTileBadge(link.href);
                  const badgeCount = getManagementTileBadgeCount(link.href);
                  const showSensitivePinIndicator = hasSensitivePinIndicator(link.module, link.href);

                  return (
                    <Link key={link.href} href={link.href} className="group">
                      <div
                        className="relative bg-slate-800 dark:bg-slate-900 border-4 border-slate-600 hover:border-slate-500 hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer animate-tile-pop"
                        style={{ height: '100px', animationDelay: `${index * 75}ms` }}
                      >
                        {badgesLoading && canHaveBadge ? (
                          <div className="absolute top-2 right-2 bg-slate-500/80 rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-slate-700 animate-pulse">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                          </div>
                        ) : badgeCount > 0 ? (
                          <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-lg ring-2 ring-slate-800">
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </div>
                        ) : null}
                        {showSensitivePinIndicator && (
                          <span
                            role="img"
                            aria-label={`${link.label} requires Sensitive PIN`}
                            title="Sensitive PIN required"
                            className={sensitivePinIndicatorClass}
                          >
                            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        )}
                        <div className="flex flex-col items-start justify-between h-full">
                          <Icon className="h-6 w-6 text-muted-foreground" />
                          <span className="text-white font-semibold text-base leading-tight">
                            {link.label}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {visibleAdminTiles.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">
                Administration
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {/* Admin Links - Using shared navigation config */}
                {visibleAdminTiles.map((link, index) => {
                  const Icon = link.icon;
                  const animationIndex = renderedManagerTiles.length + index;
                  const canHaveBadge = hasManagementTileBadge(link.href);
                  const badgeCount = getManagementTileBadgeCount(link.href);
                  const showSensitivePinIndicator = hasSensitivePinIndicator(link.module, link.href);

                  return (
                    <Link key={link.href} href={link.href} className="group">
                      <div
                        className="relative bg-slate-800 dark:bg-slate-900 border-4 border-slate-600 hover:border-slate-500 hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer animate-tile-pop"
                        style={{ height: '100px', animationDelay: `${animationIndex * 75}ms` }}
                      >
                        {badgesLoading && canHaveBadge ? (
                          <div className="absolute top-2 right-2 bg-slate-500/80 rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-slate-700 animate-pulse">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                          </div>
                        ) : badgeCount > 0 ? (
                          <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-lg ring-2 ring-slate-800">
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </div>
                        ) : null}
                        {showSensitivePinIndicator && (
                          <span
                            role="img"
                            aria-label={`${link.label} requires Sensitive PIN`}
                            title="Sensitive PIN required"
                            className={sensitivePinIndicatorClass}
                          >
                            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        )}
                        <div className="flex flex-col items-start justify-between h-full">
                          <Icon className="h-6 w-6 text-muted-foreground" />
                          <span className="text-white font-semibold text-base leading-tight">
                            {link.label}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* SuperAdmin Only - Debug Link (only when viewing as actual role) */}
          {canAccessDebugTools && (() => {
            const Icon = Bug;
            const animationIndex = renderedManagementTiles.length;
            const showSensitivePinIndicator = hasSensitivePinIndicator(undefined, '/debug');

            return (
              <div>
                <h3 className="text-lg font-semibold text-red-500 mb-3">
                  Developer
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  <Link key="/debug" href="/debug" className="group">
                    <div
                      className="relative bg-slate-800 dark:bg-slate-900 border-4 border-red-600 hover:border-red-500 hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer animate-tile-pop"
                      style={{ height: '100px', animationDelay: `${animationIndex * 75}ms` }}
                    >
                      {badgesLoading ? (
                        <div className="absolute top-2 right-2 bg-slate-500/80 rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-slate-700 animate-pulse">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                        </div>
                      ) : getManagementTileBadgeCount('/debug') > 0 ? (
                        <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-lg ring-2 ring-slate-800">
                          {getManagementTileBadgeCount('/debug') > 99 ? '99+' : getManagementTileBadgeCount('/debug')}
                        </div>
                      ) : null}
                      {showSensitivePinIndicator && (
                        <span
                          role="img"
                          aria-label="Debug requires Sensitive PIN"
                          title="Sensitive PIN required"
                          className={sensitivePinIndicatorClass}
                        >
                          <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      )}
                      <div className="flex flex-col items-start justify-between h-full">
                        <Icon className="h-6 w-6 text-red-500" />
                        <span className="font-semibold text-base leading-tight text-red-500">
                          Debug
                        </span>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Pending Approvals Summary - Manager/Admin Only */}
      {!tabletModeEnabled && canViewApprovals && (
        <Card className="border-border animate-card-fade" style={{ animationDelay: '300ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-white">
              <span>Pending Approvals</span>
              <Link href="/approvals">
                <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-slate-700/50">
                  View All Approvals
                </Button>
              </Link>
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Outstanding approval requests across all types
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <SectionLoader message="Loading pending approvals..." />
            ) : (
              <div className="space-y-2">
                {pendingApprovals.map((approval) => {
                  const Icon = approval.icon;

                  return (
                    <Link
                      key={approval.type}
                      href={approval.href}
                      className="block group"
                    >
                      <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all duration-200 border border-border/50 hover:border-slate-300 dark:hover:border-border">
                        <div className="flex items-center gap-4">
                          <div
                            className="flex items-center justify-center w-10 h-10 rounded-lg"
                            style={{ backgroundColor: applyAlphaToHSL(approval.color) }}
                          >
                            <Icon
                              className="h-5 w-5"
                              style={{ color: approval.color }}
                            />
                          </div>
                          <div>
                            <p className="font-medium text-white group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">
                              {approval.label}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {approval.count === 0 ? 'No' : approval.count} pending {approval.count === 1 ? 'request' : 'requests'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {approval.count > 0 && (
                            <Badge
                              variant="outline"
                              className="text-base px-3 py-1 font-semibold border-amber-500/30 text-amber-400 bg-amber-500/10"
                            >
                              {approval.count}
                            </Badge>
                          )}
                          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-muted-foreground transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}

                {pendingApprovals.reduce((sum, a) => sum + a.count, 0) === 0 && (
                  <div className="text-center py-8 text-slate-400 mt-4">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-20 text-green-400" />
                    <p className="text-lg mb-1">All caught up!</p>
                    <p className="text-sm text-muted-foreground">
                      No pending approvals at the moment
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </AppPageShell>
  );
}
