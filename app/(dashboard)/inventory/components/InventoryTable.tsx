'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronDown,
  ChevronUp,
  MapPin,
  PackageSearch,
  Search,
  Truck,
} from 'lucide-react';
import {
  formatInventoryDate,
  getCheckStatusLabel,
  getInventoryCheckStatus,
  getInventoryDueDate,
} from '../utils';
import { formatInventoryCategoryLabel, type InventoryCheckStatus, type InventoryItem, type InventoryLocation } from '../types';

type InventoryFilter = 'all' | InventoryCheckStatus | 'yard' | 'noloc';
type SortField = 'item_number' | 'name' | 'location' | 'last_checked_at';
type SortDir = 'asc' | 'desc';
const ALL_LOCATIONS_FILTER = 'all';
const INVENTORY_TABLE_PAGE_SIZE = 50;

interface InventoryTableProps {
  items: InventoryItem[];
  selectedItemIds: Set<string>;
  onSelectedItemIdsChange: (selectedItemIds: Set<string>) => void;
  onEdit?: (item: InventoryItem) => void;
  onMove: (items: InventoryItem[]) => void;
  onOpenDetails?: (item: InventoryItem) => void;
  locationFilterLocations?: InventoryLocation[];
  categoryLabels?: Record<string, string>;
}

const filters: Array<{ value: InventoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'due_soon', label: 'Due Soon' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'needs_check', label: 'Needs Check' },
  { value: 'yard', label: 'Yard' },
  { value: 'noloc', label: 'No Location' },
];

function getStatusBadgeClass(status: InventoryCheckStatus): string {
  if (status === 'overdue') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'due_soon') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'needs_check') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

function isNoLocationItem(item: InventoryItem): boolean {
  return !item.location_id;
}

