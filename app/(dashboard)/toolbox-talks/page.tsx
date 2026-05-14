'use client';

import { useMemo } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import { MessageSquare, Bell, BarChart3 } from 'lucide-react';
import { CreateToolboxTalkForm } from '@/components/messages/CreateToolboxTalkForm';
import { CreateReminderForm } from '@/components/messages/CreateReminderForm';
import { MessagesReportView } from '@/components/messages/MessagesReportView';

export default function ToolboxTalksPage() {
  const { hasPermission: canViewToolboxTalks, loading: permissionLoading } = usePermissionCheck('toolbox-talks', false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useMemo(() => {
    const requestedTab = searchParams.get('tab') || 'create-toolbox-talk';
    const validTabs = ['create-toolbox-talk', 'create-reminder', 'reports'];
    return validTabs.includes(requestedTab) ? requestedTab : 'create-toolbox-talk';
  }, [searchParams]);

  function handleTabChange(value: string) {
    router.replace(`/toolbox-talks?tab=${value}`, { scroll: false });
  }

  // Redirect non-managers/admins
  if (!permissionLoading && !canViewToolboxTalks) {
    router.push('/dashboard');
    return null;
  }

  if (permissionLoading) {
    return <PageLoader message="Loading toolbox talks..." />;
  }

  return (
    <AppPageShell>
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-red-100 dark:bg-red-950 rounded-lg">
            <MessageSquare className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Toolbox Talks & Reminders
            </h1>
            <p className="text-muted-foreground">
              Send important safety messages and reminders to employees
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 bg-slate-800 p-0">
          <TabsTrigger value="create-toolbox-talk" data-tab="toolbox-talk" className="gap-2 data-[state=active]:bg-red-600 data-[state=active]:text-white">
            <MessageSquare className="h-4 w-4" />
            Create Toolbox Talk
          </TabsTrigger>
          <TabsTrigger value="create-reminder" data-tab="reminder" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <Bell className="h-4 w-4" />
            Create Reminder
          </TabsTrigger>
          <TabsTrigger value="reports" data-tab="reports" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <BarChart3 className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        {/* Create Toolbox Talk Tab */}
        <TabsContent value="create-toolbox-talk">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                Create Toolbox Talk Message
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                High priority safety message that requires employee signature. Recipients cannot use the app until signed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateToolboxTalkForm onSuccess={() => {
                // Optionally switch to reports tab after creation
                // setActiveTab('reports');
              }} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Create Reminder Tab */}
        <TabsContent value="create-reminder">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                Create Reminder Message
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Low priority informational message. Non-blocking - employees can dismiss after reading.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateReminderForm onSuccess={() => {
                // Optionally switch to reports tab after creation
              }} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                Message Reports
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                View all sent messages, recipient status, and compliance rates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MessagesReportView />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}

