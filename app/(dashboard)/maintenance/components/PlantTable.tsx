'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Search, 
  History,
  Loader2,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Settings2,
  Monitor,
  FolderClock
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AddAssetFlowDialog } from './add-asset/AddAssetFlowDialog';
import { getStatusColorClass } from '@/lib/utils/maintenanceCalculations';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PanelLoader } from '@/components/ui/panel-loader';
import { toast } from 'sonner';
import { Undo2, XCircle } from 'lucide-react';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { cn } from '@/lib/utils/cn';
import { useMaintenance } from '@/lib/hooks/useMaintenance';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import type { MaintenanceItem } from '@/types/maintenance';

type PlantAsset = {
  id: string;
  plant_id: string;
  reg_number: string | null;
  nickname: string | null;
  serial_number: string | null;
  loler_due_date: string | null;
  current_hours: number | null;
  status: string;
  retired_at: string | null;
  retire_reason: string | null;
  van_categories?: { name: string; id: string } | null;
};

type PlantMaintenanceWithStatus = {
  plant_id: string; // Human-readable identifier (P001, P002, etc.)
  plant: PlantAsset;
  current_hours: number | null;
  next_service_hours: number | null;
  maintenance_items?: MaintenanceItem[];
};

interface PlantTableProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onVehicleAdded?: () => void;
}

type SortField = 'plant_id' | 'nickname' | 'serial_number' | 'category' | 'current_hours' | `category:${string}`;
type SortDirection = 'asc' | 'desc';

interface ColumnVisibility {
  nickname: boolean;
  serial_number: boolean;
  category: boolean;
  current_hours: boolean;
  [categoryColumnId: string]: boolean;
}

