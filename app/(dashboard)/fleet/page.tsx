'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wrench, Truck, Settings, HardHat, Plus } from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { PanelLoader } from '@/components/ui/panel-loader';

// Dynamic import for PlantTable
const PlantTable = dynamic(
  () => import('@/app/(dashboard)/maintenance/components/PlantTable').then(mod => ({ default: mod.PlantTable })),
  { 
    loading: () => <PanelLoader message="Loading plant table..." accent="fleet" className="p-12" />,
    ssr: false
  }
);

// Import existing components
import { MaintenanceTable } from '@/app/(dashboard)/maintenance/components/MaintenanceTable';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import { toast } from 'sonner';
import { FleetSettingsTab } from './components/FleetSettingsTab';
import { FleetCategoryDialogs } from './components/FleetCategoryDialogs';
import { AddAssetFlowDialog } from '@/app/(dashboard)/maintenance/components/add-asset/AddAssetFlowDialog';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import type { Category, HgvAsset, HgvCategory, PlantAsset, Vehicle } from './types';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { getErrorMessage } from '@/lib/utils/absence-error-handling';

function isExpectedFleetLoadError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    isAuthErrorStatus(status) ||
    isNetworkFetchError(error) ||
    message.includes('unauthorized') ||
    message.includes('not authenticated')
  );
}

