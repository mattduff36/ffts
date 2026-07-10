'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { MultiSelectFilter, type MultiSelectFilterOption } from '@/components/ui/multi-select-filter';
import {
  ChevronDown,
  ChevronUp,
  Archive,
  MapPin,
  PackageSearch,
  RotateCcw,
  Search,
  Truck,
} from 'lucide-react';
import {
  formatInventoryDate,
  formatInventoryUnknownLocationAge,
  getCheckStatusLabel,
  getInventoryCheckIntervalMonths,
  getInventoryCheckStatus,
  getInventoryDueDate,
  getInventoryLocationsWithYardFirst,
  isInventoryCheckExempt,
  isInventoryYardLocation,
  isInventoryUnknownLocation,
  shouldMuteInventoryCheckBadge,
} from '../utils';
import {
  INVENTORY_RETIRE_REASONS,
  formatInventoryCategoryLabel,
  type InventoryCheckStatus,
  type InventoryItem,
  type InventoryLocation,
  type InventoryRetireReason,
} from '../types';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';

type SortField = 'item_number' | 'serial_number' | 'name' | 'location' | 'last_checked_at';
type SortDir = 'asc' | 'desc';
const NO_LOCATION_FILTER = '__no_location__';
const INVENTORY_STATUS_FILTER_ORDER: InventoryCheckStatus[] = ['overdue', 'due_soon', 'needs_check', 'not_required', 'ok'];
const LOCATION_FILTER_GROUP_ORDER = ['manual', 'van', 'site', 'legacy_quote', 'hgv', 'plant', 'unknown'] as const;
const COLLAPSIBLE_LOCATION_FILTER_GROUPS = ['Vans', 'Sites', 'Legacy Sites', 'HGVs', 'Plant'] as const;
const LOCATION_FILTER_MINIMUM_SEARCH_CHARACTERS = {
  'Legacy Sites': 3,
} as const;

interface InventoryTableProps {
  items: InventoryItem[];
  selectedItemIds: Set<string>;
  onSelectedItemIdsChange: (selectedItemIds: Set<string>) => void;
  onDelete?: (item: InventoryItem) => void;
  onRestore?: (item: InventoryItem) => void;
  onMove: (items: InventoryItem[]) => void;
  onBulkAction?: (items: InventoryItem[]) => void;
  bulkActionLabel?: string;
  onOpenDetails?: (item: InventoryItem) => void;
  locationFilterLocations?: InventoryLocation[];
  categoryLabels?: Record<string, string>;
  tableLabel?: string;
  showMinorPlantDetails?: boolean;
  retiredMode?: boolean;
  quickFilter?: InventoryTableQuickFilter;
}

export interface InventoryTableQuickFilter {
  version: number;
  statusFilters: InventoryCheckStatus[];
  locationFilters: string[];
  search: string;
}

function getStatusBadgeClass(status: InventoryCheckStatus, item?: InventoryItem): string {
  if (item && shouldMuteInventoryCheckBadge(item)) return 'border-slate-600/30 bg-slate-700/20 text-slate-300';
  if (status === 'overdue') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'due_soon') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'needs_check') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  if (status === 'not_required') return 'border-slate-700 bg-slate-800/30 text-slate-500';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

function getRetireReasonBadgeClass(reason: InventoryRetireReason | null): string {
  if (reason === 'Sold' || reason === 'Returned') return 'border-green-500/30 bg-green-500/10 text-green-200';
  if (reason === 'Scrapped' || reason === 'Damaged') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (reason === 'Lost') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
}

function renderLocation(item: InventoryItem) {
  const isUnassigned = !item.location_id;
  const isMutedLocation = isUnassigned || isInventoryUnknownLocation(item.location);
  const locationName = item.location?.name || 'No location assigned';
  return isMutedLocation ? <span className="italic text-slate-400">{locationName}</span> : locationName;
}

function getVanLocationNickname(item: InventoryItem): string | null {
  if (item.location?.linked_asset_type !== 'van') return null;
  return item.location.linked_asset_nickname?.trim() || null;
}

