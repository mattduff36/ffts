'use client';

import { Suspense, useEffect, useMemo } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import { MessageSquare, Bell, BarChart3 } from 'lucide-react';
import { CreateToolboxTalkForm } from '@/components/messages/CreateToolboxTalkForm';
import { CreateReminderForm } from '@/components/messages/CreateReminderForm';
import { MessagesReportView } from '@/components/messages/MessagesReportView';

const DEFAULT_TAB = 'overview';
const LEGACY_REPORTS_TAB = 'reports';
const VALID_TABS = ['overview', 'create-toolbox-talk', 'create-reminder'] as const;
const tabTriggerClassName = 'gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900';
const tabletTabTriggerClassName = `${tabTriggerClassName} min-h-11 px-4 text-base [&_svg]:size-5`;

function isValidToolboxTalksTab(value: string): value is (typeof VALID_TABS)[number] {
  return VALID_TABS.includes(value as (typeof VALID_TABS)[number]);
}

function ToolboxTalksContent() {
  const { hasPermission: canViewToolboxTalks, loading: permissionLoading } = usePermissionCheck('toolbox-talks', false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tabletModeEnabled } = useTabletMode();
  const requestedTab = searchParams.get('tab') || DEFAULT_TAB;
  const activeTab = useMemo(() => {
    return isValidToolboxTalksTab(requestedTab) ? requestedTab : DEFAULT_TAB;
  }, [requestedTab]);

  useEffect(() => {
    if (!permissionLoading && !canViewToolboxTalks) {
      router.replace('/dashboard');
    }
  }, [canViewToolboxTalks, permissionLoading, router]);

  useEffect(() => {
    if (requestedTab === LEGACY_REPORTS_TAB) {
      router.replace(`/toolbox-talks?tab=${DEFAULT_TAB}`, { scroll: false });
      return;
    }

    if (requestedTab && !isValidToolboxTalksTab(requestedTab)) {
      router.replace(`/toolbox-talks?tab=${DEFAULT_TAB}`, { scroll: false });
    }
  }, [requestedTab, router]);

  function handleTabChange(value: string) {
    router.replace(`/toolbox-talks?tab=${value}`, { scroll: false });
  }

  function handleMessageSent() {
    router.replace('/toolbox-talks?tab=overview', { scroll: false });
  }

  if (permissionLoading) {
    return <PageLoader message="Loading toolbox talks..." />;
  }

  if (!canViewToolboxTalks) {
    return <PageLoader message="Redirecting..." />;
  }

  return (
    <AppPageShell>
      <AppPageHeader
        title="Toolbox Talks"
        description="Create safety toolbox talks, send reminders, and review message compliance."
        icon={<MessageSquare className="h-5 w-5" />}
        className={tabletModeEnabled ? 'p-5 md:p-6' : undefined}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className={tabletModeEnabled ? 'h-auto flex-wrap justify-start gap-2 p-1.5' : undefined}>
          <TabsTrigger
            value="overview"
            data-tab="overview"
            className={tabletModeEnabled ? tabletTabTriggerClassName : tabTriggerClassName}
          >
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="create-toolbox-talk"
            data-tab="toolbox-talk"
            className={tabletModeEnabled ? tabletTabTriggerClassName : tabTriggerClassName}
          >
            <MessageSquare className="h-4 w-4" />
            Create Toolbox Talk
          </TabsTrigger>
          <TabsTrigger
            value="create-reminder"
            data-tab="reminder"
            className={tabletModeEnabled ? tabletTabTriggerClassName : tabTriggerClassName}
          >
            <Bell className="h-4 w-4" />
            Create Notification / Reminder
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-foreground">
                Overview
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                View sent toolbox talks and notifications, recipient status, and compliance rates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MessagesReportView />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create-toolbox-talk" className="mt-0 space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-foreground">
                Create Toolbox Talk Message
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Safety message requiring an employee signature, with priority controls for how urgently it is shown.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateToolboxTalkForm onSuccess={handleMessageSent} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create-reminder" className="mt-0 space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-foreground">
                Create Notification / Reminder
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Send a dismissible notification or create a task in the Reminders module.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateReminderForm onSuccess={handleMessageSent} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}

export default function ToolboxTalksPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading toolbox talks..." />}>
      <ToolboxTalksContent />
    </Suspense>
  );
}