function FleetContent() {
  const searchParams = useSearchParams();
  const router = useNextRouter();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canViewFleet, loading: fleetPermissionLoading } = usePermissionCheck('admin-vans', false);
  const supabase = useBrowserSupabaseClient();
  const { tabletModeEnabled } = useTabletMode();
  
  // Two-level tab state matching Maintenance/Workshop pages
  const [pageTab, setPageTab] = useState<'overview' | 'settings'>('overview');
  const [assetTab, setAssetTab] = useState<'vans' | 'plant' | 'hgvs'>('vans');
  
  // Vehicle Category Dialog States
  const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false);
  const [editCategoryDialogOpen, setEditCategoryDialogOpen] = useState(false);
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  
  // Header-level Add Asset dialog
  const [headerAddAssetOpen, setHeaderAddAssetOpen] = useState(false);

  // HGV Category Dialog States
  const [addHgvCategoryDialogOpen, setAddHgvCategoryDialogOpen] = useState(false);
  const [editHgvCategoryDialogOpen, setEditHgvCategoryDialogOpen] = useState(false);
  const [deleteHgvCategoryDialogOpen, setDeleteHgvCategoryDialogOpen] = useState(false);
  const [selectedHgvCategory, setSelectedHgvCategory] = useState<HgvCategory | null>(null);
  const [deletingHgvCategory, setDeletingHgvCategory] = useState(false);
  
  const validAssetTabs = useMemo(() => ['vans', 'plant', 'hgvs'] as const, []);
  
  // Validate and set tabs based on URL
  useEffect(() => {
    if (authLoading) return;
    
    const requestedTab = searchParams.get('tab') || 'vans';
    
    // Legacy redirects
    if (requestedTab === 'maintenance') {
      router.replace('/maintenance');
      return;
    }
    if (requestedTab === 'vehicles') {
      router.replace('/fleet?tab=vans', { scroll: false });
      return;
    }
    
    if (requestedTab === 'settings') {
      if (isAdmin || isManager) {
        setPageTab('settings');
      } else {
        setPageTab('overview');
        setAssetTab('vans');
        router.replace('/fleet?tab=vans', { scroll: false });
      }
    } else if ((validAssetTabs as readonly string[]).includes(requestedTab)) {
      setPageTab('overview');
      setAssetTab(requestedTab as 'vans' | 'plant' | 'hgvs');
    } else {
      setAssetTab('vans');
      setPageTab('overview');
      router.push('/fleet?tab=vans', { scroll: false });
    }
  }, [searchParams, authLoading, isManager, isAdmin, router, validAssetTabs]);
  // Fetch maintenance data
  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError } = useMaintenance();
  
  // State for vehicles and categories
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [plantAssets, setPlantAssets] = useState<PlantAsset[]>([]); // Separate state for plant assets
  const [plantAssetsLoading, setPlantAssetsLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  
  // State for collapsible category sections
  const [plantCategoriesExpanded, setPlantCategoriesExpanded] = useState(false);
  const [vanCategoriesExpanded, setVanCategoriesExpanded] = useState(false);
  const [hgvCategoriesExpanded, setHgvCategoriesExpanded] = useState(false);
  
  // HGV categories and assets state
  const [hgvCategories, setHgvCategories] = useState<HgvCategory[]>([]);
  const [hgvCategoriesLoading, setHgvCategoriesLoading] = useState(false);
  const [hgvAssets, setHgvAssets] = useState<HgvAsset[]>([]);
  const [hgvAssetsLoading, setHgvAssetsLoading] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch vehicles
  const fetchVehicles = async () => {
    setVehiclesLoading(true);
    try {
      const response = await fetch('/api/admin/vans');
      const data = await response.json();
      if (response.ok) {
        setVehicles(data.vehicles || []);
      }
    } catch (error) {
      if (isExpectedFleetLoadError(error)) {
        setVehicles([]);
      } else {
        logger.error('Failed to fetch vehicles', error, 'FleetPage');
      }
    } finally {
      setVehiclesLoading(false);
    }
  };

  // Fetch plant assets
  const fetchPlantAssets = async () => {
    if (!supabase || authLoading || fleetPermissionLoading || !canViewFleet) return;
    setPlantAssetsLoading(true);
    try {
      const { data, error } = await supabase
        .from('plant')
        .select('id, plant_id, nickname, status, category_id, van_categories(name, id)')
        .eq('status', 'active');
      
      if (error) throw error;
      setPlantAssets((data || []).map((asset) => ({
        ...asset,
        status: asset.status || 'active',
      })));
    } catch (error) {
      if (isExpectedFleetLoadError(error)) {
        setPlantAssets([]);
      } else {
        logger.error('Failed to fetch plant assets', error, 'FleetPage');
      }
    } finally {
      setPlantAssetsLoading(false);
    }
  };

  // Fetch HGV categories
  const fetchHgvCategories = async () => {
    try {
      setHgvCategoriesLoading(true);
      const response = await fetch('/api/admin/hgv-categories');
      const data = await response.json();
      if (response.ok) {
        setHgvCategories(data.categories || []);
      }
    } catch (error) {
      if (isExpectedFleetLoadError(error)) {
        setHgvCategories([]);
      } else {
        logger.error('Failed to fetch HGV categories', error, 'FleetPage');
      }
    } finally {
      setHgvCategoriesLoading(false);
    }
  };

  // Fetch HGV assets
  const fetchHgvAssets = async () => {
    if (!supabase || authLoading || fleetPermissionLoading || !canViewFleet) return;
    setHgvAssetsLoading(true);
    try {
      const { data, error } = await supabase
        .from('hgvs')
        .select('id, reg_number, nickname, status, category_id, hgv_categories(name, id)')
        .eq('status', 'active')
        .order('reg_number', { ascending: true });

      if (error) throw error;
      setHgvAssets((data || []).map((asset) => ({
        ...asset,
        status: asset.status || 'active',
      })));
    } catch (error) {
      if (isExpectedFleetLoadError(error)) {
        setHgvAssets([]);
      } else {
        logger.error('Failed to fetch HGV assets', error, 'FleetPage');
      }
    } finally {
      setHgvAssetsLoading(false);
    }
  };

  // Fetch categories
  const fetchCategories = async () => {
    try {
      setCategoriesLoading(true);
      const response = await fetch('/api/admin/categories');
      const data = await response.json();
      if (response.ok) {
        setCategories(data.categories || []);
      }
    } catch (error) {
      if (isExpectedFleetLoadError(error)) {
        setCategories([]);
      } else {
        logger.error('Failed to fetch categories', error, 'FleetPage');
      }
    } finally {
      setCategoriesLoading(false);
    }
  };

  // Fetch data on initial load based on active tab from URL
  useEffect(() => {
    if (authLoading || fleetPermissionLoading || !canViewFleet) {
      return;
    }

    if (pageTab === 'settings') {
      if (categories.length === 0) fetchCategories();
      if (vehicles.length === 0) fetchVehicles();
      if (plantAssets.length === 0) fetchPlantAssets();
      if (hgvCategories.length === 0) fetchHgvCategories();
      if (hgvAssets.length === 0) fetchHgvAssets();
    } else if (assetTab === 'plant') {
      if (plantAssets.length === 0) fetchPlantAssets();
    } else if (assetTab === 'vans') {
      if (vehicles.length === 0) fetchVehicles();
      if (categories.length === 0) fetchCategories();
    } else if (assetTab === 'hgvs') {
      if (hgvAssets.length === 0) fetchHgvAssets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab, assetTab, authLoading, fleetPermissionLoading, canViewFleet]);
  
  const handlePageTabChange = (value: string) => {
    const v = value as 'overview' | 'settings';
    setPageTab(v);
    if (v === 'settings') {
      router.push('/fleet?tab=settings', { scroll: false });
      if (categories.length === 0) fetchCategories();
      if (vehicles.length === 0) fetchVehicles();
      if (plantAssets.length === 0) fetchPlantAssets();
      if (hgvCategories.length === 0) fetchHgvCategories();
      if (hgvAssets.length === 0) fetchHgvAssets();
    } else {
      router.push(`/fleet?tab=${assetTab}`, { scroll: false });
    }
  };

  const handleAssetTabChange = (value: string) => {
    const v = value as 'vans' | 'plant' | 'hgvs';
    setAssetTab(v);
    router.push(`/fleet?tab=${v}`, { scroll: false });

    if (v === 'plant') {
      if (plantAssets.length === 0) fetchPlantAssets();
    } else if (v === 'vans') {
      if (vehicles.length === 0) fetchVehicles();
      if (categories.length === 0) fetchCategories();
    } else if (v === 'hgvs') {
      if (hgvAssets.length === 0) fetchHgvAssets();
    }
  };
  // Vehicle Category Dialog Handlers
  const openEditCategoryDialog = (category: Category) => {
    setSelectedCategory(category);
    setEditCategoryDialogOpen(true);
  };
  
  const openDeleteCategoryDialog = (category: Category) => {
    setSelectedCategory(category);
    setDeleteCategoryDialogOpen(true);
  };
  
  const handleDeleteCategory = async () => {
    if (!selectedCategory) return;
    
    setDeletingCategory(true);
    
    try {
      const response = await fetch(`/api/admin/categories/${selectedCategory.id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete category');
      }
      
      toast.success('Category deleted successfully');
      setDeleteCategoryDialogOpen(false);
      setSelectedCategory(null);
      fetchCategories(); // Refresh categories
    } catch (error: unknown) {
      const errorContextId = 'fleet-delete-van-category-error';
      console.error('Error deleting category:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to delete category', { id: errorContextId });
    } finally {
      setDeletingCategory(false);
    }
  };
  
  const handleCategorySuccess = () => {
    fetchCategories();
  };
  
  // HGV Category Dialog Handlers
  const openEditHgvCategoryDialog = (category: HgvCategory) => {
    setSelectedHgvCategory(category);
    setEditHgvCategoryDialogOpen(true);
  };
  
  const openDeleteHgvCategoryDialog = (category: HgvCategory) => {
    setSelectedHgvCategory(category);
    setDeleteHgvCategoryDialogOpen(true);
  };
  
  const handleDeleteHgvCategory = async () => {
    if (!selectedHgvCategory) return;
    
    setDeletingHgvCategory(true);
    
    try {
      const response = await fetch(`/api/admin/hgv-categories/${selectedHgvCategory.id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete HGV category');
      }
      
      toast.success('HGV category deleted successfully');
      setDeleteHgvCategoryDialogOpen(false);
      setSelectedHgvCategory(null);
      fetchHgvCategories();
    } catch (error: unknown) {
      const errorContextId = 'fleet-delete-hgv-category-error';
      console.error('Error deleting HGV category:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to delete HGV category', { id: errorContextId });
    } finally {
      setDeletingHgvCategory(false);
    }
  };
  
  const handleHgvCategorySuccess = () => {
    fetchHgvCategories();
  };
  
  // Show loading while auth or permissions are being checked
  if (!supabase || authLoading || fleetPermissionLoading) {
    return <PageLoader message="Loading fleet..." />;
  }
  
  // Show access denied if no permission
  if (!canViewFleet) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-gray-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
            <p className="text-gray-600 text-center max-w-md">
              You don&apos;t have permission to access the Fleet module. Please contact your manager.
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
            <h1 className="text-3xl font-bold text-foreground mb-2">Fleet Management</h1>
            <p className="text-muted-foreground">
              Manage vans, HGVs, plant machinery, and fleet operations
            </p>
          </div>
          <Button
            className={`w-full bg-fleet hover:bg-fleet-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg sm:w-auto ${tabletModeEnabled ? 'min-h-11 text-base px-4 [&_svg]:size-5' : ''}`}
            onClick={() => setHeaderAddAssetOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Asset
          </Button>
        </div>
      </div>

      <Tabs value={pageTab} onValueChange={handlePageTabChange}>
        {(isAdmin || isManager) && (
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
          <div className={`flex ${tabletModeEnabled ? 'justify-start' : 'justify-end'}`}>
            <Tabs value={assetTab} onValueChange={handleAssetTabChange}>
              <TabsList className={tabletModeEnabled ? 'h-auto flex-wrap gap-2 p-1.5 justify-start' : undefined}>
                <TabsTrigger value="vans" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
                  <Truck className="h-4 w-4" />
                  Vans
                </TabsTrigger>
                <TabsTrigger value="plant" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
                  <HardHat className="h-4 w-4" />
                  Plant
                </TabsTrigger>
                <TabsTrigger value="hgvs" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
                  <Truck className="h-4 w-4" />
                  HGVs
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Plant content */}
          {assetTab === 'plant' && (
            <div className="space-y-6">
          {maintenanceLoading || (plantAssetsLoading && plantAssets.length === 0) ? (
            <PanelLoader message="Loading plant assets..." accent="fleet" className="min-h-[400px]" />
          ) : maintenanceError ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <HardHat className="h-16 w-16 text-red-400 mb-4" />
                <h2 className="text-2xl font-semibold mb-2">Error Loading Plant Data</h2>
                <p className="text-gray-600 text-center max-w-md">
                  {maintenanceError?.message || 'Failed to load plant machinery records'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <PlantTable 
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onVehicleAdded={fetchPlantAssets}
            />
          )}
            </div>
          )}

          {/* Vans content */}
          {assetTab === 'vans' && (
            <div className="space-y-6">
              {maintenanceLoading || (vehiclesLoading && vehicles.length === 0) ? (
                <PanelLoader message="Loading vans..." accent="fleet" className="min-h-[400px]" />
              ) : maintenanceError ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Wrench className="h-16 w-16 text-red-400 mb-4" />
                    <h2 className="text-2xl font-semibold mb-2">Error Loading Van Data</h2>
                    <p className="text-gray-600 text-center max-w-md">
                      {maintenanceError?.message || 'Failed to load van records'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <MaintenanceTable 
                  vehicles={(maintenanceData?.vehicles || []).filter(v => v.vehicle?.asset_type === 'van')}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onVehicleAdded={() => {}}
                />
              )}
            </div>
          )}

          {/* HGVs content */}
          {assetTab === 'hgvs' && (
            <div className="space-y-6">
              {maintenanceLoading || (hgvAssetsLoading && hgvAssets.length === 0) ? (
                <PanelLoader message="Loading HGVs..." accent="fleet" className="min-h-[400px]" />
              ) : maintenanceError ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Truck className="h-16 w-16 text-red-400 mb-4" />
                    <h2 className="text-2xl font-semibold mb-2">Error Loading HGV Data</h2>
                    <p className="text-gray-600 text-center max-w-md">
                      {maintenanceError?.message || 'Failed to load HGV records'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <MaintenanceTable 
                  vehicles={(maintenanceData?.vehicles || []).filter(v => v.vehicle?.asset_type === 'hgv')}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onVehicleAdded={() => {}}
                  assetLabel="HGV"
                />
              )}
            </div>
          )}
        </TabsContent>

        <FleetSettingsTab
          isAdmin={isAdmin}
          isManager={isManager}
          categories={categories}
          categoriesLoading={categoriesLoading}
          vehicles={vehicles}
          vehiclesLoading={vehiclesLoading}
          plantAssets={plantAssets}
          plantAssetsLoading={plantAssetsLoading}
          hgvCategories={hgvCategories}
          hgvCategoriesLoading={hgvCategoriesLoading}
          hgvAssets={hgvAssets}
          hgvAssetsLoading={hgvAssetsLoading}
          plantCategoriesExpanded={plantCategoriesExpanded}
          vanCategoriesExpanded={vanCategoriesExpanded}
          hgvCategoriesExpanded={hgvCategoriesExpanded}
          onPlantCategoriesExpandedChange={setPlantCategoriesExpanded}
          onVanCategoriesExpandedChange={setVanCategoriesExpanded}
          onHgvCategoriesExpandedChange={setHgvCategoriesExpanded}
          onAddCategory={() => setAddCategoryDialogOpen(true)}
          onEditCategory={openEditCategoryDialog}
          onDeleteCategory={openDeleteCategoryDialog}
          onAddHgvCategory={() => setAddHgvCategoryDialogOpen(true)}
          onEditHgvCategory={openEditHgvCategoryDialog}
          onDeleteHgvCategory={openDeleteHgvCategoryDialog}
        />
      </Tabs>

      <AddAssetFlowDialog
        open={headerAddAssetOpen}
        onOpenChange={setHeaderAddAssetOpen}
        onSuccess={() => {
          setHeaderAddAssetOpen(false);
          if (assetTab === 'vans') fetchVehicles();
          else if (assetTab === 'plant') fetchPlantAssets();
          else if (assetTab === 'hgvs') fetchHgvAssets();
        }}
      />

      <FleetCategoryDialogs
        addCategoryDialogOpen={addCategoryDialogOpen}
        editCategoryDialogOpen={editCategoryDialogOpen}
        deleteCategoryDialogOpen={deleteCategoryDialogOpen}
        selectedCategory={selectedCategory}
        deletingCategory={deletingCategory}
        onAddCategoryDialogOpenChange={setAddCategoryDialogOpen}
        onEditCategoryDialogOpenChange={setEditCategoryDialogOpen}
        onDeleteCategoryDialogOpenChange={setDeleteCategoryDialogOpen}
        onCategorySuccess={handleCategorySuccess}
        onDeleteCategory={handleDeleteCategory}
        addHgvCategoryDialogOpen={addHgvCategoryDialogOpen}
        editHgvCategoryDialogOpen={editHgvCategoryDialogOpen}
        deleteHgvCategoryDialogOpen={deleteHgvCategoryDialogOpen}
        selectedHgvCategory={selectedHgvCategory}
        deletingHgvCategory={deletingHgvCategory}
        onAddHgvCategoryDialogOpenChange={setAddHgvCategoryDialogOpen}
        onEditHgvCategoryDialogOpenChange={setEditHgvCategoryDialogOpen}
        onDeleteHgvCategoryDialogOpenChange={setDeleteHgvCategoryDialogOpen}
        onHgvCategorySuccess={handleHgvCategorySuccess}
        onDeleteHgvCategory={handleDeleteHgvCategory}
      />
    </AppPageShell>
  );
}

export default function FleetPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading fleet..." />}>
      <FleetContent />
    </Suspense>
  );
}
