'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { PageLoader } from '@/components/ui/page-loader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  APP_WIDESCREEN_CHANGED_EVENT,
  readAppWidescreenPreference,
  writeAppWidescreenPreference,
} from '@/lib/config/layout-preferences';
import { TimesheetTypeExceptionsCard } from './components/TimesheetTypeExceptionsCard';
import { DisplayBoardSettingsCard } from './components/DisplayBoardSettingsCard';

const SETTINGS_HELPER_TEXT_CLASS = 'text-sm leading-relaxed text-slate-400';

type AdminSettingsTab = 'general' | 'timesheets';

function isAdminSettingsTab(value: string | null): value is AdminSettingsTab {
  return value === 'general' || value === 'timesheets';
}

function AdminSettingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission: canAccessSettings, loading: permissionLoading } = usePermissionCheck('admin-settings', false);
  const tabParam = searchParams.get('tab');
  const settingsTab: AdminSettingsTab = isAdminSettingsTab(tabParam) ? tabParam : 'general';
  const [appWidescreenEnabled, setAppWidescreenEnabled] = useState(false);

  useEffect(() => {
    if (!permissionLoading && !canAccessSettings) {
      router.push('/dashboard');
    }
  }, [canAccessSettings, permissionLoading, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPreference = () => {
      setAppWidescreenEnabled(readAppWidescreenPreference());
    };

    syncPreference();
    window.addEventListener('storage', syncPreference);
    window.addEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);

    return () => {
      window.removeEventListener('storage', syncPreference);
      window.removeEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);
    };
  }, []);

  function handleAppWidescreenToggle(checked: boolean) {
    setAppWidescreenEnabled(checked);
    writeAppWidescreenPreference(checked);
  }

  function handleSettingsTabChange(nextTab: AdminSettingsTab) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextTab === 'general') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', nextTab);
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  if (permissionLoading) {
    return <PageLoader message="Loading admin settings..." />;
  }

  if (!canAccessSettings) {
    return null;
  }

  return (
    <AppPageShell>
      <div className="bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-3 bg-brand-yellow/20 rounded-lg">
            <SlidersHorizontal className="h-6 w-6 text-brand-yellow" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-white mb-2">Admin Settings</h1>
            <p className="text-muted-foreground">
              Configure admin-only tools, overrides, and system-level controls.
            </p>
          </div>
        </div>
      </div>

      <Tabs
        value={settingsTab}
        onValueChange={(value) => {
          if (isAdminSettingsTab(value)) handleSettingsTabChange(value);
        }}
      >
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card className="border-border bg-slate-900/60">
            <CardHeader>
              <CardTitle className="text-white">Layout Preferences</CardTitle>
              <CardDescription className={SETTINGS_HELPER_TEXT_CLASS}>
                Apply a wider desktop content layout across the dashboard app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/80 p-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Global Widescreen View</p>
                  <p className={SETTINGS_HELPER_TEXT_CLASS}>
                    When enabled, dashboard pages use a wider content area on desktop screens.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {appWidescreenEnabled ? 'Enabled' : 'Default width'}
                  </span>
                  <Switch checked={appWidescreenEnabled} onCheckedChange={handleAppWidescreenToggle} />
                </div>
              </div>
            </CardContent>
          </Card>
          <DisplayBoardSettingsCard />
        </TabsContent>

        <TabsContent value="timesheets" className="space-y-6">
          <TimesheetTypeExceptionsCard />
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading admin settings..." />}>
      <AdminSettingsContent />
    </Suspense>
  );
}
