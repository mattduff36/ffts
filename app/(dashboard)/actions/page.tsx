'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BellRing, CheckCircle2, ClipboardList, EyeOff, Settings } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
  getReminderOverviewTab,
  isValidReminderOverviewTabId,
  REMINDER_OVERVIEW_TABS,
} from '@/lib/config/reminder-workflows';
import {
  buildActionsSummaryStats,
  EMPTY_ACTIONS_SUMMARY,
  type ActionsSummaryStats,
} from '@/lib/utils/actions-summary';
import type { ReminderActionWithAsset } from '@/types/reminders';
import { ActionedActionsPanel } from './components/ActionedActionsPanel';
import { ActionsOverviewPanel } from './components/ActionsOverviewPanel';
import { ActionsSettingsTab } from './components/ActionsSettingsTab';
import { ActionsSummaryCards } from './components/ActionsSummaryCards';
import { IgnoredActionsPanel } from './components/IgnoredActionsPanel';

const tabTriggerClassName = 'gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900';

const ACTIONS_ARCHIVE_TABS = [
  {
    id: 'ignored-reminders',
    label: 'Ignored',
    icon: EyeOff,
  },
  {
    id: 'actioned-reminders',
    label: 'Actioned',
    icon: CheckCircle2,
  },
] as const;

type ActionsArchiveTabId = (typeof ACTIONS_ARCHIVE_TABS)[number]['id'];
type ActionsOverviewTabId = string | ActionsArchiveTabId;

function isActionsArchiveTabId(value: string): value is ActionsArchiveTabId {
  return ACTIONS_ARCHIVE_TABS.some((tab) => tab.id === value);
}

function isValidActionsOverviewTabId(value: string): boolean {
  return isValidReminderOverviewTabId(value) || isActionsArchiveTabId(value);
}

function ActionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canViewActions, loading: actionsPermissionLoading } = usePermissionCheck('actions', false);

  const canManage = isManager || isAdmin;
  const [refreshToken, setRefreshToken] = useState(0);
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const [summary, setSummary] = useState<ActionsSummaryStats>(EMPTY_ACTIONS_SUMMARY);
  const requestedTab = searchParams.get('tab') || 'vans';
  const pageTab: 'overview' | 'settings' = requestedTab === 'settings' && canManage ? 'settings' : 'overview';
  const overviewTab: ActionsOverviewTabId = isValidActionsOverviewTabId(requestedTab)
    ? requestedTab
    : REMINDER_OVERVIEW_TABS[0]?.id || 'vans';

  const activeOverviewTab = useMemo(
    () => getReminderOverviewTab(overviewTab),
    [overviewTab],
  );

  useEffect(() => {
    if (!actionsPermissionLoading && !canViewActions) {
      router.replace('/dashboard');
    }
  }, [actionsPermissionLoading, canViewActions, router]);

  useEffect(() => {
    if (authLoading || actionsPermissionLoading || !canViewActions) {
      return;
    }

    if (requestedTab === 'settings') {
      if (!canManage) {
        router.replace('/actions?tab=vans', { scroll: false });
      }
      return;
    }

    if (isValidActionsOverviewTabId(requestedTab)) {
      return;
    }

    router.replace('/actions?tab=vans', { scroll: false });
  }, [authLoading, actionsPermissionLoading, canManage, canViewActions, requestedTab, router]);

  const loadSummary = useCallback(async () => {
    if (authLoading || actionsPermissionLoading || !canViewActions) {
      return;
    }

    try {
      const searchParams = new URLSearchParams({
        status: 'open',
        workflow: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
        ensure_fresh: 'true',
      });
      const response = await fetch(`/api/actions?${searchParams.toString()}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load actions summary');
      }

      setSummary(buildActionsSummaryStats((payload.actions || []) as ReminderActionWithAsset[]));
    } catch (error) {
      console.error(error);
      setSummary(EMPTY_ACTIONS_SUMMARY);
    }
  }, [authLoading, actionsPermissionLoading, canViewActions]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, refreshToken, summaryRefreshToken]);

  function handlePageTabChange(value: string) {
    if (value === 'settings') {
      router.push('/actions?tab=settings', { scroll: false });
      return;
    }

    router.push(`/actions?tab=${overviewTab}`, { scroll: false });
  }

  function handleOverviewTabChange(value: string) {
    router.push(`/actions?tab=${value}`, { scroll: false });
  }

  function handleSettingsSaved() {
    setRefreshToken((current) => current + 1);
    setSummaryRefreshToken((current) => current + 1);
  }

  function handleActionsChanged() {
    setSummaryRefreshToken((current) => current + 1);
  }

  function renderOverviewContent() {
    if (overviewTab === 'ignored-reminders') {
      return <IgnoredActionsPanel onRestored={handleSettingsSaved} />;
    }

    if (overviewTab === 'actioned-reminders') {
      return <ActionedActionsPanel />;
    }

    if (!activeOverviewTab) return null;

    return (
      <ActionsOverviewPanel
        key={activeOverviewTab.id}
        tab={activeOverviewTab}
        refreshToken={refreshToken}
        onActionsChanged={handleActionsChanged}
      />
    );
  }

  if (actionsPermissionLoading || authLoading) {
    return <PageLoader message="Loading actions..." />;
  }

  if (!canViewActions) {
    return <PageLoader message="Redirecting..." />;
  }

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="Actions"
        description="Generated actions that managers and admins can assign as employee reminders."
        icon={<BellRing className="h-5 w-5" />}
      />

      <ActionsSummaryCards summary={summary} />

      <Tabs value={pageTab} onValueChange={handlePageTabChange}>
        {canManage ? (
          <TabsList>
            <TabsTrigger value="overview" className={tabTriggerClassName}>
              <ClipboardList className="h-4 w-4" />
              Daily Checks
            </TabsTrigger>
            <TabsTrigger value="settings" className={tabTriggerClassName}>
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        ) : null}

        {pageTab === 'overview' ? (
          <div className="mt-3 flex justify-end">
            <Tabs value={overviewTab} onValueChange={handleOverviewTabChange}>
              <TabsList>
                {REMINDER_OVERVIEW_TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger key={tab.id} value={tab.id} className={tabTriggerClassName}>
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
                {ACTIONS_ARCHIVE_TABS.map((tab, index) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className={`${tabTriggerClassName} ${index === 0 ? 'ml-3' : ''}`}
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <TabsContent value="overview" className="mt-0 space-y-6">
          {renderOverviewContent()}
        </TabsContent>

        {canManage ? (
          <TabsContent value="settings" className="mt-0 space-y-6">
            <ActionsSettingsTab onSaved={handleSettingsSaved} />
          </TabsContent>
        ) : null}
      </Tabs>
    </AppPageShell>
  );
}

export default function ActionsPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading actions..." />}>
      <ActionsContent />
    </Suspense>
  );
}
