'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PanelLoader } from '@/components/ui/panel-loader';
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
  Edit, 
  History,
  ArrowUpDown,
  Settings2,
  Monitor,
  ChevronDown,
  ChevronUp,
  Loader2,
  FolderClock,
  XCircle,
  Archive,
  Undo2
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { MaintenanceItem, VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { AddAssetFlowDialog } from './add-asset/AddAssetFlowDialog';
import { DeleteVehicleDialog } from './DeleteVehicleDialog';
import { 
  getStatusColorClass,
  formatMileage,
  formatMaintenanceDate
} from '@/lib/utils/maintenanceCalculations';
import { EditMaintenanceDialog } from './EditMaintenanceDialog';
import { useDeletedVehicles, usePermanentlyDeleteArchivedVehicle, useRestoreArchivedVehicle } from '@/lib/hooks/useMaintenance';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { cn } from '@/lib/utils/cn';
import { toast } from 'sonner';

type RetiredHgv = {
  id: string;
  reg_number: string;
  nickname: string | null;
  current_mileage: number | null;
  retired_at: string | null;
  retire_reason: string | null;
  hgv_categories?: { name: string; id: string } | null;
};

interface MaintenanceTableProps {
  vehicles: VehicleMaintenanceWithStatus[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onVehicleAdded?: () => void;
  assetLabel?: 'Van' | 'HGV';
}

type SortField = 
  | 'reg_number'
  | 'nickname'
  | 'current_mileage'
  | `category:${string}`;

type SortDirection = 'asc' | 'desc';

interface ColumnVisibility {
  nickname: boolean;
  current_mileage: boolean;
  [categoryColumnId: string]: boolean;
}

export function MaintenanceTable({ 
  vehicles, 
  searchQuery, 
  onSearchChange,
  onVehicleAdded,
  assetLabel = 'Van',
}: MaintenanceTableProps) {
  const assetLabelLower = assetLabel.toLowerCase();
  const isHgvTable = assetLabel === 'HGV';
  const distanceHeaderLabel = isHgvTable ? 'KM' : 'Mileage';
  const currentDistanceLabel = isHgvTable ? 'Current KM' : 'Current Mileage';
  const assetLabelPlural = `${assetLabel}s`;
  const assetLabelPluralLower = `${assetLabelLower}s`;
  const searchPlaceholder = `Search ${assetLabelPlural}...`;
  const router = useRouter();
  const { isAdmin, isManager } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const [sortField, setSortField] = useState<SortField>('reg_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMaintenanceWithStatus | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [retiredSearchQuery, setRetiredSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  
  // Track pending operations per vehicle ID (vans + HGVs share these)
  const [pendingRestore, setPendingRestore] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());
  
  // Fetch retired vans from van_archive (only used for van tab)
  const { data: retiredData, isLoading: retiredLoading } = useDeletedVehicles();
  const permanentlyDelete = usePermanentlyDeleteArchivedVehicle();
  const restoreVehicle = useRestoreArchivedVehicle();

  // Fetch retired HGVs from hgvs table (only used for HGV tab)
  const supabase = useMemo(() => createClient(), []);
  const [retiredHgvs, setRetiredHgvs] = useState<RetiredHgv[]>([]);
  const [retiredHgvsLoading, setRetiredHgvsLoading] = useState(false);

  const fetchRetiredHgvs = useCallback(async () => {
    if (!isHgvTable) return;
    setRetiredHgvsLoading(true);
    try {
      const { data, error } = await supabase
        .from('hgvs')
        .select('id, reg_number, nickname, current_mileage, retired_at, retire_reason, hgv_categories(name, id)')
        .in('status', ['retired', 'archived'])
        .order('retired_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      setRetiredHgvs(data || []);
    } catch {
      setRetiredHgvs([]);
    } finally {
      setRetiredHgvsLoading(false);
    }
  }, [isHgvTable, supabase]);

  useEffect(() => {
    fetchRetiredHgvs();
  }, [fetchRetiredHgvs]);

  const effectiveRetiredCount = isHgvTable ? retiredHgvs.length : (retiredData?.count || 0);
  const effectiveRetiredLoading = isHgvTable ? retiredHgvsLoading : retiredLoading;
  
  // Handlers with per-vehicle loading state
  const handleRestore = (vehicleId: string, regNumber: string) => {
    if (confirm(`Restore ${regNumber} to active ${assetLabelPluralLower}?\n\nThis will:\n• Move ${assetLabelLower} back to Active ${assetLabelPlural} tab\n• Restore all maintenance data\n\nContinue?`)) {
      setPendingRestore(prev => new Set(prev).add(vehicleId));
      restoreVehicle.mutate(vehicleId, {
        onSettled: () => {
          setPendingRestore(prev => {
            const next = new Set(prev);
            next.delete(vehicleId);
            return next;
          });
        },
      });
    }
  };
  
  const handlePermanentDelete = (vehicleId: string, regNumber: string) => {
    if (confirm(`⚠️ Permanently remove ${regNumber}?\n\nThis will:\n• Remove from Retired ${assetLabelPlural} tab\n• Preserve all inspection history\n• Cannot be undone\n\nContinue?`)) {
      setPendingDelete(prev => new Set(prev).add(vehicleId));
      permanentlyDelete.mutate(vehicleId, {
        onSettled: () => {
          setPendingDelete(prev => {
            const next = new Set(prev);
            next.delete(vehicleId);
            return next;
          });
        },
      });
    }
  };

  const handleRestoreHgv = (hgv: RetiredHgv) => {
    if (!confirm(`Restore ${hgv.reg_number} to active HGVs?\n\nThis will:\n• Move HGV back to Active HGVs tab\n• Restore all maintenance data\n\nContinue?`)) return;

    setPendingRestore(prev => new Set(prev).add(hgv.id));
    (async () => {
      try {
        const { error } = await supabase
          .from('hgvs')
          .update({ status: 'active', retired_at: null, retire_reason: null })
          .eq('id', hgv.id);

        if (error) throw error;

        toast.success('HGV restored', {
          description: `${hgv.reg_number} has been moved back to Active HGVs.`,
        });

        fetchRetiredHgvs();
        onVehicleAdded?.();
      } catch (error: unknown) {
        console.error('Error restoring HGV:', error);
        toast.error('Failed to restore HGV', {
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      } finally {
        setPendingRestore(prev => {
          const next = new Set(prev);
          next.delete(hgv.id);
          return next;
        });
      }
    })();
  };

  const handlePermanentDeleteHgv = (hgv: RetiredHgv) => {
    if (!confirm(`⚠️ Permanently remove ${hgv.reg_number}?\n\nThis will:\n• Remove from Retired HGVs tab\n• Preserve all inspection history\n• Cannot be undone\n\nContinue?`)) return;

    setPendingDelete(prev => new Set(prev).add(hgv.id));
    (async () => {
      try {
        const { error, count } = await supabase
          .from('hgvs')
          .delete({ count: 'exact' })
          .eq('id', hgv.id);

        if (error) throw error;

        if (count === 0) {
          throw new Error('You do not have permission to permanently delete HGV records.');
        }

        toast.success('HGV permanently removed', {
          description: `${hgv.reg_number} has been permanently deleted from the archive.`,
        });

        fetchRetiredHgvs();
      } catch (error: unknown) {
        console.error('Error permanently deleting HGV:', error);
        toast.error('Failed to permanently remove HGV', {
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      } finally {
        setPendingDelete(prev => {
          const next = new Set(prev);
          next.delete(hgv.id);
          return next;
        });
      }
    })();
  };
  
  // Column visibility state - all columns visible by default
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>({
    nickname: true,
    current_mileage: true,
  });

  const maintenanceColumns = useMemo(() => {
    const columnsByCategoryId = new Map<string, MaintenanceItem>();

    vehicles.forEach(vehicle => {
      (vehicle.maintenance_items || [])
        .filter(item => item.asset_type === (isHgvTable ? 'hgv' : 'van'))
        .forEach(item => {
          if (!columnsByCategoryId.has(item.category_id)) {
            columnsByCategoryId.set(item.category_id, item);
          }
        });
    });

    return Array.from(columnsByCategoryId.values())
      .sort((a, b) => a.sort_order - b.sort_order || a.category_name.localeCompare(b.category_name));
  }, [isHgvTable, vehicles]);

  useEffect(() => {
    setColumnVisibility(prev => {
      const next: ColumnVisibility = {
        nickname: prev.nickname ?? true,
        current_mileage: prev.current_mileage ?? true,
      };

      maintenanceColumns.forEach(column => {
        next[`category:${column.category_id}`] = prev[`category:${column.category_id}`] ?? true;
      });

      return next;
    });
  }, [maintenanceColumns]);
  
  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };
  
  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  const filteredVehicles = useMemo(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    if (!query) return vehicles;

    return vehicles.filter((vehicle) => {
      const searchableValues = [
        vehicle.vehicle?.reg_number,
        vehicle.vehicle?.nickname,
        vehicle.current_mileage?.toString(),
        ...(vehicle.maintenance_items || []).flatMap((item) => [
          item.category_name,
          item.display_value,
          item.due_date,
          item.due_mileage?.toString(),
          item.due_hours?.toString(),
        ]),
      ];

      return searchableValues.some((value) => value?.toLowerCase().includes(query));
    });
  }, [debouncedSearchQuery, vehicles]);

  // Sort vehicles
  const sortedVehicles = [...filteredVehicles].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    
    switch (sortField) {
      case 'reg_number':
        return multiplier * (a.vehicle?.reg_number || '').localeCompare(b.vehicle?.reg_number || '');
      
      case 'nickname':
        return multiplier * (a.vehicle?.nickname || '').localeCompare(b.vehicle?.nickname || '');
      
      case 'current_mileage':
        return multiplier * ((a.current_mileage || 0) - (b.current_mileage || 0));
      
      default:
        if (sortField.startsWith('category:')) {
          const categoryId = sortField.replace('category:', '');
          const aItem = a.maintenance_items?.find(item => item.category_id === categoryId);
          const bItem = b.maintenance_items?.find(item => item.category_id === categoryId);
          const getSortValue = (item?: MaintenanceItem) => {
            if (!item) return Number.POSITIVE_INFINITY;
            if (item.category_type === 'date') return item.due_date ? new Date(item.due_date).getTime() : Number.POSITIVE_INFINITY;
            if (item.category_type === 'hours') return item.due_hours ?? Number.POSITIVE_INFINITY;
            return item.due_mileage ?? Number.POSITIVE_INFINITY;
          };

          return multiplier * (getSortValue(aItem) - getSortValue(bItem));
        }

        return 0;
    }
  });
  const paginationKey = [
    assetLabel,
    debouncedSearchQuery.trim(),
    sortField,
    sortDirection,
    sortedVehicles.length,
  ].join(':');
  const {
    visibleItems: visibleVehicles,
    showMore,
  } = useLoadMorePagination(sortedVehicles, { resetKey: paginationKey });
  
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
              All {assetLabelPlural}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {vehicles.length} {assetLabelLower}{vehicles.length !== 1 ? 's' : ''} • Click column headers to sort
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          
          {/* Internal Tabs for Active vs Retired Vans */}
          <Tabs defaultValue="active" className="w-full">
            <TabsList className={cn('bg-slate-800 border-border', tabletModeEnabled && 'h-auto flex-wrap gap-2 p-1.5')}>
              <TabsTrigger value="active" className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}>
                Active {assetLabelPlural} ({vehicles.length})
              </TabsTrigger>
              <TabsTrigger value="deleted" className={cn('flex items-center gap-2', tabletModeEnabled && 'min-h-11 text-base px-4')}>
                <FolderClock className="h-4 w-4" />
                Retired {assetLabelPlural} ({effectiveRetiredCount})
              </TabsTrigger>
            </TabsList>
            
            {/* Active Vans Tab */}
            <TabsContent value="active" className="space-y-4 mt-4">
              {/* Search Bar and Column Filter */}
              <div className={cn('flex gap-2', tabletModeEnabled && 'flex-wrap')}>
            <div className="relative flex-1">
              <Search className={cn('absolute left-3 text-muted-foreground', tabletModeEnabled ? 'top-3.5 h-5 w-5' : 'top-3 h-4 w-4')} />
              <Input
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className={cn('bg-slate-900/50 border-slate-600 text-white', tabletModeEnabled ? 'pl-12 min-h-11 text-base' : 'pl-11')}
              />
            </div>
            
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
                  checked={columnVisibility.current_mileage}
                  onCheckedChange={() => toggleColumn('current_mileage')}
                >
                  {distanceHeaderLabel}
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
          {sortedVehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {debouncedSearchQuery ? `No ${assetLabelPluralLower} found matching your search.` : `No ${assetLabelPluralLower} with maintenance records yet.`}
            </div>
          ) : (
            <div className={cn('border border-slate-700 rounded-lg', tabletModeEnabled ? 'hidden' : 'hidden md:block')}>
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead 
                        className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                        style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                        onClick={() => handleSort('reg_number')}
                      >
                        <div className="flex items-center gap-2">
                          Registration
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
                      {columnVisibility.current_mileage && (
                      <TableHead 
                          className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                          style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                          onClick={() => handleSort('current_mileage')}
                        >
                          <div className="flex items-center gap-2">
                            {distanceHeaderLabel}
                            <ArrowUpDown className="h-3 w-3" />
                          </div>
                        </TableHead>
                      )}
                      {maintenanceColumns
                        .filter(column => columnVisibility[`category:${column.category_id}`] ?? true)
                        .map(column => (
                          <TableHead
                            key={column.category_id}
                            className="sticky z-30 bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                            style={{ top: 'calc(var(--top-nav-h, 68px) + 0px)' }}
                            onClick={() => handleSort(`category:${column.category_id}`)}
                          >
                            <div className="flex items-center gap-2">
                              {column.category_name}
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleVehicles.map((vehicle) => (
                      <TableRow 
                        key={vehicle.van_id ?? vehicle.id ?? vehicle.vehicle?.id}
                        onClick={() => {
                          const assetType = vehicle.vehicle?.asset_type;
                          const vehicleId = vehicle.hgv_id ?? vehicle.van_id ?? vehicle.id;
                          if (vehicleId) {
                            if (assetType === 'hgv') {
                              router.push(`/fleet/hgvs/${vehicleId}/history?fromTab=hgvs`);
                            } else {
                              router.push(`/fleet/vans/${vehicleId}/history?fromTab=vans`);
                            }
                          }
                        }}
                        className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                      >
                        {/* Registration */}
                        <TableCell className="font-medium text-white">
                          {vehicle.vehicle?.reg_number || 'Unknown'}
                        </TableCell>
                        
                        {/* Nickname */}
                        {columnVisibility.nickname && (
                          <TableCell className="text-muted-foreground">
                            {vehicle.vehicle?.nickname || (
                              <span className="text-slate-400 italic">No nickname</span>
                            )}
                          </TableCell>
                        )}
                        
                        {/* Current distance reading */}
                        {columnVisibility.current_mileage && (
                          <TableCell>
                            {vehicle.current_mileage != null ? (
                              <span className="text-muted-foreground">{formatMileage(vehicle.current_mileage)}</span>
                            ) : (
                              <Badge className={`font-medium ${getStatusColorClass('not_set')}`}>Not Set</Badge>
                            )}
                          </TableCell>
                        )}
                        
                        {maintenanceColumns
                          .filter(column => columnVisibility[`category:${column.category_id}`] ?? true)
                          .map(column => {
                            const item = vehicle.maintenance_items?.find(maintenanceItem => maintenanceItem.category_id === column.category_id);

                            return (
                              <TableCell key={column.category_id}>
                                <Badge className={`font-medium ${getStatusColorClass(item?.status.status || 'not_set')}`}>
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
          {sortedVehicles.length > 0 && (
            <div className={cn('space-y-3', tabletModeEnabled ? 'block' : 'md:hidden')}>
              {visibleVehicles.map((vehicle) => {
                const cardVehicleId = vehicle.hgv_id ?? vehicle.van_id ?? vehicle.id;
                const isExpanded = expandedCardId === cardVehicleId;
                
                return (
                  <Card 
                    key={cardVehicleId}
                    id={`vehicle-card-${cardVehicleId}`}
                    className="bg-slate-800 border-slate-700 transition-all duration-200"
                  >
                    <CardContent className="p-4">
                      {/* Collapsed View - Click to Expand */}
                      <div 
                        onClick={() => {
                          if (!isExpanded) {
                            setExpandedCardId(cardVehicleId ?? null);
                            // Scroll to top of card after expansion
                            setTimeout(() => {
                              const card = document.getElementById(`vehicle-card-${cardVehicleId}`);
                              if (card) {
                                const navbarHeight = 68; // Approximate navbar height
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
                          <div className="flex-1">
                            <h3 className="font-semibold text-white text-lg">{vehicle.vehicle?.reg_number}</h3>
                            {vehicle.vehicle?.nickname && (
                              <p className="text-xs text-muted-foreground">{vehicle.vehicle.nickname}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Most Critical Status Badge */}
                            <Badge className={`text-xs ${getStatusColorClass(
                              vehicle.tax_status?.status === 'overdue' || vehicle.mot_status?.status === 'overdue' 
                                ? 'overdue' 
                                : vehicle.tax_status?.status === 'due_soon' || vehicle.mot_status?.status === 'due_soon'
                                ? 'due_soon'
                                : 'ok'
                            )}`}>
                              {vehicle.tax_status?.status === 'overdue' || vehicle.mot_status?.status === 'overdue' 
                                ? 'OVERDUE' 
                                : vehicle.tax_status?.status === 'due_soon' || vehicle.mot_status?.status === 'due_soon'
                                ? 'DUE SOON'
                                : 'OK'}
                            </Badge>
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
                            <div className="flex justify-between">
                              <span>Tax:</span>
                              <span className="text-white">{formatMaintenanceDate(vehicle.tax_due_date)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>MOT:</span>
                              <span className="text-white">{formatMaintenanceDate(vehicle.mot_due_date)}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Expanded View - All Fields */}
                      {isExpanded && (
                        <div className="space-y-3 pt-3 border-t border-border">
                          {/* All Status Fields */}
                          <div className="space-y-2">
                            {columnVisibility.current_mileage && vehicle.current_mileage && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">{currentDistanceLabel}:</span>
                                <span className="text-white font-medium">{formatMileage(vehicle.current_mileage)}</span>
                              </div>
                            )}
                            {maintenanceColumns
                              .filter(column => columnVisibility[`category:${column.category_id}`] ?? true)
                              .map(column => {
                                const item = vehicle.maintenance_items?.find(maintenanceItem => maintenanceItem.category_id === column.category_id);

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

                          {/* Actions - All on One Line */}
                          <div className="flex items-center gap-2 pt-2 border-t border-border">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                const assetType = vehicle.vehicle?.asset_type;
                                const vehicleId = vehicle.hgv_id ?? vehicle.van_id ?? vehicle.id;
                                if (vehicleId) {
                                  if (assetType === 'hgv') {
                                    router.push(`/fleet/hgvs/${vehicleId}/history?fromTab=hgvs`);
                                  } else {
                                    router.push(`/fleet/vans/${vehicleId}/history?fromTab=vans`);
                                  }
                                }
                              }}
                              className={tabletModeEnabled ? 'h-11 w-11 p-0' : 'h-10 w-10 p-0'}
                            >
                              <History className="h-5 w-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVehicle(vehicle);
                                setEditDialogOpen(true);
                              }}
                              className={tabletModeEnabled ? 'h-11 w-11 p-0' : 'h-10 w-10 p-0'}
                            >
                              <Edit className="h-5 w-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVehicle(vehicle);
                                setDeleteDialogOpen(true);
                              }}
                              className={cn('text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 ml-auto p-0', tabletModeEnabled ? 'h-11 w-11' : 'h-10 w-10')}
                            >
                              <Archive className="h-5 w-5" />
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
            visibleCount={visibleVehicles.length}
            totalCount={sortedVehicles.length}
            itemLabel={`${assetLabelPluralLower}`}
            onShowMore={showMore}
          />
            </TabsContent>
            
            {/* Retired Assets Tab */}
            <TabsContent value="deleted" className="space-y-4 mt-4">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={retiredSearchQuery}
                  onChange={(e) => setRetiredSearchQuery(e.target.value)}
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>
              
              {effectiveRetiredLoading ? (
                <PanelLoader
                  message={`Loading retired ${assetLabelPluralLower}...`}
                  accent="maintenance"
                  className="py-12"
                />
              ) : isHgvTable ? (
                /* ── Retired HGVs (from hgvs table) ── */
                retiredHgvs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FolderClock className="h-12 w-12 mx-auto mb-3 text-slate-600" />
                    <p>No retired {assetLabelPluralLower} found.</p>
                  </div>
                ) : (
                  <>
                    {/* Desktop Table View for Retired HGVs */}
                    <div className={cn('border border-slate-700 rounded-lg', tabletModeEnabled ? 'hidden' : 'hidden md:block')}>
                      <Table className="min-w-full">
                        <TableHeader>
                          <TableRow className="border-border">
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Registration</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Nickname</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">{distanceHeaderLabel}</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Category</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Retired Date</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Reason</TableHead>
                            <TableHead className="bg-slate-900 text-right text-muted-foreground border-b-2 border-border">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {retiredHgvs
                            .filter(h => (h.reg_number || '').toLowerCase().includes(retiredSearchQuery.toLowerCase()))
                            .map((hgv) => (
                              <TableRow key={hgv.id} className="border-slate-700 hover:bg-slate-800/30">
                                <TableCell className="font-medium text-white">{hgv.reg_number}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {hgv.nickname || <span className="text-slate-400 italic">No nickname</span>}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{formatMileage(hgv.current_mileage)}</TableCell>
                                <TableCell className="text-muted-foreground">{hgv.hgv_categories?.name || '—'}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {hgv.retired_at
                                    ? new Date(hgv.retired_at).toLocaleDateString()
                                    : '—'}
                                </TableCell>
                                <TableCell>
                                  {hgv.retire_reason ? (
                                    <Badge
                                      variant="outline"
                                      className={
                                        hgv.retire_reason === 'Sold'
                                          ? 'border-blue-500 text-blue-400'
                                          : hgv.retire_reason === 'Scrapped'
                                          ? 'border-red-500 text-red-400'
                                          : 'border-slate-500 text-muted-foreground'
                                      }
                                    >
                                      {hgv.retire_reason}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  {(isAdmin || isManager) && (
                                    <div className="flex items-center justify-end gap-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRestoreHgv(hgv)}
                                        disabled={pendingRestore.has(hgv.id)}
                                        className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                                        title="Restore to Active"
                                      >
                                        {pendingRestore.has(hgv.id) ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Undo2 className="h-3 w-3" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handlePermanentDeleteHgv(hgv)}
                                        disabled={pendingDelete.has(hgv.id)}
                                        className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                        title="Permanently Remove"
                                      >
                                        {pendingDelete.has(hgv.id) ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <XCircle className="h-3 w-3" />
                                        )}
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Mobile Card View for Retired HGVs */}
                    <div className={cn('space-y-3', tabletModeEnabled ? 'block' : 'md:hidden')}>
                      {retiredHgvs
                        .filter(h => (h.reg_number || '').toLowerCase().includes(retiredSearchQuery.toLowerCase()))
                        .map((hgv) => (
                          <Card key={hgv.id} className="bg-slate-800 border-border">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-3">
                                <div>
                                  <h3 className="font-semibold text-white text-lg">{hgv.reg_number}</h3>
                                  {hgv.nickname && <p className="text-xs text-muted-foreground">{hgv.nickname}</p>}
                                </div>
                                {hgv.retire_reason ? (
                                  <Badge
                                    variant="outline"
                                    className={
                                      hgv.retire_reason === 'Sold'
                                        ? 'border-blue-500 text-blue-400'
                                        : hgv.retire_reason === 'Scrapped'
                                        ? 'border-red-500 text-red-400'
                                        : 'border-slate-500 text-muted-foreground'
                                    }
                                  >
                                    {hgv.retire_reason}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/10">
                                    Retired
                                  </Badge>
                                )}
                              </div>
                              <div className="space-y-2 text-sm">
                                {hgv.current_mileage && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">{distanceHeaderLabel}:</span>
                                    <span className="text-white">{formatMileage(hgv.current_mileage)}</span>
                                  </div>
                                )}
                                {hgv.hgv_categories?.name && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Category:</span>
                                    <span className="text-white">{hgv.hgv_categories.name}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Retired:</span>
                                  <span className="text-white">
                                    {hgv.retired_at
                                      ? new Date(hgv.retired_at).toLocaleDateString()
                                      : '—'}
                                  </span>
                                </div>
                              </div>
                              {(isAdmin || isManager) && (
                                <div className="mt-4 pt-3 border-t border-slate-700 space-y-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRestoreHgv(hgv)}
                                    disabled={pendingRestore.has(hgv.id)}
                                    className={cn('w-full text-green-400 hover:text-green-300 hover:bg-green-900/20', tabletModeEnabled && 'min-h-11 text-base')}
                                  >
                                    {pendingRestore.has(hgv.id) ? (
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
                                    onClick={() => handlePermanentDeleteHgv(hgv)}
                                    disabled={pendingDelete.has(hgv.id)}
                                    className={cn('w-full text-red-400 hover:text-red-300 hover:bg-red-900/20', tabletModeEnabled && 'min-h-11 text-base')}
                                  >
                                    {pendingDelete.has(hgv.id) ? (
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
                              )}
                            </CardContent>
                          </Card>
                        ))}
                    </div>
                  </>
                )
              ) : (
                /* ── Retired Vans (from van_archive) ── */
                !retiredData || retiredData.vehicles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FolderClock className="h-12 w-12 mx-auto mb-3 text-slate-600" />
                    <p>No retired {assetLabelPluralLower} found.</p>
                  </div>
                ) : (
                  <>
                    <div className={cn('border border-slate-700 rounded-lg', tabletModeEnabled ? 'hidden' : 'hidden md:block')}>
                      <Table className="min-w-full">
                        <TableHeader>
                          <TableRow className="border-border">
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Registration</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Nickname</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Mileage</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Tax Due</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">MOT Due</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Retired Date</TableHead>
                            <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">Reason</TableHead>
                            <TableHead className="bg-slate-900 text-right text-muted-foreground border-b-2 border-border">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {retiredData.vehicles
                            .filter(vehicle => vehicle.reg_number.toLowerCase().includes(retiredSearchQuery.toLowerCase()))
                            .map((vehicle) => (
                              <TableRow key={vehicle.id} className="border-slate-700 hover:bg-slate-800/30">
                                <TableCell className="font-medium text-white">{vehicle.reg_number}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {vehicle.nickname || <span className="text-slate-400 italic">No nickname</span>}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{formatMileage(vehicle.current_mileage)}</TableCell>
                                <TableCell>
                                  <span className="text-muted-foreground">{formatMaintenanceDate(vehicle.tax_due_date)}</span>
                                </TableCell>
                                <TableCell>
                                  <span className="text-muted-foreground">{formatMaintenanceDate(vehicle.mot_due_date)}</span>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {new Date(vehicle.archived_at).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={
                                      vehicle.archive_reason === 'Sold'
                                        ? 'border-blue-500 text-blue-400'
                                        : vehicle.archive_reason === 'Scrapped'
                                        ? 'border-red-500 text-red-400'
                                        : 'border-slate-500 text-muted-foreground'
                                    }
                                  >
                                    {vehicle.archive_reason}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  {(isAdmin || isManager) && (
                                    <div className="flex items-center justify-end gap-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRestore(vehicle.id, vehicle.reg_number)}
                                        disabled={pendingRestore.has(vehicle.id)}
                                        className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                                        title="Restore to Active"
                                      >
                                        {pendingRestore.has(vehicle.id) ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Undo2 className="h-3 w-3" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handlePermanentDelete(vehicle.id, vehicle.reg_number)}
                                        disabled={pendingDelete.has(vehicle.id)}
                                        className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                        title="Permanently Remove"
                                      >
                                        {pendingDelete.has(vehicle.id) ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <XCircle className="h-3 w-3" />
                                        )}
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className={cn('space-y-3', tabletModeEnabled ? 'block' : 'md:hidden')}>
                      {retiredData.vehicles
                        .filter(vehicle => vehicle.reg_number.toLowerCase().includes(retiredSearchQuery.toLowerCase()))
                        .map((vehicle) => (
                          <Card key={vehicle.id} className="bg-slate-800 border-border">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-3">
                                <div>
                                  <h3 className="font-semibold text-white text-lg">{vehicle.reg_number}</h3>
                                  {vehicle.nickname && <p className="text-xs text-muted-foreground">{vehicle.nickname}</p>}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={
                                    vehicle.archive_reason === 'Sold'
                                      ? 'border-blue-500 text-blue-400'
                                      : vehicle.archive_reason === 'Scrapped'
                                      ? 'border-red-500 text-red-400'
                                      : 'border-slate-500 text-muted-foreground'
                                  }
                                >
                                  {vehicle.archive_reason}
                                </Badge>
                              </div>
                              <div className="space-y-2 text-sm">
                                {vehicle.current_mileage && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Mileage:</span>
                                    <span className="text-white">{formatMileage(vehicle.current_mileage)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Tax Due:</span>
                                  <span className="text-white">{formatMaintenanceDate(vehicle.tax_due_date)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">MOT Due:</span>
                                  <span className="text-white">{formatMaintenanceDate(vehicle.mot_due_date)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Retired:</span>
                                  <span className="text-white">{new Date(vehicle.archived_at).toLocaleDateString()}</span>
                                </div>
                              </div>
                              {(isAdmin || isManager) && (
                                <div className="mt-4 pt-3 border-t border-slate-700 space-y-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRestore(vehicle.id, vehicle.reg_number)}
                                    disabled={pendingRestore.has(vehicle.id)}
                                    className="w-full text-green-400 hover:text-green-300 hover:bg-green-900/20"
                                  >
                                    {pendingRestore.has(vehicle.id) ? (
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
                                    onClick={() => handlePermanentDelete(vehicle.id, vehicle.reg_number)}
                                    disabled={pendingDelete.has(vehicle.id)}
                                    className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20"
                                  >
                                    {pendingDelete.has(vehicle.id) ? (
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
                              )}
                            </CardContent>
                          </Card>
                        ))}
                    </div>
                  </>
                )
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      
      {/* Edit Dialog */}
      <EditMaintenanceDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        vehicle={selectedVehicle}
        onSuccess={() => {
          setEditDialogOpen(false);
          setSelectedVehicle(null);
        }}
        onRetire={() => {
          setDeleteDialogOpen(true);
        }}
      />
      
      {/* History Dialog */}
      
      {/* Add Vehicle Dialog */}
      <AddAssetFlowDialog
        open={addVehicleDialogOpen}
        onOpenChange={setAddVehicleDialogOpen}
        onSuccess={() => {
          setAddVehicleDialogOpen(false);
          onVehicleAdded?.();
        }}
      />
      
      {/* Delete Vehicle Dialog */}
      <DeleteVehicleDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        vehicle={selectedVehicle ? {
          id: selectedVehicle.van_id ?? selectedVehicle.hgv_id ?? selectedVehicle.vehicle?.id ?? '',
          reg_number: selectedVehicle.vehicle?.reg_number ?? selectedVehicle.vehicle?.plant_id ?? 'Unknown',
          category: selectedVehicle.vehicle?.category_id ? { name: 'Vehicle' } : null
        } : null}
        endpoint={isHgvTable ? 'hgvs' : 'vans'}
        entityLabel={isHgvTable ? 'HGV' : 'Van'}
        onSuccess={() => {
          setDeleteDialogOpen(false);
          setSelectedVehicle(null);
          if (isHgvTable) fetchRetiredHgvs();
          onVehicleAdded?.(); // Refresh the list
        }}
      />
    </>
  );
}