export function PlantTable({ 
  searchQuery, 
  onSearchChange,
  onVehicleAdded
}: PlantTableProps) {
  const router = useRouter();
  const { tabletModeEnabled } = useTabletMode();
  const { data: maintenanceData, isLoading: maintenanceLoading, refetch: refetchMaintenance } = useMaintenance();
  // ✅ Create supabase client using useMemo to avoid recreating on every render
  const supabase = useMemo(() => createClient(), []);
  const [sortField, setSortField] = useState<SortField>('plant_id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [activePlantAssets, setActivePlantAssets] = useState<PlantMaintenanceWithStatus[]>([]);
  const [retiredPlantAssets, setRetiredPlantAssets] = useState<PlantAsset[]>([]);
  const [retiredPlantCount, setRetiredPlantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [retiredSearchQuery, setRetiredSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [selectedPlantIds, setSelectedPlantIds] = useState<Set<string>>(new Set());
  const [movingToMinorPlant, setMovingToMinorPlant] = useState(false);
  
  // Column visibility defaults - category hidden by default
  const defaultVisibility: ColumnVisibility = {
    nickname: true,
    serial_number: true,
    category: false,
    current_hours: true,
  };

  // Initialise with defaults; useEffect below will hydrate from localStorage
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultVisibility);

  // On mount, load saved preferences from localStorage (safe for SSR)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('plant-table-column-visibility');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ColumnVisibility>;
        // Merge with defaults so any newly-added columns get their default value
        setColumnVisibility(prev => ({ ...prev, ...parsed } as ColumnVisibility));
      }
    } catch (e) {
      console.error('Failed to parse saved column visibility:', e);
    }
  }, []);

  // Persist column visibility changes to localStorage
  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => {
      const newVisibility = {
        ...prev,
        [column]: !prev[column]
      };
      localStorage.setItem('plant-table-column-visibility', JSON.stringify(newVisibility));
      return newVisibility;
    });
  };

  const fetchPlantData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch retired plant assets
      const { data: retiredData, error: retiredError } = await supabase
        .from('plant')
        .select(`
          *,
          van_categories (
            id,
            name
          )
        `)
        .eq('status', 'retired')
        .order('updated_at', { ascending: false });

      if (retiredError) {
        const status = getErrorStatus(retiredError);
        if (isNetworkFetchError(retiredError)) {
          console.warn('Retired plant temporarily unavailable:', retiredError);
        } else if (!isAuthErrorStatus(status)) {
          console.error('Error fetching retired plant assets:', retiredError);
        }
        if (!isAuthErrorStatus(status)) {
          toast.error('Unable to load retired plant', {
            description: 'Retired plant data may be incomplete. Please refresh.',
          });
        }
      } else {
        setRetiredPlantAssets((retiredData || []).map((asset) => ({
          ...asset,
          status: asset.status || 'retired',
        })));
        setRetiredPlantCount(retiredData?.length || 0);
      }
    } catch (error) {
      if (isNetworkFetchError(error)) {
        console.warn('Plant assets temporarily unavailable:', error);
      } else if (!isAuthErrorStatus(getErrorStatus(error))) {
        console.error('Error fetching plant assets:', error);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Fetch plant assets from the plant table
  useEffect(() => {
    fetchPlantData();
  }, [fetchPlantData]);

  useEffect(() => {
    const plantAssets = (maintenanceData?.vehicles || [])
      .filter(vehicle => vehicle.vehicle?.asset_type === 'plant')
      .map((vehicle): PlantMaintenanceWithStatus => ({
        plant_id: vehicle.vehicle?.plant_id || 'Unknown',
        plant: {
          id: vehicle.plant_id || vehicle.vehicle?.id || vehicle.id,
          plant_id: vehicle.vehicle?.plant_id || 'Unknown',
          reg_number: vehicle.vehicle?.reg_number || null,
          nickname: vehicle.vehicle?.nickname || null,
          serial_number: vehicle.vehicle?.serial_number || null,
          loler_due_date: vehicle.loler_due_date || null,
          current_hours: vehicle.current_hours || null,
          status: vehicle.vehicle?.status || 'active',
          retired_at: null,
          retire_reason: null,
          van_categories: null,
        },
        current_hours: vehicle.current_hours || null,
        next_service_hours: vehicle.next_service_hours || null,
        maintenance_items: vehicle.maintenance_items || [],
      }));

    setActivePlantAssets(plantAssets);
  }, [maintenanceData]);

  const isLoading = loading || maintenanceLoading;

  const maintenanceColumns = useMemo(() => {
    const columnsByCategoryId = new Map<string, MaintenanceItem>();

    activePlantAssets.forEach(asset => {
      (asset.maintenance_items || []).forEach(item => {
        if (!columnsByCategoryId.has(item.category_id)) {
          columnsByCategoryId.set(item.category_id, item);
        }
      });
    });

    return Array.from(columnsByCategoryId.values())
      .sort((a, b) => a.sort_order - b.sort_order || a.category_name.localeCompare(b.category_name));
  }, [activePlantAssets]);

  useEffect(() => {
    setColumnVisibility(prev => {
      const next: ColumnVisibility = {
        nickname: prev.nickname ?? true,
        serial_number: prev.serial_number ?? true,
        category: prev.category ?? false,
        current_hours: prev.current_hours ?? true,
      };

      maintenanceColumns.forEach(column => {
        next[`category:${column.category_id}`] = prev[`category:${column.category_id}`] ?? true;
      });

      localStorage.setItem('plant-table-column-visibility', JSON.stringify(next));
      return next;
    });
  }, [maintenanceColumns]);

  // Filter based on search before pagination so matches can come from any page.
  const filteredPlant = useMemo(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    if (!query) return activePlantAssets;

    return activePlantAssets.filter(asset => {
      const searchableValues = [
        asset.plant?.plant_id,
        asset.plant?.reg_number,
        asset.plant?.nickname,
        asset.plant?.serial_number,
        asset.plant?.van_categories?.name,
        asset.current_hours?.toString(),
        ...(asset.maintenance_items || []).flatMap((item) => [
          item.category_name,
          item.display_value,
          item.due_date,
          item.due_mileage?.toString(),
          item.due_hours?.toString(),
        ]),
      ];

      return searchableValues.some((value) => value?.toLowerCase().includes(query));
    });
  }, [activePlantAssets, debouncedSearchQuery]);

  // Sort
  const sortedPlant = [...filteredPlant].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    switch (sortField) {
      case 'plant_id':
        return multiplier * (a.plant?.plant_id || '').localeCompare(b.plant?.plant_id || '');
      
      case 'nickname':
        return multiplier * (a.plant?.nickname || '').localeCompare(b.plant?.nickname || '');
      
      case 'serial_number':
        return multiplier * (a.plant?.serial_number || '').localeCompare(b.plant?.serial_number || '');
      
      case 'category':
        return multiplier * (a.plant?.van_categories?.name || '').localeCompare(b.plant?.van_categories?.name || '');
      
      case 'current_hours':
        return multiplier * ((a.current_hours || 0) - (b.current_hours || 0));
      
      default:
        if (sortField.startsWith('category:')) {
          const categoryId = sortField.replace('category:', '');
          const getSortValue = (item?: MaintenanceItem) => {
            if (!item) return Number.POSITIVE_INFINITY;
            if (item.category_type === 'date') return item.due_date ? new Date(item.due_date).getTime() : Number.POSITIVE_INFINITY;
            if (item.category_type === 'hours') return item.due_hours ?? Number.POSITIVE_INFINITY;
            return item.due_mileage ?? Number.POSITIVE_INFINITY;
          };

          return multiplier * (
            getSortValue(a.maintenance_items?.find(item => item.category_id === categoryId))
            - getSortValue(b.maintenance_items?.find(item => item.category_id === categoryId))
          );
        }

        return 0;
    }
  });
  const paginationKey = [
    debouncedSearchQuery.trim(),
    sortField,
    sortDirection,
    sortedPlant.length,
  ].join(':');
  const {
    visibleItems: visiblePlant,
    showMore,
  } = useLoadMorePagination(sortedPlant, { resetKey: paginationKey });

  const visiblePlantIds = useMemo(
    () => visiblePlant.map((asset) => asset.plant.id),
    [visiblePlant]
  );
  const allVisiblePlantSelected = visiblePlantIds.length > 0 && visiblePlantIds.every((plantId) => selectedPlantIds.has(plantId));

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleViewHistory = (plantId: string) => {
    router.push(`/fleet/plant/${plantId}/history?fromTab=plant`);
  };

  const togglePlantSelected = (plantId: string, checked: boolean) => {
    setSelectedPlantIds((current) => {
      const next = new Set(current);
      if (checked) next.add(plantId);
      else next.delete(plantId);
      return next;
    });
  };

  const toggleVisiblePlantSelected = (checked: boolean) => {
    setSelectedPlantIds((current) => {
      const next = new Set(current);
      visiblePlantIds.forEach((plantId) => {
        if (checked) next.add(plantId);
        else next.delete(plantId);
      });
      return next;
    });
  };

  const handleMoveSelectedToMinorPlant = async () => {
    const plantIds = Array.from(selectedPlantIds);
    if (plantIds.length === 0) return;
    if (!confirm(`Move ${plantIds.length} selected Plant asset${plantIds.length === 1 ? '' : 's'} to Minor Plant inventory?`)) return;

    setMovingToMinorPlant(true);
    try {
      const response = await fetch('/api/inventory/minor-plant/move-from-plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plant_ids: plantIds }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to move Plant assets to Minor Plant');
      }

      toast.success('Plant assets moved to Minor Plant', {
        description: `${payload.moved_count || 0} moved${payload.skipped_count ? `, ${payload.skipped_count} skipped` : ''}.`,
      });
      if (payload.skipped_count) {
        toast.warning('Some Plant assets were skipped', {
          description: 'They may already be moved, inactive, or have an inventory ID conflict.',
        });
      }
      setSelectedPlantIds(new Set());
      await Promise.all([fetchPlantData(), refetchMaintenance()]);
      onVehicleAdded?.();
    } catch (error: unknown) {
      console.error('Error moving Plant assets to Minor Plant:', error);
      toast.error('Failed to move Plant assets', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setMovingToMinorPlant(false);
    }
  };

  const handleRestorePlant = (plant: PlantAsset) => {
    if (!confirm(`Restore ${plant.plant_id} to active plant?\n\nThis will:\n• Move plant back to Active Plant tab\n• Restore all maintenance data\n\nContinue?`)) return;

    setRestoringId(plant.id);
    (async () => {
      try {
        const { error } = await supabase
          .from('plant')
          .update({ status: 'active', retired_at: null, retire_reason: null })
          .eq('id', plant.id);

        if (error) throw error;

        toast.success('Plant restored', {
          description: `${plant.plant_id} has been moved back to Active Plant.`,
        });

        fetchPlantData();
      } catch (error: unknown) {
        console.error('Error restoring plant:', error);
        toast.error('Failed to restore plant', {
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      } finally {
        setRestoringId(null);
      }
    })();
  };

  const handlePermanentDelete = (plant: PlantAsset) => {
    if (!confirm(`\u26A0\uFE0F Permanently remove ${plant.plant_id}?\n\nThis will:\n• Remove from Retired Plant tab\n• Preserve all inspection history\n• Cannot be undone\n\nContinue?`)) return;

    setDeletingId(plant.id);
    (async () => {
      try {
        const { error, count } = await supabase
          .from('plant')
          .delete({ count: 'exact' })
          .eq('id', plant.id);

        if (error) throw error;

        // Supabase returns success with 0 rows when RLS blocks the delete
        if (count === 0) {
          throw new Error('You do not have permission to permanently delete plant records.');
        }

        toast.success('Plant permanently removed', {
          description: `${plant.plant_id} has been permanently deleted from the archive.`,
        });

        fetchPlantData();
      } catch (error: unknown) {
        console.error('Error permanently deleting plant:', error);
        toast.error('Failed to permanently remove plant', {
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      } finally {
        setDeletingId(null);
      }
    })();
  };

  // Filter retired plant based on search
  const filteredRetiredPlant = retiredPlantAssets.filter(plant => {
    if (!retiredSearchQuery) return true;
    const q = retiredSearchQuery.toLowerCase();
    return (
      (plant.plant_id || '').toLowerCase().includes(q) ||
      (plant.nickname || '').toLowerCase().includes(q) ||
      (plant.reg_number || '').toLowerCase().includes(q) ||
      (plant.serial_number || '').toLowerCase().includes(q)
    );
  });

  return (
    <>
      {/* Mobile Info Banner */}
      <Alert className="md:hidden bg-blue-900/20 border-blue-700/50 mb-4">
        <Monitor className="h-4 w-4 text-blue-400" />
        <AlertDescription className="text-blue-200 text-sm">
          Mobile view shows essential information only. Desktop recommended for complete data and advanced features.
        </AlertDescription>
      </Alert>

      <Card className="border-border">
        <CardHeader>
          <div>
            <CardTitle className="text-white">
              All Plant
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {activePlantAssets.length} plant asset{activePlantAssets.length !== 1 ? 's' : ''} • Click column headers to sort
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          
          {/* Internal Tabs for Active vs Retired Plant */}
          <Tabs defaultValue="active" className="w-full">
            <TabsList className={cn('bg-slate-800 border-border', tabletModeEnabled && 'h-auto flex-wrap gap-2 p-1.5')}>
              <TabsTrigger value="active" className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}>
                Active Plant ({activePlantAssets.length})
              </TabsTrigger>
              <TabsTrigger value="deleted" className={cn('flex items-center gap-2', tabletModeEnabled && 'min-h-11 text-base px-4')}>
                <FolderClock className="h-4 w-4" />
                Retired Plant ({retiredPlantCount})
              </TabsTrigger>
            </TabsList>
            
            {/* Active Plant Tab */}
            <TabsContent value="active" className="space-y-4 mt-4">
              {/* Search Bar and Column Filter */}
              <div className={cn('flex gap-2', tabletModeEnabled && 'flex-wrap')}>
            <div className="relative flex-1">
              <Search className={cn('absolute left-3 text-muted-foreground', tabletModeEnabled ? 'top-3.5 h-5 w-5' : 'top-3 h-4 w-4')} />
              <Input
                placeholder="Search Plant..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className={cn('bg-slate-900/50 border-slate-600 text-white', tabletModeEnabled ? 'pl-12 min-h-11 text-base' : 'pl-11')}
              />
            </div>
            {selectedPlantIds.size > 0 ? (
              <Button
                variant="outline"
                onClick={handleMoveSelectedToMinorPlant}
                disabled={movingToMinorPlant}
                className={cn('border-amber-500/50 text-amber-200 hover:bg-amber-900/20', tabletModeEnabled && 'min-h-11 text-base px-4')}
              >
                {movingToMinorPlant ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Move to Minor Plant ({selectedPlantIds.size})
              </Button>
            ) : null}
            
            {/* Column Visibility Dropdown - Hidden on Mobile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className={cn('border-slate-600 hidden md:flex', tabletModeEnabled && 'min-h-11 text-base px-4')}>
                  <Settings2 className="h-4 w-4 mr-2" />
                  Show columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-slate-900 border border-border">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.nickname}
                  onCheckedChange={() => toggleColumn('nickname')}
                >
                  Nickname
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.serial_number}
                  onCheckedChange={() => toggleColumn('serial_number')}
                >
                  Serial Number
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.category}
                  onCheckedChange={() => toggleColumn('category')}
                >
                  Category
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.current_hours}
                  onCheckedChange={() => toggleColumn('current_hours')}
                >
                  Hours
                </DropdownMenuCheckboxItem>
                {maintenanceColumns.map(column => (
                  <DropdownMenuCheckboxItem
                    key={column.category_id}
                    checked={columnVisibility[`category:${column.category_id}`] ?? true}
                    onCheckedChange={() => toggleColumn(`category:${column.category_id}`)}
                  >
                    {column.category_name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop Table View */}
          {sortedPlant.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {debouncedSearchQuery ? 'No plant machinery found matching your search.' : 'No plant machinery with maintenance records yet.'}
            </div>
          ) : (
            <div className={cn('border border-slate-700 rounded-lg', tabletModeEnabled ? 'hidden' : 'hidden md:block')}>
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead
                        className="sticky z-30 w-10 bg-slate-900 text-muted-foreground border-b-2 border-border"
                        style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                      >
                        <Checkbox
                          checked={allVisiblePlantSelected}
                          onCheckedChange={(checked) => toggleVisiblePlantSelected(checked === true)}
                          aria-label="Select visible plant assets"
                        />
                      </TableHead>
                      <TableHead 
                        className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                        style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                        onClick={() => handleSort('plant_id')}
                      >
                        <div className="flex items-center gap-2">
                          Plant ID
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      {columnVisibility.nickname && (
                      <TableHead 
                        className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                        style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                        onClick={() => handleSort('nickname')}
                      >
                        <div className="flex items-center gap-2">
                          Nickname
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      )}
                      {columnVisibility.serial_number && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border whitespace-nowrap"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('serial_number')}
                        >
                          <div className="flex items-center gap-2">
                            Serial Number
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.category && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border whitespace-nowrap"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('category')}
                        >
                          <div className="flex items-center gap-2">
                            Category
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {columnVisibility.current_hours && (
                        <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border whitespace-nowrap"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('current_hours')}
                        >
                          <div className="flex items-center gap-2">
                            Hours
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {maintenanceColumns
                        .filter(column => columnVisibility[`category:${column.category_id}`] ?? true)
                        .map(column => (
                          <TableHead
                            key={column.category_id}
                            className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border whitespace-nowrap"
                            style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                            onClick={() => handleSort(`category:${column.category_id}`)}
                          >
                            <div className="flex items-center gap-2">
                              {column.category_name === 'Service Due (Hours)' ? 'Service Due' : column.category_name}
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePlant.map((asset) => (
                      <TableRow 
                        key={asset.plant_id}
                        onClick={() => handleViewHistory(asset.plant?.id || '')}
                        className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                      >
                        <TableCell className="align-top">
                          <Checkbox
                            checked={selectedPlantIds.has(asset.plant.id)}
                            onClick={(event) => event.stopPropagation()}
                            onCheckedChange={(checked) => togglePlantSelected(asset.plant.id, checked === true)}
                            aria-label={`Select ${asset.plant?.plant_id || 'Plant asset'}`}
                          />
                        </TableCell>
                        {/* Plant ID */}
                        <TableCell className="align-top font-medium text-white">
                          <div className="space-y-1">
                            <span className="block">{asset.plant?.plant_id || 'Unknown'}</span>
                            {asset.plant?.reg_number ? (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {asset.plant.reg_number}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        
                        {/* Nickname */}
                        {columnVisibility.nickname && (
                          <TableCell className="align-top text-muted-foreground">
                            {asset.plant?.nickname ? (
                              <span
                                className="block max-w-[18rem] overflow-hidden break-words text-sm leading-5 text-muted-foreground"
                                style={{
                                  display: '-webkit-box',
                                  WebkitBoxOrient: 'vertical',
                                  WebkitLineClamp: 2,
                                }}
                              >
                                {asset.plant.nickname}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">No nickname</span>
                            )}
                          </TableCell>
                        )}
                        
                        {/* Serial Number */}
                        {columnVisibility.serial_number && (
                          <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                            {asset.plant?.serial_number || (
                              <span className="text-slate-400 italic">Not set</span>
                            )}
                          </TableCell>
                        )}
                        
                        {/* Category */}
                        {columnVisibility.category && (
                          <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                            {asset.plant?.van_categories?.name || 'All plant'}
                          </TableCell>
                        )}
                        
                        {/* Hours */}
                        {columnVisibility.current_hours && (
                          <TableCell className="align-top whitespace-nowrap">
                            {asset.current_hours != null ? (
                              <span className="text-muted-foreground">{asset.current_hours.toLocaleString()}h</span>
                            ) : (
                              <Badge className={`whitespace-nowrap font-medium ${getStatusColorClass('not_set')}`}>Not Set</Badge>
                            )}
                          </TableCell>
                        )}
                        
                        {maintenanceColumns
                          .filter(column => columnVisibility[`category:${column.category_id}`] ?? true)
                          .map(column => {
                            const item = asset.maintenance_items?.find(maintenanceItem => maintenanceItem.category_id === column.category_id);

                            return (
                              <TableCell key={column.category_id} className="align-top whitespace-nowrap">
                                <Badge className={`whitespace-nowrap font-medium ${getStatusColorClass(item?.status.status || 'not_set')}`}>
                                  {item?.display_value || 'Not Set'}
                                </Badge>
                              </TableCell>
                            );
                          })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </div>
          )}

          {/* Mobile Card View */}
          {sortedPlant.length > 0 && (
            <div className={cn('space-y-3', tabletModeEnabled ? 'block' : 'md:hidden')}>
              {visiblePlant.map((asset) => {
                const isExpanded = expandedCardId === asset.plant_id;
                
                return (
                  <Card 
                    key={asset.plant_id} 
                    id={`plant-card-${asset.plant_id}`}
                    className="bg-slate-800 border-slate-700 transition-all duration-200"
                  >
                    <CardContent className="p-4">
                      {/* Collapsed View - Click to Expand */}
                      <div 
                        onClick={() => {
                          if (!isExpanded) {
                            setExpandedCardId(asset.plant_id);
                            // Scroll to top of card after expansion
                            setTimeout(() => {
                              const card = document.getElementById(`plant-card-${asset.plant_id}`);
                              if (card) {
                                const navbarHeight = 68;
                                const padding = 16;
                                const yOffset = -(navbarHeight + padding);
                                const y = card.getBoundingClientRect().top + window.pageYOffset + yOffset;
                                window.scrollTo({ top: y, behavior: 'smooth' });
                              }
                            }, 100);
                          } else {
                            setExpandedCardId(null);
                          }
                        }}
                        className="cursor-pointer"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <Checkbox
                            checked={selectedPlantIds.has(asset.plant.id)}
                            onClick={(event) => event.stopPropagation()}
                            onCheckedChange={(checked) => togglePlantSelected(asset.plant.id, checked === true)}
                            aria-label={`Select ${asset.plant?.plant_id || 'Plant asset'}`}
                            className="mr-3"
                          />
                          <div className="flex-1">
                            <h3 className="font-semibold text-white text-lg">{asset.plant?.plant_id}</h3>
                            {asset.plant?.nickname && (
                              <p className="text-xs text-muted-foreground">{asset.plant.nickname}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronUp className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        {/* Collapsed View - Essential Info Only */}
                        {!isExpanded && (
                          <div className="text-xs text-slate-400 space-y-0.5">
                            {asset.plant?.serial_number && (
                              <div className="flex justify-between">
                                <span>Serial:</span>
                                <span className="text-white">{asset.plant.serial_number}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>Hours:</span>
                              <span className="text-white">
                                {asset.current_hours ? <>{asset.current_hours.toLocaleString()}h</> : 'Not set'}
                              </span>
                            </div>
                            {asset.maintenance_items?.find(item => item.category_field_key === 'loler_due_date') && (
                              <div className="flex justify-between">
                                <span>LOLER THOROUGH EXAMINATION Due:</span>
                                <span className="text-white">
                                  {asset.maintenance_items.find(item => item.category_field_key === 'loler_due_date')?.display_value}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Expanded View - All Fields */}
                      {isExpanded && (
                        <div className="space-y-3 pt-3 border-t border-border">
                          {/* All Status Fields */}
                          <div className="space-y-2">
                            {asset.plant?.reg_number && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Registration:</span>
                                <span className="text-white font-medium">{asset.plant.reg_number}</span>
                              </div>
                            )}
                            {asset.plant?.serial_number && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Serial Number:</span>
                                <span className="text-white font-medium">{asset.plant.serial_number}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Category:</span>
                              <span className="text-white">{asset.plant?.van_categories?.name || 'All plant'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Current Hours:</span>
                              <span className="text-white font-medium">
                                {asset.current_hours ? (
                                  <>{asset.current_hours.toLocaleString()}h</>
                                ) : (
                                  <span className="text-slate-400 italic">Not set</span>
                                )}
                              </span>
                            </div>
                            {maintenanceColumns
                              .filter(column => columnVisibility[`category:${column.category_id}`] ?? true)
                              .map(column => {
                                const item = asset.maintenance_items?.find(maintenanceItem => maintenanceItem.category_id === column.category_id);

                                return (
                                  <div key={column.category_id} className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">{column.category_name}:</span>
                                    <Badge className={`font-medium ${getStatusColorClass(item?.status.status || 'not_set')}`}>
                                      {item?.display_value || 'Not Set'}
                                    </Badge>
                                  </div>
                                );
                              })}
                          </div>

                          {/* Actions - Single History Button */}
                          <div className="flex items-center gap-2 pt-2 border-t border-border">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewHistory(asset.plant?.id || '');
                              }}
                              className={tabletModeEnabled ? 'h-11 w-11 p-0' : 'h-10 w-10 p-0'}
                            >
                              <History className="h-5 w-5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          <LoadMorePagination
            visibleCount={visiblePlant.length}
            totalCount={sortedPlant.length}
            itemLabel="plant assets"
            onShowMore={showMore}
          />
            </TabsContent>
            
            {/* Retired Plant Tab */}
            <TabsContent value="deleted" className="space-y-4 mt-4">
              {/* Search Bar for Retired Plant */}
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search Plant..."
                  value={retiredSearchQuery}
                  onChange={(e) => setRetiredSearchQuery(e.target.value)}
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>

              {isLoading ? (
                <PanelLoader message="Loading retired plant..." accent="maintenance" className="py-12" />
              ) : !filteredRetiredPlant || filteredRetiredPlant.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FolderClock className="h-12 w-12 mx-auto mb-3 text-slate-600" />
                  <p>{retiredPlantCount === 0 ? 'No retired plant found.' : 'No matches found.'}</p>
                </div>
              ) : (
                <>
                  {/* Desktop Table View for Retired Plant */}
                  <div className={cn('border border-slate-700 rounded-lg', tabletModeEnabled ? 'hidden' : 'hidden md:block')}>
                    <Table className="min-w-full">
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                            Plant ID
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                            Nickname
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                            Serial Number
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                            Category
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                            Retired Date
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                            Reason
                          </TableHead>
                          <TableHead className="bg-slate-900 text-right text-muted-foreground border-b-2 border-border">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRetiredPlant.map((plant) => (
                          <TableRow
                            key={plant.id}
                            className="border-slate-700 hover:bg-slate-800/30"
                          >
                            {/* Plant ID */}
                            <TableCell className="font-medium text-white">
                              {plant.plant_id}
                            </TableCell>

                            {/* Nickname */}
                            <TableCell className="text-muted-foreground">
                              {plant.nickname || (
                                <span className="text-slate-400 italic">No nickname</span>
                              )}
                            </TableCell>

                            {/* Serial Number */}
                            <TableCell className="text-muted-foreground">
                              {plant.serial_number || (
                                <span className="text-slate-400 italic">Not set</span>
                              )}
                            </TableCell>

                            {/* Category */}
                            <TableCell className="text-muted-foreground">
                              {plant.van_categories?.name || '—'}
                            </TableCell>

                            {/* Retired Date */}
                            <TableCell className="text-muted-foreground">
                              {plant.retired_at
                                ? new Date(plant.retired_at).toLocaleDateString()
                                : '—'}
                            </TableCell>

                            {/* Reason */}
                            <TableCell>
                              {plant.retire_reason ? (
                                <Badge
                                  variant="outline"
                                  className={
                                    plant.retire_reason === 'Sold'
                                      ? 'border-blue-500 text-blue-400'
                                      : plant.retire_reason === 'Scrapped'
                                      ? 'border-red-500 text-red-400'
                                      : 'border-slate-500 text-muted-foreground'
                                  }
                                >
                                  {plant.retire_reason}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>

                            {/* Actions */}
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRestorePlant(plant)}
                                  disabled={restoringId === plant.id}
                                  className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                                  title="Restore to Active"
                                >
                                  {restoringId === plant.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Undo2 className="h-3 w-3" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handlePermanentDelete(plant)}
                                  disabled={deletingId === plant.id}
                                  className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                  title="Permanently Remove"
                                >
                                  {deletingId === plant.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <XCircle className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile Card View for Retired Plant */}
                  <div className={cn('space-y-3', tabletModeEnabled ? 'block' : 'md:hidden')}>
                    {filteredRetiredPlant.map((plant) => (
                      <Card
                        key={plant.id}
                        className="bg-slate-800 border-border"
                      >
                        <CardContent className="p-4">
                          {/* Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h3 className="font-semibold text-white text-lg">{plant.plant_id}</h3>
                              {plant.nickname && (
                                <p className="text-xs text-muted-foreground">{plant.nickname}</p>
                              )}
                            </div>
                            {plant.retire_reason ? (
                              <Badge
                                variant="outline"
                                className={
                                  plant.retire_reason === 'Sold'
                                    ? 'border-blue-500 text-blue-400'
                                    : plant.retire_reason === 'Scrapped'
                                    ? 'border-red-500 text-red-400'
                                    : 'border-slate-500 text-muted-foreground'
                                }
                              >
                                {plant.retire_reason}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/10">
                                Retired
                              </Badge>
                            )}
                          </div>

                          {/* Details */}
                          <div className="space-y-2 text-sm">
                            {plant.serial_number && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Serial Number:</span>
                                <span className="text-white">{plant.serial_number}</span>
                              </div>
                            )}
                            {plant.van_categories?.name && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Category:</span>
                                <span className="text-white">{plant.van_categories.name}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Retired:</span>
                              <span className="text-white">
                                {plant.retired_at
                                  ? new Date(plant.retired_at).toLocaleDateString()
                                  : '—'}
                              </span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="mt-4 pt-3 border-t border-slate-700 space-y-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRestorePlant(plant)}
                              disabled={restoringId === plant.id}
                              className={cn('w-full text-green-400 hover:text-green-300 hover:bg-green-900/20', tabletModeEnabled && 'min-h-11 text-base')}
                            >
                              {restoringId === plant.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Restoring...
                                </>
                              ) : (
                                <>
                                  <Undo2 className="h-4 w-4 mr-2" />
                                  Restore to Active
                                </>
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handlePermanentDelete(plant)}
                              disabled={deletingId === plant.id}
                              className={cn('w-full text-red-400 hover:text-red-300 hover:bg-red-900/20', tabletModeEnabled && 'min-h-11 text-base')}
                            >
                              {deletingId === plant.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Removing...
                                </>
                              ) : (
                                <>
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Permanently Remove
                                </>
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AddAssetFlowDialog
        open={addVehicleDialogOpen}
        onOpenChange={setAddVehicleDialogOpen}
        onSuccess={() => {
          // Refetch local data and notify parent
          fetchPlantData();
          onVehicleAdded?.();
        }}
      />
    </>
  );
}