function renderLocationWithHint(item: InventoryItem) {
  const isUnassigned = !item.location_id;
  const locationName = item.location?.name || 'No location assigned';
  if (!isNoLocationItem(item) || !item.source_location_hint) {
    return isUnassigned ? <span className="italic text-slate-400">{locationName}</span> : locationName;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`cursor-help underline decoration-slate-500 decoration-dotted underline-offset-4 ${isUnassigned ? 'italic text-slate-400' : ''}`}>
          {locationName}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        <div className="font-medium text-white">Spreadsheet location</div>
        <div>{item.source_location_hint}</div>
        {item.source_location_rows ? (
          <div className="text-[11px] text-slate-300">COMPLETE LIST row(s): {item.source_location_rows}</div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function getVanLocationNickname(item: InventoryItem): string | null {
  if (item.location?.linked_asset_type !== 'van') return null;
  return item.location.linked_asset_nickname?.trim() || null;
}

function renderLocationDetails(item: InventoryItem) {
  const linkedVanNickname = getVanLocationNickname(item);

  return (
    <div>
      <div>{renderLocationWithHint(item)}</div>
      {linkedVanNickname ? (
        <div className="text-xs text-muted-foreground">{linkedVanNickname}</div>
      ) : null}
    </div>
  );
}

export function InventoryTable({
  items,
  selectedItemIds,
  onSelectedItemIdsChange,
  onEdit,
  onMove,
  onOpenDetails,
  locationFilterLocations,
  categoryLabels,
}: InventoryTableProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const [locationFilterId, setLocationFilterId] = useState(ALL_LOCATIONS_FILTER);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pagination, setPagination] = useState({ key: '', limit: INVENTORY_TABLE_PAGE_SIZE });
  const showLocationFilter = Boolean(locationFilterLocations?.length);
  const paginationKey = `${filter}:${locationFilterId}:${search.trim()}:${sortField}:${sortDir}:${items.length}`;
  const visibleItemLimit = pagination.key === paginationKey ? pagination.limit : INVENTORY_TABLE_PAGE_SIZE;

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const locationName = item.location?.name || '';
      const linkedVanNickname = getVanLocationNickname(item) || '';
      const checkStatus = getInventoryCheckStatus(item);

      if (locationFilterId !== ALL_LOCATIONS_FILTER && item.location_id !== locationFilterId) return false;
      if (filter === 'yard' && locationName.toLowerCase() !== 'yard') return false;
      if (filter === 'noloc' && item.location_id) return false;
      if (filter !== 'all' && filter !== 'yard' && filter !== 'noloc' && checkStatus !== filter) return false;

      if (!query) return true;
      return (
        item.item_number.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        locationName.toLowerCase().includes(query) ||
        linkedVanNickname.toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      const aValue = sortField === 'location' ? a.location?.name || '' : a[sortField] || '';
      const bValue = sortField === 'location' ? b.location?.name || '' : b[sortField] || '';
      const compare = String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? compare : -compare;
    });
  }, [filter, items, locationFilterId, search, sortDir, sortField]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleItemLimit),
    [filteredItems, visibleItemLimit]
  );

  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedItemIds.has(item.id)),
    [visibleItems, selectedItemIds]
  );

  useEffect(() => {
    const visibleItemIds = new Set(visibleItems.map((item) => item.id));
    const nextSelectedItemIds = new Set(
      Array.from(selectedItemIds).filter((itemId) => visibleItemIds.has(itemId))
    );

    if (nextSelectedItemIds.size !== selectedItemIds.size) {
      onSelectedItemIdsChange(nextSelectedItemIds);
    }
  }, [onSelectedItemIdsChange, selectedItemIds, visibleItems]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDir('asc');
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="ml-1 inline h-3 w-3" />
      : <ChevronDown className="ml-1 inline h-3 w-3" />;
  }

  function toggleSelected(itemId: string, checked: boolean) {
    const next = new Set(selectedItemIds);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    onSelectedItemIdsChange(next);
  }

  function toggleVisibleItems(checked: boolean) {
    const next = new Set(selectedItemIds);
    visibleItems.forEach((item) => {
      if (checked) next.add(item.id);
      else next.delete(item.id);
    });
    onSelectedItemIdsChange(next);
  }

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedItemIds.has(item.id));
  const hasMoreItems = visibleItemLimit < filteredItems.length;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search inventory..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bg-slate-800 border-slate-600 pl-9 text-white placeholder:text-muted-foreground"
          />
        </div>

        {selectedItems.length > 0 ? (
          <Button
            variant="outline"
            onClick={() => onMove(selectedItems)}
            className="border-slate-600 text-white hover:bg-slate-800"
          >
            <Truck className="mr-2 h-4 w-4" />
            Move Selected ({selectedItems.length})
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Inventory Filters</p>
          <div className="flex flex-wrap gap-2">
            {filters.map((filterOption) => (
              <Button
                key={filterOption.value}
                variant={filter === filterOption.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(filterOption.value)}
                className={filter === filterOption.value
                  ? 'bg-inventory text-white hover:bg-inventory-dark'
                  : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'
                }
              >
                {filterOption.label}
              </Button>
            ))}
          </div>
        </div>

        {showLocationFilter ? (
          <div className="w-full space-y-2 lg:w-72">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Select Location Bin</p>
            <Select value={locationFilterId} onValueChange={setLocationFilterId}>
              <SelectTrigger className="border-slate-600 bg-slate-800 text-white">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LOCATIONS_FILTER}>All</SelectItem>
                {(locationFilterLocations || []).map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-slate-700 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/80">
              <th className="w-10 px-4 py-3 text-left">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(checked) => toggleVisibleItems(checked === true)}
                  aria-label="Select visible inventory items"
                />
              </th>
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('item_number')}>
                ID {renderSortIcon('item_number')}
              </th>
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('name')}>
                Name {renderSortIcon('name')}
              </th>
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('location')}>
                Location {renderSortIcon('location')}
              </th>
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('last_checked_at')}>
                Last Checked {renderSortIcon('last_checked_at')}
              </th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Check Status</th>
              <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  {search ? 'No inventory items match your search.' : 'No inventory items found.'}
                </td>
              </tr>
            ) : (
              visibleItems.map((item) => {
                const checkStatus = getInventoryCheckStatus(item);
                return (
                  <tr
                    key={item.id}
                    className={onOpenDetails ? 'cursor-pointer transition-colors hover:bg-slate-800/50' : 'transition-colors hover:bg-slate-800/50'}
                    onClick={() => onOpenDetails?.(item)}
                  >
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={selectedItemIds.has(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                        aria-label={`Select ${item.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-white">{item.item_number}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{formatInventoryCategoryLabel(item.category, categoryLabels)}</div>
                      {item.group ? (
                        <Badge variant="outline" className="mt-1 border-purple-500/30 bg-purple-500/10 text-purple-200">
                          Group: {item.group.name}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{renderLocationDetails(item)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <div>{formatInventoryDate(item.last_checked_at)}</div>
                      <div className="text-xs text-muted-foreground">Due {getInventoryDueDate(item.last_checked_at, item.check_interval_days || undefined)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={getStatusBadgeClass(checkStatus)}>
                        {getCheckStatusLabel(checkStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMove([item]); }} className="border-slate-600">
                          Move
                        </Button>
                        {onEdit ? (
                          <Button size="sm" onClick={(event) => { event.stopPropagation(); onEdit(item); }} className="bg-inventory text-white hover:bg-inventory-dark">
                            Edit
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            {search ? 'No inventory items match your search.' : 'No inventory items found.'}
          </div>
        ) : (
          visibleItems.map((item) => {
            const checkStatus = getInventoryCheckStatus(item);
            return (
              <div
                key={item.id}
                className={onOpenDetails ? 'cursor-pointer rounded-lg border border-slate-700 bg-slate-800/50 p-4' : 'rounded-lg border border-slate-700 bg-slate-800/50 p-4'}
                onClick={() => onOpenDetails?.(item)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <Checkbox
                      checked={selectedItemIds.has(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                      aria-label={`Select ${item.name}`}
                    />
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-white">
                        <PackageSearch className="h-4 w-4 text-inventory" />
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.item_number}</div>
                      {item.group ? (
                        <Badge variant="outline" className="mt-1 border-purple-500/30 bg-purple-500/10 text-purple-200">
                          Group: {item.group.name}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <Badge variant="outline" className={getStatusBadgeClass(checkStatus)}>
                    {getCheckStatusLabel(checkStatus)}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <div className="flex items-start gap-1">
                    <MapPin className="mt-0.5 h-3 w-3" />
                    {renderLocationDetails(item)}
                  </div>
                  <span>Last: {formatInventoryDate(item.last_checked_at)}</span>
                  <span>Due: {getInventoryDueDate(item.last_checked_at, item.check_interval_days || undefined)}</span>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMove([item]); }} className="flex-1 border-slate-600">
                    Move
                  </Button>
                  {onEdit ? (
                    <Button size="sm" onClick={(event) => { event.stopPropagation(); onEdit(item); }} className="flex-1 bg-inventory text-white hover:bg-inventory-dark">
                      Edit
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {hasMoreItems ? (
        <div className="flex flex-col items-center gap-2 border-t border-slate-700/60 pt-4">
          <p className="text-xs text-muted-foreground">
            Showing {visibleItems.length} of {filteredItems.length} inventory items
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPagination({ key: paginationKey, limit: visibleItemLimit + INVENTORY_TABLE_PAGE_SIZE })}
            className="border-slate-600 text-white hover:bg-slate-800"
          >
            Show More
          </Button>
        </div>
      ) : filteredItems.length > INVENTORY_TABLE_PAGE_SIZE ? (
        <p className="border-t border-slate-700/60 pt-4 text-center text-xs text-muted-foreground">
          Showing all {filteredItems.length} inventory items
        </p>
      ) : null}
    </div>
    </TooltipProvider>
  );
}
