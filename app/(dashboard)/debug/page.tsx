'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';
import { BarChart3, Bug, Car, FlaskConical, History, KeyRound, RefreshCw, Send, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';

const debugTabLoading = () => <PanelLoader message="Loading debug tab..." accent="debug" className="min-h-[320px]" />;

const AuditLogDebugPanel = dynamic(
  () => import('./components/AuditLogDebugPanel').then((mod) => ({ default: mod.AuditLogDebugPanel })),
  { loading: debugTabLoading },
);
const DVLASyncDebugPanel = dynamic(
  () => import('./components/DVLASyncDebugPanel').then((mod) => ({ default: mod.DVLASyncDebugPanel })),
  { loading: debugTabLoading },
);
const ErrorLogsDebugPanel = dynamic(
  () => import('./components/ErrorLogsDebugPanel').then((mod) => ({ default: mod.ErrorLogsDebugPanel })),
  { loading: debugTabLoading },
);
const EmulationTestsDebugPanel = dynamic(
  () => import('./components/EmulationTestsDebugPanel').then((mod) => ({ default: mod.EmulationTestsDebugPanel })),
  { loading: debugTabLoading },
);
const NotificationSettingsDebugPanel = dynamic(
  () => import('./components/NotificationSettingsDebugPanel').then((mod) => ({ default: mod.NotificationSettingsDebugPanel })),
  { loading: debugTabLoading },
);
const LegacyJobCodesDebugPanel = dynamic(
  () => import('./components/LegacyJobCodesDebugPanel').then((mod) => ({ default: mod.LegacyJobCodesDebugPanel })),
  { loading: debugTabLoading },
);
const TestFleetDebugPanel = dynamic(
  () => import('./components/TestFleetDebugPanel').then((mod) => ({ default: mod.TestFleetDebugPanel })),
  { loading: debugTabLoading },
);
const UserAnalyticsDebugPanel = dynamic(
  () => import('./components/UserAnalyticsDebugPanel').then((mod) => ({ default: mod.UserAnalyticsDebugPanel })),
  { loading: debugTabLoading },
);

type DebugTab =
  | 'error-log'
  | 'audit-log'
  | 'usage-analytics'
  | 'dvla-sync'
  | 'test-fleet'
  | 'job-code-corrections'
  | 'notification-settings'
  | 'emulation-tests';

interface DebugTabConfig {
  value: DebugTab;
  label: string;
  icon: LucideIcon;
}

const DEBUG_TAB_ALIASES: Record<string, DebugTab> = {
  errors: 'error-log',
  'error-log': 'error-log',
  audit: 'audit-log',
  'audit-log': 'audit-log',
  analytics: 'usage-analytics',
  usage: 'usage-analytics',
  'usage-analytics': 'usage-analytics',
  dvla: 'dvla-sync',
  'dvla-sync': 'dvla-sync',
  'test-fleet': 'test-fleet',
  legacy: 'job-code-corrections',
  'legacy-codes': 'job-code-corrections',
  'legacy-job-codes': 'job-code-corrections',
  'job-codes': 'job-code-corrections',
  'job-code-corrections': 'job-code-corrections',
  notifications: 'notification-settings',
  'notification-settings': 'notification-settings',
  emulation: 'emulation-tests',
  'emulation-tests': 'emulation-tests',
};

const DEBUG_TABS: DebugTabConfig[] = [
  { value: 'error-log', label: 'Error Log', icon: Bug },
  { value: 'audit-log', label: 'Audit Log', icon: History },
  { value: 'usage-analytics', label: 'Usage Analytics', icon: BarChart3 },
  { value: 'dvla-sync', label: 'DVLA Sync', icon: RefreshCw },
  { value: 'test-fleet', label: 'Test Fleet', icon: Car },
  { value: 'job-code-corrections', label: 'Job Codes', icon: KeyRound },
  { value: 'notification-settings', label: 'Notification Settings', icon: Send },
  { value: 'emulation-tests', label: 'Emulation Tests', icon: FlaskConical },
];

const tabTriggerClassName = 'min-h-10 gap-2 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground lg:px-3';

export default function DebugPage() {
  const { profile, loading: authLoading, isActualSuperAdmin, isViewingAs } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useBrowserSupabaseClient();

  const canAccessDebugTools = canAccessDebugConsole({
    email: profile?.email,
    isActualSuperAdmin,
    isViewingAs,
  });
  const sensitiveAccess = useSensitiveModuleAccess('debug', {
    enabled: Boolean(profile && canAccessDebugTools),
  });

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!profile) {
      router.push('/login');
      return;
    }

    if (!canAccessDebugTools) {
      toast.error('Access denied: Debug tools access required');
      router.push('/dashboard');
      return;
    }
  }, [authLoading, canAccessDebugTools, profile, router]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    const normalizedTab = requestedTab ? DEBUG_TAB_ALIASES[requestedTab] : 'error-log';

    if (!normalizedTab || requestedTab !== normalizedTab) {
      router.replace(`/debug?tab=${normalizedTab || 'error-log'}`, { scroll: false });
    }
  }, [searchParams, router]);

  const requestedTab = searchParams.get('tab');
  const activeTab = (requestedTab ? DEBUG_TAB_ALIASES[requestedTab] : 'error-log') || 'error-log';

  function handleTabChange(value: DebugTab) {
    router.replace(`/debug?tab=${value}`, { scroll: false });
  }

  if (authLoading || !supabase) {
    return <PageLoader message="Loading debug tools..." />;
  }

  if (!profile || !canAccessDebugTools) {
    return (
      <AppPageShell>
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Access denied</CardTitle>
            <CardDescription>
              Super admin permission is required to access debug tools.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppPageShell>
    );
  }

  if (sensitiveAccess.loading) {
    return <PageLoader message="Checking sensitive debug access..." />;
  }

  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell width="wide">
        <SensitiveModuleGate moduleLabel="Debug Console" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide">
      <SensitiveModuleSessionManager moduleLabel="Debug Console" access={sensitiveAccess} />
      <div className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 p-6 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <Bug className="h-6 w-6 md:h-8 md:w-8" />
          <div>
            <h1 className="mb-1 text-2xl font-bold md:mb-2 md:text-3xl">SuperAdmin Debug Console</h1>
            <p className="text-sm text-red-50 md:text-base">Developer tools and operational diagnostics</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as DebugTab)} className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-1 bg-slate-900/50 p-1 sm:grid-cols-8 lg:flex lg:w-auto lg:flex-wrap lg:justify-start lg:gap-0 lg:p-1.5">
          {DEBUG_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className={tabTriggerClassName}
              aria-label={label}
              title={label}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="hidden lg:inline">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="error-log">
          <ErrorLogsDebugPanel />
        </TabsContent>

        <TabsContent value="audit-log">
          <AuditLogDebugPanel supabase={supabase} />
        </TabsContent>

        <TabsContent value="usage-analytics">
          <UserAnalyticsDebugPanel />
        </TabsContent>

        <TabsContent value="dvla-sync">
          <DVLASyncDebugPanel />
        </TabsContent>

        <TabsContent value="test-fleet">
          <TestFleetDebugPanel />
        </TabsContent>

        <TabsContent value="job-code-corrections">
          <LegacyJobCodesDebugPanel />
        </TabsContent>

        <TabsContent value="notification-settings">
          <NotificationSettingsDebugPanel />
        </TabsContent>

        <TabsContent value="emulation-tests">
          <EmulationTestsDebugPanel />
        </TabsContent>

      </Tabs>
    </AppPageShell>
  );
}