function getLocationFilterGroupKey(location: InventoryLocation): (typeof LOCATION_FILTER_GROUP_ORDER)[number] {
  if (location.location_type === 'van') return 'van';
  if (location.location_type === 'site' && location.source_type === 'legacy_quote') return 'legacy_quote';
  if (location.location_type === 'site') return 'site';
  if (location.location_type === 'hgv') return 'hgv';
  if (location.location_type === 'plant') return 'plant';
  if (location.location_type === 'unknown') return 'unknown';
  return 'manual';
}

function getLocationFilterGroupLabel(location: InventoryLocation): string {
  const groupKey = getLocationFilterGroupKey(location);
  if (groupKey === 'van') return 'Vans';
  if (groupKey === 'site') return 'Sites';
  if (groupKey === 'legacy_quote') return 'Legacy Sites';
  if (groupKey === 'hgv') return 'HGVs';
  if (groupKey === 'plant') return 'Plant';
  if (groupKey === 'unknown') return 'Unknown';
  return 'Manual Locations';
}

function getLocationFilterLabel(location: InventoryLocation): string {
  const linkedAssetLabel = [location.linked_asset_label, location.linked_asset_nickname]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' - ');

  if (linkedAssetLabel) return `[${linkedAssetLabel}]`;

  if (location.location_type === 'site' && location.external_reference) {
    if (location.source_type === 'legacy_quote') {
      const legacyTitle = location.name
        .replace(/^legacy quote\s*-\s*/i, '')
        .replace(new RegExp(`^${location.external_reference}\\s*-\\s*`, 'i'), '')
        .trim();
      return legacyTitle ? `[${location.external_reference} - ${legacyTitle}]` : `[${location.external_reference}]`;
    }

    const siteTitle = location.name
      .replace(/^site\s*-\s*/i, '')
      .replace(new RegExp(`^${location.external_reference}\\s*-\\s*`, 'i'), '')
      .trim();
    return siteTitle ? `[${location.external_reference} - ${siteTitle}]` : `[${location.external_reference}]`;
  }

  return location.name;
}

function getLocationFilterDescription(location: InventoryLocation): string {
  return location.assigned_user_names?.length ? location.assigned_user_names.join(', ') : 'Unassigned';
}

function renderLocationDetails(item: InventoryItem) {
  const linkedVanNickname = getVanLocationNickname(item);

  return (
    <div>
      <div>{renderLocation(item)}</div>
      {linkedVanNickname ? (
        <div className="text-xs text-muted-foreground">{linkedVanNickname}</div>
      ) : null}
    </div>
  );
}

function renderCheckDueDetails(item: InventoryItem) {
  if (isInventoryCheckExempt(item)) {
    return formatInventoryUnknownLocationAge(item) || 'No check required';
  }

  if (!item.last_checked_at) {
    return isInventoryYardLocation(item.location) ? 'Check required before leaving Yard' : null;
  }

  const dueText = `Due ${getInventoryDueDate(item.last_checked_at, getInventoryCheckIntervalMonths(item))}`;
  return isInventoryYardLocation(item.location) ? `${dueText} - required before leaving Yard` : dueText;
}

