'use client';

import { useEffect, Suspense, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Wrench, Truck, HardHat, Settings } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { MaintenanceSettings } from '@/app/(dashboard)/maintenance/components/MaintenanceSettings';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

const MaintenanceOverview = dynamic(
  () => import('@/app/(dashboard)/maintenance/components/MaintenanceOverview').then(mod => ({ default: mod.MaintenanceOverview })),
  { 
    loading: () => <PanelLoader message="Loading maintenance overview..." accent="maintenance" className="py-12" />,
    ssr: false
  }
);

function MaintenanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canViewMaintenance, loading: maintenancePermissionLoading } = usePermissionCheck('maintenance', false);
  const { tabletModeEnabled } = useTabletMode();

  const canManage = isManager || isAdmin || isSuperAdmin;
  const lastAssetFilterRef = useRef<'both' | 'van' | 'hgv' | 'plant'>('both');

  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();
  const showInitialMaintenanceLoading = maintenanceLoading && !maintenanceData;

  const validAssetTabs: ReadonlyArray<'both' | 'van' | 'plant' | 'hgv'> = ['both', 'van', 'plant', 'hgv'];

  const { activeTab, maintenanceFilter } = useMemo(() => {
    if (authLoading) return { activeTab: 'overview' as const, maintenanceFilter: lastAssetFilterRef.current };
    const requestedTab = searchParams.get('tab') || 'both';

    if (requestedTab === 'settings' && canManage) {
      return { activeTab: 'settings' as const, maintenanceFilter: lastAssetFilterRef.current };
    }

    if (validAssetTabs.includes(requestedTab as (typeof validAssetTabs)[number])) {
      lastAssetFilterRef.current = requestedTab as 'both' | 'van' | 'plant' | 'hgv';
      return { activeTab: 'overview' as const, maintenanceFilter: requestedTab as 'both' | 'van' | 'plant' | 'hgv' };
    }

    return { activeTab: 'overview' as const, maintenanceFilter: lastAssetFilterRef.current };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, authLoading, canManage]);

  useEffect(() => {
    if (authLoading) return;
    const requestedTab = searchParams.get('tab') || 'both';

    if (requestedTab === 'settings' && !canManage) {
      router.replace('/maintenance?tab=both', { scroll: false });
      return;
    }

    if (requestedTab !== 'settings' && !validAssetTabs.includes(requestedTab as (typeof validAssetTabs)[number])) {
      router.replace('/maintenance?tab=both', { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, authLoading, canManage, router]);

  function handlePageTabChange(value: 'overview' | 'settings') {
    if (value === 'settings') {
      router.replace('/maintenance?tab=settings', { scroll: false });
    } else {
      router.replace(`/maintenance?tab=${maintenanceFilter}`, { scroll: false });
    }
  }

  function handleMaintenanceFilterChange(value: 'both' | 'van' | 'hgv' | 'plant') {
    router.replace(`/maintenance?tab=${value}`, { scroll: false });
  }

  const filteredMaintenance = useMemo(() => {
    const vehicles = (maintenanceData?.vehicles || []).filter((vehicle) => {
      if (maintenanceFilter === 'both') return true;
      return vehicle.vehicle?.asset_type === maintenanceFilter;
    });

    return {
      vehicles,
      summary: {
        total: vehicles.length,
        overdue: vehicles.filter((vehicle) => vehicle.overdue_count > 0).length,
        due_soon: vehicles.filter((vehicle) => vehicle.due_soon_count > 0 && vehicle.overdue_count === 0).length,
      },
    };
  }, [maintenanceData?.vehicles, maintenanceFilter]);

  const handleVehicleClick = (vehicle: VehicleMaintenanceWithStatus) => {
    const isPlant = vehicle.is_plant === true || vehicle.vehicle?.asset_type === 'plant';
    const isHgv = vehicle.vehicle?.asset_type === 'hgv' || !!(vehicle as VehicleMaintenanceWithStatus).hgv_id;
    const assetId = (vehicle as VehicleMaintenanceWithStatus).hgv_id ?? vehicle.van_id ?? vehicle.vehicle?.id ?? vehicle.id;

    if (isPlant) {
      router.push(`/fleet/plant/${assetId}/history?fromTab=maintenance`);
    } else if (isHgv) {
      router.push(`/fleet/hgvs/${assetId}/history?fromTab=maintenance`);
    } else {
      router.push(`/fleet/vans/${assetId}/history?fromTab=maintenance`);
    }
  };

  if (authLoading || maintenancePermissionLoading) {
    return <PageLoader message="Loading maintenance..." />;
  }

  if (!canViewMaintenance) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-gray-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
            <p className="text-gray-600 text-center max-w-md">
              You don&apos;t have permission to access Maintenance. Please contact your manager.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <AppPageShell>
      {/* Header */}
      <div className={`bg-white dark:bg-slate-900 rounded-lg border border-border ${tabletModeEnabled ? 'p-5 md:p-6' : 'p-6'}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground mb-2">Maintenance &amp; Service</h1>
            <p className="text-muted-foreground">
              Track maintenance schedules, MOT, tax, and service status across all fleet assets
            </p>
          </div>
        </div>
      </div>

      {/* Page-level tabs: Overview + Settings (managers/admins only) */}
      <Tabs value={activeTab} onValueChange={(v) => handlePageTabChange(v as 'overview' | 'settings')}>
        {canManage && (
          <TabsList className={tabletModeEnabled ? 'h-auto flex-wrap gap-2 p-1.5' : undefined}>
            <TabsTrigger value="overview" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <Wrench className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="settings" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="overview" className="space-y-6 mt-0">
          {showInitialMaintenanceLoading ? (
            <PanelLoader message="Loading maintenance..." accent="maintenance" className="min-h-[400px]" />
          ) : maintenanceError ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Wrench className="h-16 w-16 text-red-400 mb-4" />
                <h2 className="text-2xl font-semibold mb-2">Error Loading Maintenance Data</h2>
                <p className="text-gray-600 text-center max-w-md">
                  {maintenanceError?.message || 'Failed to load maintenance records'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {maintenanceLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Refreshing maintenance status...
                </div>
              )}
              {/* Asset type filter */}
              <div className={`flex ${tabletModeEnabled ? 'justify-start' : 'justify-end'}`}>
                <Tabs value={maintenanceFilter} onValueChange={(v) => handleMaintenanceFilterChange(v as 'both' | 'van' | 'hgv' | 'plant')}>
                  <TabsList className={tabletModeEnabled ? 'h-auto flex-wrap gap-2 p-1.5 justify-start' : undefined}>
                    <TabsTrigger value="both" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
                      <Wrench className="h-4 w-4" />
                      All Assets
                    </TabsTrigger>
                    <TabsTrigger value="van" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
                      <Truck className="h-4 w-4" />
                      Vans
                    </TabsTrigger>
                    <TabsTrigger value="plant" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
                      <HardHat className="h-4 w-4" />
                      Plant
                    </TabsTrigger>
                    <TabsTrigger value="hgv" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
                      <Truck className="h-4 w-4" />
                      HGVs
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <MaintenanceOverview
                vehicles={filteredMaintenance.vehicles}
                summary={filteredMaintenance.summary}
                onVehicleClick={handleVehicleClick}
              />
            </>
          )}
        </TabsContent>

        {canManage && (
          <TabsContent value="settings" className="space-y-6 mt-0">
            <MaintenanceSettings isAdmin={isAdmin} isManager={isManager} />
          </TabsContent>
        )}
      </Tabs>
    </AppPageShell>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<PageLoader message="Loading maintenance..." />}>
      <MaintenanceContent />
    </Suspense>
  );
}
