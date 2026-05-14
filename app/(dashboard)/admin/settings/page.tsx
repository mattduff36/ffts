'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { PageLoader } from '@/components/ui/page-loader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  APP_WIDESCREEN_CHANGED_EVENT,
  readAppWidescreenPreference,
  writeAppWidescreenPreference,
} from '@/lib/config/layout-preferences';
import { TimesheetTypeExceptionsCard } from './components/TimesheetTypeExceptionsCard';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { isAdmin, isSuperAdmin, isActualSuperAdmin } = useAuth();
  const { hasPermission: canAccessSettings, loading: permissionLoading } = usePermissionCheck('admin-settings', false);
  const isAdminActor = isAdmin || isSuperAdmin || isActualSuperAdmin;
  const [settingsTab, setSettingsTab] = useState<'general' | 'timesheets'>('general');
  const [appWidescreenEnabled, setAppWidescreenEnabled] = useState(false);

  useEffect(() => {
    if (!permissionLoading && (!canAccessSettings || !isAdminActor)) {
      router.push('/dashboard');
    }
  }, [canAccessSettings, isAdminActor, permissionLoading, router]);

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

  if (permissionLoading) {
    return <PageLoader message="Loading admin settings..." />;
  }

  if (!canAccessSettings || !isAdminActor) {
    return null;
  }

  return (
    <AppPageShell>
      <div className="bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-brand-yellow/20 rounded-lg">
            <SlidersHorizontal className="h-6 w-6 text-brand-yellow" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Admin Settings</h1>
            <p className="text-muted-foreground">
              Configure admin-only tools, overrides, and system-level controls.
            </p>
          </div>
        </div>
      </div>

      <Tabs value={settingsTab} onValueChange={(value) => setSettingsTab(value as 'general' | 'timesheets')}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card className="border-border bg-slate-900/60">
            <CardHeader>
              <CardTitle className="text-white">Layout Preferences</CardTitle>
              <CardDescription className="text-muted-foreground">
                Apply a wider desktop content layout across the dashboard app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/80 p-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Global Widescreen View</p>
                  <p className="text-sm text-muted-foreground">
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
        </TabsContent>

        <TabsContent value="timesheets" className="space-y-6">
          <TimesheetTypeExceptionsCard />
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}
