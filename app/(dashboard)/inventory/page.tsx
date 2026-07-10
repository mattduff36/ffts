'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { AlertTriangle, Archive, CheckCircle2, MapPin, PackageSearch, Plus, Settings, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { ChangeInventoryLocationDialog } from './components/ChangeInventoryLocationDialog';
import { InventoryCategoriesPanel } from './components/InventoryCategoriesPanel';
import { InventoryItemDialog } from './components/InventoryItemDialog';
import { InventoryEmployeeView } from './components/InventoryEmployeeView';
import { InventoryGroupsPanel } from './components/InventoryGroupsPanel';
import { InventoryLocationDialog } from './components/InventoryLocationDialog';
import { InventoryLocationsPanel } from './components/InventoryLocationsPanel';
import { InventoryRetireItemDialog } from './components/InventoryRetireItemDialog';
import {
  InventorySiteAssignmentsPanel,
  type InventorySiteAssignment,
  type InventorySiteAssignmentUser,
} from './components/InventorySiteAssignmentsPanel';
import { InventoryTable, type InventoryTableQuickFilter } from './components/InventoryTable';
import { MoveInventoryDialog } from './components/MoveInventoryDialog';
import {
  canSelectInventoryPrimaryLocation,
  checkIntervalMonthsToDays,
  getInventoryCheckStatus,
  isInventoryUnknownLocation,
} from './utils';
import type {
  FleetAssetOption,
  InventoryContext,
  InventoryItemGroup,
  InventoryItem,
  InventoryItemCategory,
  InventoryItemCategoryFormData,
  InventoryItemFormData,
  InventoryLocation,
  InventoryLocationFormData,
  InventoryMovePayload,
  InventoryRetireReason,
  InventoryCheckStatus,
} from './types';

interface ConfirmActionState {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => Promise<void>;
}