export function InventoryTable({
  items,
  selectedItemIds,
  onSelectedItemIdsChange,
  onDelete,
  onRestore,
  onMove,
  onBulkAction,
  bulkActionLabel,
  onOpenDetails,
  locationFilterLocations,
  categoryLabels,
  tableLabel = 'inventory',
  showMinorPlantDetails = false,
  retiredMode = false,
  quickFilter,
}: InventoryTableProps) {
  const [search, setSearch] = useState(() => quickFilter?.search || '');
  const [statusFilters, setStatusFilters] = useState<InventoryCheckStatus[]>(
    () => retiredMode ? [] : quickFilter?.statusFilters || []
  );
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>(() => quickFilter?.locationFilters || []);
  const [retireReasonFilters, setRetireReasonFilters] = useState<InventoryRetireReason[]>([]);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const showLocationFilter = Boolean(locationFilterLocations?.length);
  const showSerialNumberColumn = showMinorPlantDetails && items.some((item) => Boolean(item.minor_plant_detail?.serial_number));
  const paginationKey = [
    statusFilters.join(','),
    categoryFilters.join(','),
    locationFilters.join(','),
    retireReasonFilters.join(','),
    search.trim(),
    sortField,
    sortDir,
    items.length,
  ].join(':');

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const locationName = item.location?.name || '';
      const linkedVanNickname = getVanLocationNickname(item) || '';
      const serialNumber = item.minor_plant_detail?.serial_number || '';
      const checkStatus = getInventoryCheckStatus(item);
      const retireReason = item.retire_reason || '';

      if (categoryFilters.length > 0 && !categoryFilters.includes(item.category)) return false;

      if (locationFilters.length > 0) {
        const locationMatches = item.location_id
          ? locationFilters.includes(item.location_id)
          : locationFilters.includes(NO_LOCATION_FILTER);
        if (!locationMatches) return false;
      }

      if (!retiredMode) {
        if (statusFilters.length > 0 && !statusFilters.includes(checkStatus)) return false;
      } else if (retireReasonFilters.length > 0) {
        if (!item.retire_reason || !retireReasonFilters.includes(item.retire_reason)) return false;
      }

      if (!query) return true;
      return (
        item.item_number.toLowerCase().includes(query) ||
        serialNumber.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        locationName.toLowerCase().includes(query) ||
        linkedVanNickname.toLowerCase().includes(query) ||
        retireReason.toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      const aValue = sortField === 'location'
        ? a.location?.name || ''
        : sortField === 'serial_number'
          ? a.minor_plant_detail?.serial_number || ''
          : retiredMode && sortField === 'last_checked_at'
            ? a.retired_at || ''
            : a[sortField] || '';
      const bValue = sortField === 'location'
        ? b.location?.name || ''
        : sortField === 'serial_number'
          ? b.minor_plant_detail?.serial_number || ''
          : retiredMode && sortField === 'last_checked_at'
            ? b.retired_at || ''
            : b[sortField] || '';
      const compare = String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? compare : -compare;
    });
  }, [categoryFilters, items, locationFilters, retireReasonFilters, retiredMode, search, sortDir, sortField, statusFilters]);

  const {
    visibleItems,
    showMore,
  } = useLoadMorePagination(filteredItems, { resetKey: paginationKey });

  const selectedItems = useMemo(
    () => retiredMode ? [] : visibleItems.filter((item) => selectedItemIds.has(item.id)),
    [retiredMode, visibleItems, selectedItemIds]
  );
  const statusFilterOptions = useMemo<MultiSelectFilterOption<InventoryCheckStatus>[]>(
    () => {
      const counts = items.reduce<Record<InventoryCheckStatus, number>>(
        (acc, item) => {
          const status = getInventoryCheckStatus(item);
          acc[status] += 1;
          return acc;
        },
        { ok: 0, due_soon: 0, overdue: 0, needs_check: 0, not_required: 0 }
      );

      return INVENTORY_STATUS_FILTER_ORDER
        .filter((status) => counts[status] > 0)
        .map((status) => ({
          value: status,
          label: getCheckStatusLabel(status),
          count: counts[status],
        }));
    },
    [items]
  );
  const categoryFilterOptions = useMemo<MultiSelectFilterOption<string>[]>(
    () => {
      const counts = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1;
        return acc;
      }, {});

      return Object.entries(counts)
        .map(([category, count]) => ({
          value: category,
          label: formatInventoryCategoryLabel(category, categoryLabels),
          count,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    [categoryLabels, items]
  );
  const locationFilterOptions = useMemo<MultiSelectFilterOption<string>[]>(
    () => {
      const counts = items.reduce<Record<string, number>>((acc, item) => {
        const key = item.location_id || NO_LOCATION_FILTER;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const groupOrderByKey = new Map<string, number>(
        LOCATION_FILTER_GROUP_ORDER.map((groupKey, index) => [groupKey, index])
      );
      const options = getInventoryLocationsWithYardFirst(locationFilterLocations || [])
        .filter((location) => getLocationFilterGroupKey(location) !== 'unknown')
        .sort((a, b) => {
          const aGroup = getLocationFilterGroupKey(a);
          const bGroup = getLocationFilterGroupKey(b);
          const groupCompare = (groupOrderByKey.get(aGroup) || 0) - (groupOrderByKey.get(bGroup) || 0);
          if (groupCompare !== 0) return groupCompare;
          return getLocationFilterLabel(a).localeCompare(getLocationFilterLabel(b), undefined, { sensitivity: 'base' });
        })
        .map((location) => ({
          value: location.id,
          label: getLocationFilterLabel(location),
          description: getLocationFilterDescription(location),
          groupLabel: getLocationFilterGroupKey(location) === 'manual' ? undefined : getLocationFilterGroupLabel(location),
          searchLabel: [
            location.name,
            location.external_reference,
            location.linked_asset_label,
            location.linked_asset_nickname,
            getLocationFilterDescription(location),
            getLocationFilterGroupLabel(location),
          ].filter(Boolean).join(' '),
          count: counts[location.id] || 0,
        }));

      return options;
    },
    [items, locationFilterLocations]
  );
  const retireReasonFilterOptions = useMemo<MultiSelectFilterOption<InventoryRetireReason>[]>(
    () => {
      const counts = items.reduce<Record<InventoryRetireReason, number>>(
        (acc, item) => {
          if (item.retire_reason) acc[item.retire_reason] += 1;
          return acc;
        },
        { Sold: 0, Scrapped: 0, Lost: 0, Damaged: 0, Returned: 0, Other: 0 }
      );

      return INVENTORY_RETIRE_REASONS
        .filter((reason) => counts[reason] > 0)
        .map((reason) => ({
          value: reason,
          label: reason,
          count: counts[reason],
        }));
    },
    [items]
  );
  const showCategoryFilter = categoryFilterOptions.length > 1;
  const hasAnyFilters =
    statusFilters.length > 0 ||
    categoryFilters.length > 0 ||
    locationFilters.length > 0 ||
    retireReasonFilters.length > 0;
  const hasSearchOrFilters = Boolean(search.trim()) || hasAnyFilters;

  useEffect(() => {
    if (retiredMode) return;
    const visibleItemIds = new Set(visibleItems.map((item) => item.id));
    const nextSelectedItemIds = new Set(
      Array.from(selectedItemIds).filter((itemId) => visibleItemIds.has(itemId))
    );

    if (nextSelectedItemIds.size !== selectedItemIds.size) {
      onSelectedItemIdsChange(nextSelectedItemIds);
    }
  }, [onSelectedItemIdsChange, retiredMode, selectedItemIds, visibleItems]);

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

  function clearFilters() {
    setStatusFilters([]);
    setCategoryFilters([]);
    setLocationFilters([]);
    setRetireReasonFilters([]);
  }

  const allVisibleSelected = !retiredMode && visibleItems.length > 0 && visibleItems.every((item) => selectedItemIds.has(item.id));
  const emptyColSpan = (showSerialNumberColumn ? 8 : 7) - (retiredMode ? 1 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${tableLabel}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bg-slate-800 border-slate-600 pl-9 text-white placeholder:text-muted-foreground"
          />
        </div>

        {selectedItems.length > 0 ? (
          <Button
            variant="outline"
            onClick={() => (onBulkAction || onMove)(selectedItems)}
            className="border-slate-600 text-white hover:bg-slate-800"
          >
            <Truck className="mr-2 h-4 w-4" />
            {bulkActionLabel || 'Move Selected'} ({selectedItems.length})
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 lg:items-end">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Filters</p>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          {hasAnyFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
            >
              Reset Filters
            </Button>
          ) : null}

          {!retiredMode && statusFilterOptions.length > 0 ? (
            <MultiSelectFilter
              label="Check Status"
              allLabel="All status"
              selectedValues={statusFilters}
              options={statusFilterOptions}
              onSelectedValuesChange={setStatusFilters}
              triggerClassName="sm:w-[170px]"
            />
          ) : null}

          {showCategoryFilter ? (
            <MultiSelectFilter
              label="Category"
              allLabel="All categories"
              selectedValues={categoryFilters}
              options={categoryFilterOptions}
              onSelectedValuesChange={setCategoryFilters}
              triggerClassName="sm:w-[170px]"
            />
          ) : null}

          {retiredMode && retireReasonFilterOptions.length > 0 ? (
            <MultiSelectFilter
              label="Retire Reason"
              allLabel="All reasons"
              selectedValues={retireReasonFilters}
              options={retireReasonFilterOptions}
              onSelectedValuesChange={setRetireReasonFilters}
              triggerClassName="sm:w-[170px]"
            />
          ) : null}

          {showLocationFilter && locationFilterOptions.length > 0 ? (
            <MultiSelectFilter
              label="Location"
              allLabel="All locations"
              selectedValues={locationFilters}
              options={locationFilterOptions}
              onSelectedValuesChange={setLocationFilters}
              triggerClassName="sm:w-[260px]"
              panelClassName="left-auto right-0 max-h-[min(36rem,calc(100vh-8rem))] w-[min(28rem,calc(100vw-2rem))]"
              searchable
              searchPlaceholder="Search locations..."
              emptyLabel="No locations found"
              allOptionPosition="bottom"
              showPanelLabel={false}
              collapsibleGroupLabels={COLLAPSIBLE_LOCATION_FILTER_GROUPS}
              minimumSearchCharactersByGroupLabel={LOCATION_FILTER_MINIMUM_SEARCH_CHARACTERS}
            />
          ) : null}
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-slate-700 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/80">
              {!retiredMode ? (
                <th className="w-10 px-4 py-3 text-left">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) => toggleVisibleItems(checked === true)}
                    aria-label="Select visible inventory items"
                  />
                </th>
              ) : null}
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('item_number')}>
                ID {renderSortIcon('item_number')}
              </th>
              {showSerialNumberColumn ? (
                <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('serial_number')}>
                  Serial Number {renderSortIcon('serial_number')}
                </th>
              ) : null}
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('name')}>
                Name {renderSortIcon('name')}
              </th>
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('location')}>
                Location {renderSortIcon('location')}
              </th>
              <th className="w-28 cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('last_checked_at')}>
                {retiredMode ? 'Retired' : 'Last Checked'} {renderSortIcon('last_checked_at')}
              </th>
              <th className="w-36 px-4 py-3 text-left font-semibold text-muted-foreground">{retiredMode ? 'Reason' : 'Check Status'}</th>
              <th className="w-36 px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={emptyColSpan} className="py-12 text-center text-muted-foreground">
                  {hasSearchOrFilters ? `No ${tableLabel} items match your search or filters.` : `No ${tableLabel} items found.`}
                </td>
              </tr>
            ) : (
              visibleItems.map((item) => {
                const checkStatus = getInventoryCheckStatus(item);
                const checkDueDetails = renderCheckDueDetails(item);
                return (
                  <tr
                    key={item.id}
                    className={onOpenDetails ? 'cursor-pointer transition-colors hover:bg-slate-800/50' : 'transition-colors hover:bg-slate-800/50'}
                    onClick={() => onOpenDetails?.(item)}
                  >
                    {!retiredMode ? (
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedItemIds.has(item.id)}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                          aria-label={`Select ${item.name}`}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3 font-medium text-white">{item.item_number}</td>
                    {showSerialNumberColumn ? (
                      <td className="px-4 py-3 text-slate-300">{item.minor_plant_detail?.serial_number || 'Not recorded'}</td>
                    ) : null}
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
                    <td className="w-28 px-4 py-3 text-slate-300">
                      <div>{formatInventoryDate(retiredMode ? item.retired_at : item.last_checked_at)}</div>
                      {!retiredMode && checkDueDetails ? (
                        <div className="whitespace-nowrap text-[11px] leading-4 text-muted-foreground">{checkDueDetails}</div>
                      ) : null}
                    </td>
                    <td className="w-36 px-4 py-3">
                      {retiredMode ? (
                        <Badge variant="outline" className={`whitespace-nowrap ${getRetireReasonBadgeClass(item.retire_reason)}`}>
                          {item.retire_reason || 'Other'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={`whitespace-nowrap ${getStatusBadgeClass(checkStatus, item)}`}>
                          {getCheckStatusLabel(checkStatus)}
                        </Badge>
                      )}
                    </td>
                    <td className="w-36 px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {!retiredMode ? (
                          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMove([item]); }} className="border-slate-600">
                            Move
                          </Button>
                        ) : null}
                        {retiredMode && onRestore ? (
                          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onRestore(item); }} className="border-green-500/40 text-green-200 hover:bg-green-500/10">
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Restore
                          </Button>
                        ) : null}
                        {!retiredMode && onDelete ? (
                          <Button
                            onClick={(event) => { event.stopPropagation(); onDelete(item); }}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                            aria-label={`Retire ${item.name}`}
                            title="Retire item"
                          >
                            <Archive className="h-4 w-4" />
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
            {hasSearchOrFilters ? `No ${tableLabel} items match your search or filters.` : `No ${tableLabel} items found.`}
          </div>
        ) : (
          visibleItems.map((item) => {
            const checkStatus = getInventoryCheckStatus(item);
            const checkDueDetails = renderCheckDueDetails(item);
            return (
              <div
                key={item.id}
                className={onOpenDetails ? 'cursor-pointer rounded-lg border border-slate-700 bg-slate-800/50 p-4' : 'rounded-lg border border-slate-700 bg-slate-800/50 p-4'}
                onClick={() => onOpenDetails?.(item)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    {!retiredMode ? (
                      <Checkbox
                        checked={selectedItemIds.has(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                        aria-label={`Select ${item.name}`}
                      />
                    ) : null}
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-white">
                        <PackageSearch className="h-4 w-4 text-inventory" />
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.item_number}</div>
                      {showSerialNumberColumn ? (
                        <div className="text-xs text-muted-foreground">Serial: {item.minor_plant_detail?.serial_number || 'Not recorded'}</div>
                      ) : null}
                      {item.group ? (
                        <Badge variant="outline" className="mt-1 border-purple-500/30 bg-purple-500/10 text-purple-200">
                          Group: {item.group.name}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {retiredMode ? (
                    <Badge variant="outline" className={getRetireReasonBadgeClass(item.retire_reason)}>
                      {item.retire_reason || 'Other'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className={getStatusBadgeClass(checkStatus, item)}>
                      {getCheckStatusLabel(checkStatus)}
                    </Badge>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <div className="flex items-start gap-1">
                    <MapPin className="mt-0.5 h-3 w-3" />
                    {renderLocationDetails(item)}
                  </div>
                  <span>{retiredMode ? 'Retired' : 'Last'}: {formatInventoryDate(retiredMode ? item.retired_at : item.last_checked_at)}</span>
                  {!retiredMode && checkDueDetails ? (
                    <span>{checkDueDetails}</span>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!retiredMode ? (
                    <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMove([item]); }} className="flex-1 border-slate-600">
                      Move
                    </Button>
                  ) : null}
                  {retiredMode && onRestore ? (
                    <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onRestore(item); }} className="flex-1 border-green-500/40 text-green-200 hover:bg-green-500/10">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Restore
                    </Button>
                  ) : null}
                  {!retiredMode && onDelete ? (
                    <Button
                      onClick={(event) => { event.stopPropagation(); onDelete(item); }}
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                      aria-label={`Retire ${item.name}`}
                      title="Retire item"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <LoadMorePagination
        visibleCount={visibleItems.length}
        totalCount={filteredItems.length}
        itemLabel="inventory items"
        onShowMore={showMore}
      />
    </div>
  );
}