export default function InventoryPage() {
  const { hasPermission: canViewInventory, loading: permissionLoading } = usePermissionCheck('inventory', false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [retiredItems, setRetiredItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [fleetAssets, setFleetAssets] = useState<FleetAssetOption[]>([]);
  const [inventoryContext, setInventoryContext] = useState<InventoryContext | null>(null);
  const [siteAssignmentUsers, setSiteAssignmentUsers] = useState<InventorySiteAssignmentUser[]>([]);
  const [assignableSiteLocations, setAssignableSiteLocations] = useState<InventoryLocation[]>([]);
  const [siteAssignments, setSiteAssignments] = useState<InventorySiteAssignment[]>([]);
  const [groups, setGroups] = useState<InventoryItemGroup[]>([]);
  const [categories, setCategories] = useState<InventoryItemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [inventoryLoadError, setInventoryLoadError] = useState<string | null>(null);
  const [pageTab, setPageTab] = useState<'overview' | 'locations' | 'settings'>('overview');
  const [overviewTab, setOverviewTab] = useState<'small_tools' | 'minor_plant' | 'retired'>('small_tools');
  const [settingsTab, setSettingsTab] = useState<'categories' | 'groups'>('categories');
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [changeLocationDialogOpen, setChangeLocationDialogOpen] = useState(false);
  const [retiringItem, setRetiringItem] = useState<InventoryItem | null>(null);
  const [editingLocation, setEditingLocation] = useState<InventoryLocation | null>(null);
  const [movingItems, setMovingItems] = useState<InventoryItem[]>([]);
  const [restoringMinorPlantItems, setRestoringMinorPlantItems] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [inventoryTableQuickFilter, setInventoryTableQuickFilter] = useState<InventoryTableQuickFilter>({
    version: 0,
    statusFilters: [],
    locationFilters: [],
    search: '',
  });

  const fetchInventoryData = useCallback(async () => {
    try {
      const contextResponse = await fetch('/api/inventory/context', { cache: 'no-store' });
      const contextPayload = await contextResponse.json();
      if (!contextResponse.ok) {
        throw new Error(contextPayload.error || 'Failed to fetch inventory context');
      }

      const isManagerOrAdmin = contextPayload.is_manager_or_admin === true;
      const canManageSiteLocations = contextPayload.can_manage_site_locations === true;
      const [
        { items: inventoryItems },
        { items: retiredInventoryItems },
        locationsResponse,
        fleetAssetsResponse,
        categoriesResponse,
        groupsResponse,
        siteAssignmentsResponse,
      ] = await Promise.all([
        fetchAllPaginatedItems<InventoryItem>('/api/inventory', 'inventory', {
          limit: 500,
          errorMessage: 'Failed to fetch inventory items',
        }),
        isManagerOrAdmin
          ? fetchAllPaginatedItems<InventoryItem>('/api/inventory?status=retired', 'inventory', {
            limit: 500,
            errorMessage: 'Failed to fetch retired inventory items',
          })
          : Promise.resolve({ items: [] as InventoryItem[], firstPagePayload: null }),
        fetch('/api/inventory/locations', { cache: 'no-store' }),
        fetch('/api/inventory/fleet-assets', { cache: 'no-store' }),
        fetch('/api/inventory/categories', { cache: 'no-store' }),
        isManagerOrAdmin ? fetch('/api/inventory/groups', { cache: 'no-store' }) : Promise.resolve(null),
        canManageSiteLocations ? fetch('/api/inventory/site-assignments', { cache: 'no-store' }) : Promise.resolve(null),
      ]);

      const locationsPayload = await locationsResponse.json();
      if (!locationsResponse.ok) {
        throw new Error(locationsPayload.error || 'Failed to fetch inventory locations');
      }

      const fleetAssetsPayload = await fleetAssetsResponse.json();
      if (!fleetAssetsResponse.ok) {
        throw new Error(fleetAssetsPayload.error || 'Failed to fetch fleet assets');
      }

      const categoriesPayload = await categoriesResponse.json();
      if (!categoriesResponse.ok) {
        throw new Error(categoriesPayload.error || 'Failed to fetch inventory categories');
      }

      const groupsPayload = groupsResponse ? await groupsResponse.json() : { groups: [] };
      if (groupsResponse && !groupsResponse.ok) {
        throw new Error(groupsPayload.error || 'Failed to fetch inventory groups');
      }

      const siteAssignmentsPayload = siteAssignmentsResponse
        ? await siteAssignmentsResponse.json()
        : { active_sites: [], users: [], assignments: [] };
      if (siteAssignmentsResponse && !siteAssignmentsResponse.ok) {
        throw new Error(siteAssignmentsPayload.error || 'Failed to fetch Site assignments');
      }

      setInventoryContext(contextPayload);
      setItems(inventoryItems);
      setRetiredItems(retiredInventoryItems);
      setLocations(locationsPayload.locations || []);
      setFleetAssets(fleetAssetsPayload.assets || []);
      setCategories(categoriesPayload.categories || []);
      setGroups(groupsPayload.groups || []);
      setSiteAssignmentUsers(siteAssignmentsPayload.users || []);
      setAssignableSiteLocations(siteAssignmentsPayload.active_sites || []);
      setSiteAssignments(siteAssignmentsPayload.assignments || []);
      setInventoryLoadError(null);
    } catch (error) {
      console.error('Error fetching inventory data:', error);
      const errorMessage = getInventoryLoadErrorMessage(error);
      setInventoryLoadError(errorMessage);
      toast.error(errorMessage, { id: 'inventory-load-error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permissionLoading) return;
    if (!canViewInventory) {
      toast.error('Access denied', { id: 'inventory-access-denied' });
      router.push('/dashboard');
      return;
    }
    fetchInventoryData();
  }, [canViewInventory, fetchInventoryData, permissionLoading, router]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    const requestedSettings = searchParams.get('settings');
    const requestedOverview = searchParams.get('overview');

    if (requestedTab === 'locations') {
      setPageTab('locations');
      return;
    }

    if (requestedTab === 'groups' || requestedTab === 'categories') {
      setPageTab('settings');
      setSettingsTab(requestedTab);
      return;
    }

    if (requestedTab === 'settings') {
      if (requestedSettings === 'locations') {
        setPageTab('locations');
        return;
      }
      setPageTab('settings');
      if (requestedSettings === 'groups' || requestedSettings === 'categories') {
        setSettingsTab(requestedSettings);
      }
      return;
    }

    setPageTab('overview');
    setOverviewTab(requestedOverview === 'retired' ? 'retired' : requestedOverview === 'minor-plant' ? 'minor_plant' : 'small_tools');
  }, [searchParams]);

  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        if (item.status !== 'active') return acc;

        acc.total += 1;
        const status = getInventoryCheckStatus(item);
        if (status === 'overdue') acc.overdue += 1;
        if (status === 'due_soon') acc.dueSoon += 1;
        if (status === 'needs_check') acc.needsCheck += 1;
        if (isInventoryUnknownLocation(item.location)) acc.unknownLocation += 1;
        return acc;
      },
      {
        total: 0,
        overdue: 0,
        dueSoon: 0,
        needsCheck: 0,
        unknownLocation: 0,
      }
    );
  }, [items]);

  const categoryLabels = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.slug, category.name])),
    [categories]
  );

  const unknownLocation = useMemo(
    () => locations.find((location) => isInventoryUnknownLocation(location)) || null,
    [locations]
  );

  const primaryLocationOptions = useMemo(
    () => locations.filter((location) => canSelectInventoryPrimaryLocation(location, {
      currentLocationId: inventoryContext?.is_user_location_valid === false
        ? null
        : inventoryContext?.user_location?.location_id || null,
      teamId: inventoryContext?.team_id || null,
      teamName: inventoryContext?.team_name || null,
    })),
    [
      inventoryContext?.team_id,
      inventoryContext?.team_name,
      inventoryContext?.is_user_location_valid,
      inventoryContext?.user_location?.location_id,
      locations,
    ]
  );

  const smallToolsItems = useMemo(
    () => items.filter((item) => item.category !== 'minor_plant'),
    [items]
  );

  const minorPlantItems = useMemo(
    () => items.filter((item) => item.category === 'minor_plant'),
    [items]
  );

  function openInventoryOverviewForSummaryFilter() {
    const nextOverviewTab = overviewTab === 'retired' ? 'small_tools' : overviewTab;
    setPageTab('overview');
    setOverviewTab(nextOverviewTab);
    router.push(nextOverviewTab === 'minor_plant' ? '/inventory?overview=minor-plant' : '/inventory', { scroll: false });
  }

  function applyInventorySummaryFilter(params: {
    statusFilters?: InventoryCheckStatus[];
    locationFilters?: string[];
  }) {
    openInventoryOverviewForSummaryFilter();
    setSelectedItemIds(new Set());
    setInventoryTableQuickFilter((current) => ({
      version: current.version + 1,
      statusFilters: params.statusFilters || [],
      locationFilters: params.locationFilters || [],
      search: '',
    }));
  }

  function applyUnknownLocationFilter() {
    if (!unknownLocation) {
      toast.error('Unknown location is not available');
      return;
    }

    applyInventorySummaryFilter({ locationFilters: [unknownLocation.id] });
  }

  async function parseJsonResponse(response: Response, fallbackMessage: string) {
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || fallbackMessage);
      Object.assign(error, {
        status: response.status,
        payload,
      });
      throw error;
    }
    return payload;
  }

  function buildInventoryItemPayload(data: InventoryItemFormData) {
    const { check_interval_months: checkIntervalMonths, ...payload } = data;
    const intervalMonths = Number.parseInt(checkIntervalMonths, 10);
    return {
      ...payload,
      check_interval_days: checkIntervalMonthsToDays(
        Number.isFinite(intervalMonths) && intervalMonths > 0 ? intervalMonths : null
      ),
    };
  }

  async function handleCreateItem(data: InventoryItemFormData) {
    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInventoryItemPayload(data)),
    });
    await parseJsonResponse(response, 'Failed to create inventory item');
    toast.success('Inventory item added');
    await fetchInventoryData();
  }

  async function handleRetireItem(item: InventoryItem, reason: InventoryRetireReason) {
    const response = await fetch(`/api/inventory/${item.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retire_reason: reason }),
    });
    await parseJsonResponse(response, 'Failed to retire inventory item');
    toast.success('Inventory item retired', {
      description: `${item.item_number} moved to Retired Items.`,
    });
    setSelectedItemIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    setRetiringItem(null);
    await fetchInventoryData();
  }

  async function handleRestoreItem(item: InventoryItem) {
    const response = await fetch(`/api/inventory/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    await parseJsonResponse(response, 'Failed to restore inventory item');
    toast.success('Inventory item restored', {
      description: `${item.item_number} returned to active inventory.`,
    });
    await fetchInventoryData();
  }

  async function handleCreateLocation(data: InventoryLocationFormData) {
    const response = await fetch('/api/inventory/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to create inventory location');
    toast.success('Location added');
    await fetchInventoryData();
  }

  async function handleUpdateLocation(data: InventoryLocationFormData) {
    if (!editingLocation) return;
    const payload = editingLocation.location_type === 'manual'
      ? data
      : {
        name: data.name,
        description: data.description,
      };
    const response = await fetch(`/api/inventory/locations/${editingLocation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await parseJsonResponse(response, 'Failed to update inventory location');
    toast.success('Location updated');
    setEditingLocation(null);
    await fetchInventoryData();
  }

  async function handleRemoveLocation(location: InventoryLocation) {
    setConfirmAction({
      title: `Remove ${location.name}?`,
      description: 'Locations with active items cannot be removed. This also clears any users assigned to the location.',
      actionLabel: 'Remove Location',
      onConfirm: async () => {
        const response = await fetch(`/api/inventory/locations/${location.id}`, {
          method: 'DELETE',
        });
        await parseJsonResponse(response, 'Failed to remove inventory location');
        toast.success('Location removed');
        await fetchInventoryData();
      },
    });
  }

  async function handleMoveItems(payload: InventoryMovePayload) {
    await moveInventoryItems(movingItems, payload);
    setMovingItems([]);
    setSelectedItemIds(new Set());
  }

  async function moveInventoryItems(itemsToMove: InventoryItem[], payload: InventoryMovePayload) {
    const response = await fetch('/api/inventory/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_ids: itemsToMove.map((item) => item.id),
        location_id: payload.location_id,
        note: payload.note,
        scope: payload.scope || (itemsToMove.length > 1 ? 'bulk' : 'single'),
        group_id: payload.group_id || null,
      }),
    });
    const result = await parseJsonResponse(response, 'Failed to move inventory items');
    toast.success(result.moved_count === 1 ? 'Item moved' : `${result.moved_count} items moved`);
    await fetchInventoryData();
  }

  async function handleRestoreMinorPlantToPlant(itemsToRestore: InventoryItem[]) {
    if (itemsToRestore.length === 0) return;
    setConfirmAction({
      title: 'Move Minor Plant back to Plant assets?',
      description: `This will move ${itemsToRestore.length} Minor Plant item${itemsToRestore.length === 1 ? '' : 's'} back to the Plant asset table where possible.`,
      actionLabel: 'Move Items',
      onConfirm: async () => {
        setRestoringMinorPlantItems(true);
        try {
          const response = await fetch('/api/inventory/minor-plant/restore-to-plant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_ids: itemsToRestore.map((item) => item.id) }),
          });
          const result = await parseJsonResponse(response, 'Failed to move Minor Plant items back to Plant assets');
          toast.success('Minor Plant items moved to Plant assets', {
            description: `${result.restored_count || 0} moved${result.skipped_count ? `, ${result.skipped_count} skipped` : ''}.`,
          });
          if (result.skipped_count) {
            toast.warning('Some Minor Plant items were skipped', {
              description: 'Only items linked to a source Plant asset can be restored automatically.',
            });
          }
          setSelectedItemIds(new Set());
          await fetchInventoryData();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to move Minor Plant items back to Plant assets');
        } finally {
          setRestoringMinorPlantItems(false);
        }
      },
    });
  }

  async function handleSetUserLocation(locationId: string, changeReason?: string) {
    const response = await fetch('/api/inventory/me/location', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: locationId, change_reason: changeReason || null }),
    });
    await parseJsonResponse(response, 'Failed to update your inventory location');
    toast.success('Inventory location updated');
    await fetchInventoryData();
  }

  async function handleUnsetUserLocation() {
    const response = await fetch('/api/inventory/me/location', {
      method: 'DELETE',
    });
    await parseJsonResponse(response, 'Failed to unset your inventory location');
    toast.success('Inventory location unset');
    await fetchInventoryData();
  }

  async function handleRequestLocation(data: { suggested_name: string; note: string }) {
    const response = await fetch('/api/inventory/location-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to request inventory location');
    toast.success('Location request sent');
  }

  async function handleAssignSiteLocation({ userId, locationId }: { userId: string; locationId: string }) {
    const response = await fetch('/api/inventory/site-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, location_id: locationId }),
    });
    await parseJsonResponse(response, 'Failed to assign Site location');
    toast.success('Site location assigned');
    await fetchInventoryData();
  }

  async function handleRemoveSiteLocationAssignment({ userId, locationId }: { userId: string; locationId: string }) {
    const response = await fetch('/api/inventory/site-assignments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, location_id: locationId }),
    });
    await parseJsonResponse(response, 'Failed to remove Site location assignment');
    toast.success('Site location assignment removed');
    await fetchInventoryData();
  }

  function buildInventoryCategoryPayload(data: InventoryItemCategoryFormData) {
    const sortOrder = Number.parseInt(data.sort_order, 10);
    return {
      name: data.name,
      slug: data.slug,
      description: data.description,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    };
  }

  async function handleCreateCategory(data: InventoryItemCategoryFormData) {
    const response = await fetch('/api/inventory/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInventoryCategoryPayload(data)),
    });
    await parseJsonResponse(response, 'Failed to create inventory category');
    toast.success('Inventory category created');
    await fetchInventoryData();
  }

  async function handleUpdateCategory(category: InventoryItemCategory, data: InventoryItemCategoryFormData) {
    const response = await fetch(`/api/inventory/categories/${category.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInventoryCategoryPayload(data)),
    });
    await parseJsonResponse(response, 'Failed to update inventory category');
    toast.success('Inventory category updated');
    await fetchInventoryData();
  }

  async function handleRemoveCategory(category: InventoryItemCategory) {
    if ((category.item_count || 0) > 0) {
      toast.error('Move items to another category before deleting this category');
      return;
    }
    setConfirmAction({
      title: `Delete category ${category.name}?`,
      description: 'This removes the category from future inventory use.',
      actionLabel: 'Delete Category',
      onConfirm: async () => {
        const response = await fetch(`/api/inventory/categories/${category.id}`, {
          method: 'DELETE',
        });
        await parseJsonResponse(response, 'Failed to delete inventory category');
        toast.success('Inventory category deleted');
        await fetchInventoryData();
      },
    });
  }

  async function handleCreateGroup(data: { name: string; description: string; item_ids: string[] }) {
    const response = await fetch('/api/inventory/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to create inventory group');
    toast.success('Inventory group created');
    await fetchInventoryData();
  }

  async function handleUpdateGroup(group: InventoryItemGroup, data: { name: string; description: string; item_ids: string[] }) {
    const response = await fetch(`/api/inventory/groups/${group.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await parseJsonResponse(response, 'Failed to update inventory group');
    toast.success('Inventory group updated');
    await fetchInventoryData();
  }

  async function handleRemoveGroup(group: InventoryItemGroup) {
    setConfirmAction({
      title: `Remove group ${group.name}?`,
      description: 'Items will stay in their current locations.',
      actionLabel: 'Remove Group',
      onConfirm: async () => {
        const response = await fetch(`/api/inventory/groups/${group.id}`, {
          method: 'DELETE',
        });
        await parseJsonResponse(response, 'Failed to remove inventory group');
        toast.success('Inventory group removed');
        await fetchInventoryData();
      },
    });
  }

  if (permissionLoading || loading) {
    return <PageLoader message="Loading inventory..." />;
  }

  const isManagerOrAdmin = inventoryContext?.is_manager_or_admin === true;
  const employeeUserLocation = inventoryContext?.is_user_location_valid === false
    ? null
    : inventoryContext?.user_location || null;
  const employeeLocationName = employeeUserLocation?.location?.is_active === false
    ? null
    : employeeUserLocation?.location?.name || null;

  if (inventoryLoadError && !inventoryContext) {
    return (
      <AppPageShell width="wide">
        <InventoryDevelopmentBanner />

        <AppPageHeader
          title="Inventory"
          titleMeta={<InventoryBetaBadge />}
          description="Set your location, view assigned inventory, and claim or move items."
          icon={<PackageSearch className="h-5 w-5" />}
        />

        <div className="mx-auto max-w-2xl">
          <InventoryLoadErrorNotice message={inventoryLoadError} onRetry={fetchInventoryData} />
        </div>
      </AppPageShell>
    );
  }

  if (!isManagerOrAdmin) {
    return (
      <AppPageShell width="wide">
        <InventoryDevelopmentBanner />

        <AppPageHeader
          title="Inventory"
          titleMeta={<InventoryBetaBadge />}
          description={employeeLocationName ? `Current location: ${employeeLocationName}` : 'Set your location, view assigned inventory, and claim or move items.'}
          icon={<PackageSearch className="h-5 w-5" />}
          actions={employeeLocationName ? (
            <Button variant="outline" onClick={() => setChangeLocationDialogOpen(true)} className="border-slate-600">
              Change My Location
            </Button>
          ) : null}
        />

        {inventoryLoadError ? (
          <InventoryLoadErrorNotice message={inventoryLoadError} onRetry={fetchInventoryData} />
        ) : null}

        {inventoryContext?.can_manage_site_locations ? (
          <InventorySiteAssignmentsPanel
            users={siteAssignmentUsers}
            activeSites={assignableSiteLocations}
            assignments={siteAssignments}
            onAssign={handleAssignSiteLocation}
            onRemove={handleRemoveSiteLocationAssignment}
          />
        ) : null}

        <InventoryEmployeeView
          items={items}
          locations={primaryLocationOptions}
          categoryLabels={categoryLabels}
          userLocation={employeeUserLocation}
          secondarySiteLocations={inventoryContext?.secondary_site_locations || []}
          currentFleetAssignment={inventoryContext?.current_fleet_assignment || null}
          onSetUserLocation={handleSetUserLocation}
          onRequestLocation={handleRequestLocation}
          onOpenMoveDialog={setMovingItems}
          onChangeLocation={() => setChangeLocationDialogOpen(true)}
        />

        <MoveInventoryDialog
          open={movingItems.length > 0}
          items={movingItems}
          locations={locations}
          onClose={() => setMovingItems([])}
          onSubmit={handleMoveItems}
        />

        <ChangeInventoryLocationDialog
          open={changeLocationDialogOpen}
          locations={primaryLocationOptions}
          userLocation={employeeUserLocation}
          onClose={() => setChangeLocationDialogOpen(false)}
          onSubmit={({ locationId, reason }) => handleSetUserLocation(locationId, reason)}
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide">
      <InventoryDevelopmentBanner />

      <AppPageHeader
        title="Inventory"
        titleMeta={<InventoryBetaBadge />}
        description={employeeLocationName
          ? `Current location: ${employeeLocationName}`
          : 'Track small tools, plant, signs, equipment, locations, and check status.'
        }
        icon={<PackageSearch className="h-5 w-5" />}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setChangeLocationDialogOpen(true)}
              className="border-slate-600"
            >
              {employeeLocationName ? 'Change My Location' : 'Set My Location'}
            </Button>
            <Button
              onClick={() => setItemDialogOpen(true)}
              className="bg-inventory text-white hover:bg-inventory-dark"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        )}
      />

      {inventoryLoadError ? (
        <InventoryLoadErrorNotice message={inventoryLoadError} onRetry={fetchInventoryData} />
      ) : null}

      <div className="hidden grid-cols-5 gap-2 min-[430px]:grid lg:gap-4">
        <SummaryCard
          label="Active Items"
          value={summary.total}
          icon={<PackageSearch className="h-5 w-5" />}
          onClick={() => applyInventorySummaryFilter({})}
        />
        <SummaryCard
          label="Overdue"
          value={summary.overdue}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="danger"
          onClick={() => applyInventorySummaryFilter({ statusFilters: ['overdue'] })}
        />
        <SummaryCard
          label="Due Soon"
          value={summary.dueSoon}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="warning"
          onClick={() => applyInventorySummaryFilter({ statusFilters: ['due_soon'] })}
        />
        <SummaryCard
          label="Needs Check"
          value={summary.needsCheck}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="info"
          onClick={() => applyInventorySummaryFilter({ statusFilters: ['needs_check'] })}
        />
        <SummaryCard
          label="Unknown"
          value={summary.unknownLocation}
          icon={<Truck className="h-5 w-5" />}
          onClick={applyUnknownLocationFilter}
        />
      </div>

      <Tabs
        value={pageTab}
        onValueChange={(value) => {
          if (value === 'settings') {
            setPageTab('settings');
            router.push(`/inventory?tab=settings&settings=${settingsTab}`, { scroll: false });
            return;
          }
          if (value === 'locations') {
            setPageTab('locations');
            router.push('/inventory?tab=locations', { scroll: false });
            return;
          }
          setPageTab('overview');
              router.push(overviewTab === 'retired' ? '/inventory?overview=retired' : overviewTab === 'minor_plant' ? '/inventory?overview=minor-plant' : '/inventory', { scroll: false });
        }}
      >
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <PackageSearch className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-2">
            <MapPin className="h-4 w-4" />
            Locations
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {pageTab === 'settings' ? (
          <div className="mt-3 flex justify-end">
            <Tabs
              value={settingsTab}
              onValueChange={(value) => {
                const nextSettingsTab = value as 'categories' | 'groups';
                setSettingsTab(nextSettingsTab);
                router.push(`/inventory?tab=settings&settings=${nextSettingsTab}`, { scroll: false });
              }}
            >
              <TabsList>
                <TabsTrigger value="categories" className="gap-2">
                  <PackageSearch className="h-4 w-4" />
                  Categories
                </TabsTrigger>
                <TabsTrigger value="groups" className="gap-2">
                  <PackageSearch className="h-4 w-4" />
                  Groups
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <TabsContent value="overview" className="mt-0 space-y-6">
          <Tabs
            value={overviewTab}
            onValueChange={(value) => {
              const nextOverviewTab = value as 'small_tools' | 'minor_plant' | 'retired';
              setOverviewTab(nextOverviewTab);
              router.push(nextOverviewTab === 'retired' ? '/inventory?overview=retired' : nextOverviewTab === 'minor_plant' ? '/inventory?overview=minor-plant' : '/inventory', { scroll: false });
            }}
          >
            <div className="flex justify-end">
              <TabsList>
                <TabsTrigger value="small_tools" className="gap-2">
                  <PackageSearch className="h-4 w-4" />
                  Small Tools
                </TabsTrigger>
                <TabsTrigger value="minor_plant" className="gap-2">
                  <Truck className="h-4 w-4" />
                  Minor Plant
                </TabsTrigger>
                <TabsTrigger value="retired" className="gap-2">
                  <Archive className="h-4 w-4" />
                  Retired Items ({retiredItems.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="small_tools" className="mt-4">
              <InventoryTable
                key={`small-tools-${inventoryTableQuickFilter.version}`}
                items={smallToolsItems}
                selectedItemIds={selectedItemIds}
                onSelectedItemIdsChange={setSelectedItemIds}
                onDelete={setRetiringItem}
                onMove={setMovingItems}
                onOpenDetails={(item) => router.push('/inventory/items/' + item.id + '?fromTab=overview')}
                locationFilterLocations={locations}
                categoryLabels={categoryLabels}
                tableLabel="small tools"
                quickFilter={inventoryTableQuickFilter}
              />
            </TabsContent>

            <TabsContent value="minor_plant" className="mt-4">
              <InventoryTable
                key={`minor-plant-${inventoryTableQuickFilter.version}`}
                items={minorPlantItems}
                selectedItemIds={selectedItemIds}
                onSelectedItemIdsChange={setSelectedItemIds}
                onDelete={setRetiringItem}
                onMove={setMovingItems}
                onBulkAction={handleRestoreMinorPlantToPlant}
                bulkActionLabel={restoringMinorPlantItems ? 'Moving to Plant Assets...' : 'Move to Plant Assets'}
                onOpenDetails={(item) => router.push('/inventory/items/' + item.id + '?fromTab=overview&overview=minor-plant')}
                locationFilterLocations={locations}
                categoryLabels={categoryLabels}
                tableLabel="minor plant"
                showMinorPlantDetails
                quickFilter={inventoryTableQuickFilter}
              />
            </TabsContent>

            <TabsContent value="retired" className="mt-4">
              <InventoryTable
                items={retiredItems}
                selectedItemIds={new Set()}
                onSelectedItemIdsChange={() => {}}
                onMove={() => {}}
                onRestore={handleRestoreItem}
                onOpenDetails={(item) => router.push('/inventory/items/' + item.id + '?fromTab=overview&overview=retired')}
                locationFilterLocations={locations}
                categoryLabels={categoryLabels}
                tableLabel="retired inventory"
                showMinorPlantDetails={retiredItems.some((item) => item.category === 'minor_plant')}
                retiredMode
              />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="locations" className="mt-0 space-y-6">
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => { setEditingLocation(null); setLocationDialogOpen(true); }}
              className="border-slate-600"
            >
              <MapPin className="mr-2 h-4 w-4" />
              Add Location
            </Button>
          </div>
          {inventoryContext?.can_manage_site_locations ? (
            <InventorySiteAssignmentsPanel
              users={siteAssignmentUsers}
              activeSites={assignableSiteLocations}
              assignments={siteAssignments}
              onAssign={handleAssignSiteLocation}
              onRemove={handleRemoveSiteLocationAssignment}
            />
          ) : null}
          <InventoryLocationsPanel
            locations={locations}
            fleetAssets={fleetAssets}
            onEdit={(location) => { setEditingLocation(location); setLocationDialogOpen(true); }}
            onRemove={handleRemoveLocation}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 space-y-6">
          {settingsTab === 'categories' ? (
            <InventoryCategoriesPanel
              categories={categories}
              onCreate={handleCreateCategory}
              onUpdate={handleUpdateCategory}
              onRemove={handleRemoveCategory}
            />
          ) : null}

          {settingsTab === 'groups' ? (
            <InventoryGroupsPanel
              groups={groups}
              items={items}
              onCreate={handleCreateGroup}
              onUpdate={handleUpdateGroup}
              onRemove={handleRemoveGroup}
            />
          ) : null}
        </TabsContent>
      </Tabs>

      <InventoryItemDialog
        open={itemDialogOpen}
        locations={locations}
        categories={categories}
        onClose={() => setItemDialogOpen(false)}
        onSubmit={handleCreateItem}
      />

      <InventoryLocationDialog
        open={locationDialogOpen}
        location={editingLocation}
        fleetAssets={fleetAssets}
        onClose={() => { setLocationDialogOpen(false); setEditingLocation(null); }}
        onSubmit={editingLocation ? handleUpdateLocation : handleCreateLocation}
      />

      <InventoryRetireItemDialog
        open={Boolean(retiringItem)}
        item={retiringItem}
        onOpenChange={(open) => { if (!open) setRetiringItem(null); }}
        onRetire={handleRetireItem}
      />

      <MoveInventoryDialog
        open={movingItems.length > 0}
        items={movingItems}
        locations={locations}
        onClose={() => setMovingItems([])}
        onSubmit={handleMoveItems}
      />

      <InventoryConfirmActionDialog
        action={confirmAction}
        onClose={() => setConfirmAction(null)}
      />

      <ChangeInventoryLocationDialog
        open={changeLocationDialogOpen}
        locations={primaryLocationOptions}
        userLocation={employeeUserLocation}
        allowUnset
        onClose={() => setChangeLocationDialogOpen(false)}
        onSubmit={({ locationId, reason }) => handleSetUserLocation(locationId, reason)}
        onUnset={handleUnsetUserLocation}
      />
    </AppPageShell>
  );
}

interface InventoryConfirmActionDialogProps {
  action: ConfirmActionState | null;
  onClose: () => void;
}

function InventoryConfirmActionDialog({ action, onClose }: InventoryConfirmActionDialogProps) {
  const [isRunning, setIsRunning] = useState(false);

  async function handleConfirm() {
    if (!action) return;
    setIsRunning(true);
    try {
      await action.onConfirm();
      onClose();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <AlertDialog open={Boolean(action)} onOpenChange={(open) => { if (!open && !isRunning) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action?.title || 'Confirm action'}</AlertDialogTitle>
          <AlertDialogDescription>{action?.description || 'This action cannot be undone.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRunning}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => { event.preventDefault(); void handleConfirm(); }} disabled={isRunning}>
            {action?.actionLabel || 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function InventoryDevelopmentBanner() {
  return (
    <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-center text-xs font-medium text-amber-100 sm:text-sm">
      Inventory module is still in development.
    </div>
  );
}

function InventoryBetaBadge() {
  return (
    <Badge
      variant="outline"
      className="w-fit border-inventory/30 bg-inventory-soft px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-inventory"
    >
      Beta
    </Badge>
  );
}

function getInventoryLoadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';

  if (
    error instanceof TypeError ||
    message.toLowerCase().includes('failed to fetch') ||
    message.toLowerCase().includes('networkerror')
  ) {
    return 'Inventory is unavailable. Check your internet connection or try again shortly.';
  }

  return message || 'Failed to load inventory. Please try again.';
}

interface InventoryLoadErrorNoticeProps {
  message: string;
  onRetry: () => Promise<void>;
}

function InventoryLoadErrorNotice({ message, onRetry }: InventoryLoadErrorNoticeProps) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/10">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-300" />
          <div>
            <div className="font-medium text-amber-100">Inventory could not be loaded</div>
            <p className="mt-1 text-sm text-amber-100/80">
              {message}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => { void onRetry(); }}
          className="border-amber-400/40 text-amber-100 hover:bg-amber-500/10"
        >
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'info';
  onClick?: () => void;
}

function SummaryCard({ label, value, icon, tone = 'default', onClick }: SummaryCardProps) {
  const toneClassName = {
    default: 'text-inventory bg-inventory-soft',
    danger: 'text-red-300 bg-red-500/10',
    warning: 'text-amber-300 bg-amber-500/10',
    info: 'text-blue-300 bg-blue-500/10',
  }[tone];

  const card = (
    <Card className={`h-full border-slate-700 bg-slate-900/70 transition-colors ${onClick ? 'hover:border-slate-500 hover:bg-slate-800/70' : ''}`}>
      <CardContent className="flex min-h-[88px] flex-col items-start justify-center gap-2 p-2 min-[900px]:min-h-0 min-[900px]:flex-row min-[900px]:items-center min-[900px]:gap-3 min-[900px]:p-4">
        <div className={`rounded-lg p-1.5 min-[900px]:p-2 [&_svg]:h-4 [&_svg]:w-4 min-[900px]:[&_svg]:h-5 min-[900px]:[&_svg]:w-5 ${toneClassName}`}>
          {icon}
        </div>
        <div>
          <div className="text-xl font-bold text-white min-[900px]:text-2xl">{value}</div>
          <div className="text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground min-[900px]:text-xs">{label}</div>
        </div>
      </CardContent>
    </Card>
  );

  if (!onClick) return card;

  return (
    <button
      type="button"
      onClick={onClick}
      className="h-full w-full appearance-none rounded-lg border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      aria-label={`Filter inventory by ${label}`}
    >
      {card}
    </button>
  );
}
