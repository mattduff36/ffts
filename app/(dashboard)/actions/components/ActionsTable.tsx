'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Search,
  Settings2,
  TriangleAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { formatMileage, getStatusColorClass } from '@/lib/utils/maintenanceCalculations';
import {
  filterReminderActions,
  getReminderAssignmentFilterValue,
  type ReminderActionFilterState,
  type ReminderAssignmentFilter,
} from '@/lib/utils/reminder-action-filters';
import { PanelLoader } from '@/components/ui/panel-loader';
import type { ReminderActionIgnoreDuration, ReminderActionWithAsset, ReminderAssetType } from '@/types/reminders';

const ASSIGNMENT_FILTERS: Array<{ value: ReminderAssignmentFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'has_pending', label: 'Pending' },
];

type SortField = 'asset_primary' | 'asset_nickname' | 'asset_usage' | 'status' | 'latest_submitted' | 'overdue';
type SortDirection = 'asc' | 'desc';

interface ColumnVisibility {
  status: boolean;
  latest_submitted: boolean;
  overdue: boolean;
}

const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  status: true,
  latest_submitted: true,
  overdue: true,
};

const COLUMN_VISIBILITY_STORAGE_KEY = 'actions-table-column-visibility';

function getInitialColumnVisibility(): ColumnVisibility {
  if (typeof window === 'undefined') {
    return DEFAULT_COLUMN_VISIBILITY;
  }

  try {
    const saved = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!saved) {
      return DEFAULT_COLUMN_VISIBILITY;
    }

    const parsed = JSON.parse(saved) as Partial<ColumnVisibility>;
    return { ...DEFAULT_COLUMN_VISIBILITY, ...parsed };
  } catch {
    return DEFAULT_COLUMN_VISIBILITY;
  }
}

function getDaysOverdueLabel(action: ReminderActionWithAsset): string {
  const value = action.metadata?.days_overdue;
  return typeof value === 'number' ? `${value} Days` : 'No check recorded';
}

function hasNeverSubmittedInspection(action: ReminderActionWithAsset): boolean {
  const value = action.metadata?.last_submitted_inspection_date;
  return typeof value !== 'string' || value.length === 0;
}

function getOverdueBadge(action: ReminderActionWithAsset) {
  if (hasNeverSubmittedInspection(action)) {
    return (
      <Badge className="border-red-500/30 bg-red-500/10 text-red-300">
        Check Required
      </Badge>
    );
  }

  return <Badge variant="warning">{getDaysOverdueLabel(action)}</Badge>;
}

function getLatestInspectionLabel(action: ReminderActionWithAsset): string {
  const value = action.metadata?.last_submitted_inspection_date;
  if (typeof value !== 'string' || !value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date).replaceAll('/', '-');
}

function getLatestSubmittedSortValue(action: ReminderActionWithAsset): number {
  const value = action.metadata?.last_submitted_inspection_date;
  if (typeof value !== 'string' || !value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getOverdueSortValue(action: ReminderActionWithAsset): number {
  const value = action.metadata?.days_overdue;
  return typeof value === 'number' ? value : Number.MAX_SAFE_INTEGER;
}

function getMetadataString(action: ReminderActionWithAsset, key: string): string | null {
  const value = action.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getMetadataNumber(action: ReminderActionWithAsset, key: string): number | null {
  const value = action.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getFallbackPrimaryLabel(action: ReminderActionWithAsset): string {
  const label = action.asset_label || action.title;
  return label.replace(/\s+\([^)]*\)$/, '').trim() || 'Unknown';
}

function getFallbackNickname(action: ReminderActionWithAsset): string | null {
  const label = action.asset_label || '';
  const match = label.match(/\(([^)]+)\)$/);
  return match?.[1]?.trim() || null;
}

function getPrimaryAssetValue(action: ReminderActionWithAsset): string {
  if (action.asset_type === 'plant') {
    return getMetadataString(action, 'asset_plant_id')
      || getMetadataString(action, 'asset_registration')
      || getFallbackPrimaryLabel(action);
  }

  return getMetadataString(action, 'asset_registration') || getFallbackPrimaryLabel(action);
}

function getPlantIdSerialDisplay(action: ReminderActionWithAsset): string {
  const plantId = getPrimaryAssetValue(action);
  const serialNumber = getMetadataString(action, 'asset_serial_number');
  return serialNumber ? `${plantId} [${serialNumber}]` : plantId;
}

function getAssetNickname(action: ReminderActionWithAsset): string | null {
  return getMetadataString(action, 'asset_nickname') || getFallbackNickname(action);
}

function getAssetUsageValue(action: ReminderActionWithAsset): number | null {
  if (action.asset_type === 'plant') return getMetadataNumber(action, 'asset_current_hours');
  return getMetadataNumber(action, 'asset_current_mileage');
}

function getAssetColumnLabels(assetType?: ReminderAssetType): {
  primary: string;
  usage: string;
} {
  if (assetType === 'plant') return { primary: 'Plant ID / Serial No', usage: 'Hours' };
  if (assetType === 'hgv') return { primary: 'Registration', usage: 'KM' };
  return { primary: 'Registration', usage: 'Mileage' };
}

function formatAssetUsage(action: ReminderActionWithAsset) {
  const value = getAssetUsageValue(action);
  if (value === null) {
    return <Badge className={`font-medium ${getStatusColorClass('not_set')}`}>Not Set</Badge>;
  }

  if (action.asset_type === 'plant') {
    return <span className="text-muted-foreground">{value.toLocaleString()}h</span>;
  }

  return <span className="text-muted-foreground">{formatMileage(value)}</span>;
}

function getAssignmentStatus(action: ReminderActionWithAsset): {
  label: 'Unassigned' | 'Pending' | 'Actioned';
  order: number;
  variant: 'secondary' | 'warning' | 'success';
} {
  const status = getReminderAssignmentFilterValue(action);
  if (status === 'has_pending') return { label: 'Pending', order: 1, variant: 'warning' };
  if (status === 'fully_actioned') return { label: 'Actioned', order: 2, variant: 'success' };
  return { label: 'Unassigned', order: 0, variant: 'secondary' };
}

interface ActionsTableProps {
  actions: ReminderActionWithAsset[];
  assetType?: ReminderAssetType;
  loading: boolean;
  filters: ReminderActionFilterState;
  onFiltersChange: (filters: ReminderActionFilterState) => void;
  onAssign: (action: ReminderActionWithAsset) => void;
  onIgnore: (action: ReminderActionWithAsset, duration: ReminderActionIgnoreDuration) => void;
}

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={onClick}
      className={cn(
        active
          ? 'border-slate-500 bg-slate-600 text-white hover:bg-slate-500'
          : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50',
      )}
    >
      {label}
    </Button>
  );
}

function SortIcon({ field, sortField, sortDirection }: {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  if (sortField !== field) {
    return <ArrowUpDown className="h-3 w-3" />;
  }

  return sortDirection === 'asc'
    ? <ChevronUp className="h-3 w-3" />
    : <ChevronDown className="h-3 w-3" />;
}

function IgnoreActionPopover({
  action,
  onIgnore,
}: {
  action: ReminderActionWithAsset;
  onIgnore: (action: ReminderActionWithAsset, duration: ReminderActionIgnoreDuration) => void;
}) {
  const [open, setOpen] = useState(false);

  function handleIgnore(duration: ReminderActionIgnoreDuration) {
    setOpen(false);
    onIgnore(action, duration);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="More actions"
          className="h-8 w-8 border-slate-600 text-white hover:bg-slate-800"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        sideOffset={8}
        className="w-48 border-slate-700 bg-slate-900 p-1 text-slate-100"
      >
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start px-2 font-normal text-slate-100 hover:bg-slate-800 hover:text-white"
          onClick={() => handleIgnore('6_weeks')}
        >
          Ignore for 6 weeks
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start px-2 font-normal text-slate-100 hover:bg-slate-800 hover:text-white"
          onClick={() => handleIgnore('1_year')}
        >
          Ignore for 1 year
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start px-2 font-normal text-brand-yellow hover:bg-slate-800 hover:text-brand-yellow"
          onClick={() => handleIgnore('forever')}
        >
          Ignore forever
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function ActionsTable({
  actions,
  assetType,
  loading,
  filters,
  onFiltersChange,
  onAssign,
  onIgnore,
}: ActionsTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('overdue');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(getInitialColumnVisibility);

  function toggleColumn(column: keyof ColumnVisibility) {
    setColumnVisibility((current) => {
      const next = { ...current, [column]: !current[column] };
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection(field === 'asset_usage' || field === 'latest_submitted' || field === 'overdue' ? 'desc' : 'asc');
  }

  const filteredActions = useMemo(
    () => filterReminderActions(actions, filters),
    [actions, filters],
  );

  const sortedActions = useMemo(() => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    return [...filteredActions].sort((left, right) => {
      switch (sortField) {
        case 'asset_primary':
          return multiplier * getPrimaryAssetValue(left).localeCompare(getPrimaryAssetValue(right));
        case 'asset_nickname':
          return multiplier * (getAssetNickname(left) || '').localeCompare(getAssetNickname(right) || '');
        case 'asset_usage':
          return multiplier * ((getAssetUsageValue(left) ?? -1) - (getAssetUsageValue(right) ?? -1));
        case 'status':
          return multiplier * (getAssignmentStatus(left).order - getAssignmentStatus(right).order);
        case 'latest_submitted':
          return multiplier * (getLatestSubmittedSortValue(left) - getLatestSubmittedSortValue(right));
        case 'overdue':
          return multiplier * (getOverdueSortValue(left) - getOverdueSortValue(right));
        default:
          return 0;
      }
    });
  }, [filteredActions, sortDirection, sortField]);

  const assetColumnLabels = getAssetColumnLabels(assetType);
  const paginationKey = [
    assetType || 'all',
    filters.search.trim(),
    filters.assignment,
    sortField,
    sortDirection,
    sortedActions.length,
  ].join(':');
  const {
    visibleItems: visibleActions,
    showMore,
  } = useLoadMorePagination(sortedActions, { resetKey: paginationKey });

  function updateFilters(patch: Partial<ReminderActionFilterState>) {
    onFiltersChange({ ...filters, ...patch });
  }

  function openAssetHistory(action: ReminderActionWithAsset) {
    if (action.asset_route) {
      router.push(action.asset_route);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search actions..."
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            className="border-slate-600 bg-slate-800 pl-9 text-white placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2 lg:flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</p>
          <div className="flex flex-wrap gap-2">
            {ASSIGNMENT_FILTERS.map((option) => (
              <FilterPill
                key={`assignment-${option.value}`}
                active={filters.assignment === option.value}
                label={option.label}
                onClick={() => updateFilters({ assignment: option.value })}
              />
            ))}
          </div>
        </div>

        <div className="w-full space-y-2 lg:w-64">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Table columns</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between border-slate-600 text-white hover:bg-slate-800">
                <span className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Show columns
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border border-border bg-slate-900">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={columnVisibility.status}
                onCheckedChange={() => toggleColumn('status')}
              >
                Status
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={columnVisibility.latest_submitted}
                onCheckedChange={() => toggleColumn('latest_submitted')}
              >
                Latest submitted
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={columnVisibility.overdue}
                onCheckedChange={() => toggleColumn('overdue')}
              >
                Overdue
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading ? (
        <PanelLoader message="Loading actions..." className="py-12" />
      ) : sortedActions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
          <TriangleAlert className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No actions match the current filters.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-700">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                <TableHead
                  className="cursor-pointer text-muted-foreground hover:bg-slate-800/80"
                  onClick={() => handleSort('asset_primary')}
                >
                  <div className="flex items-center gap-2">
                    {assetColumnLabels.primary}
                    <SortIcon field="asset_primary" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer text-muted-foreground hover:bg-slate-800/80"
                  onClick={() => handleSort('asset_nickname')}
                >
                  <div className="flex items-center gap-2">
                    Nickname
                    <SortIcon field="asset_nickname" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer text-muted-foreground hover:bg-slate-800/80"
                  onClick={() => handleSort('asset_usage')}
                >
                  <div className="flex items-center gap-2">
                    {assetColumnLabels.usage}
                    <SortIcon field="asset_usage" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </TableHead>
                {columnVisibility.status ? (
                  <TableHead
                    className="cursor-pointer text-muted-foreground hover:bg-slate-800/80"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-2">
                      Status
                      <SortIcon field="status" sortField={sortField} sortDirection={sortDirection} />
                    </div>
                  </TableHead>
                ) : null}
                {columnVisibility.latest_submitted ? (
                  <TableHead
                    className="cursor-pointer text-muted-foreground hover:bg-slate-800/80"
                    onClick={() => handleSort('latest_submitted')}
                  >
                    <div className="flex items-center gap-2">
                      Latest submitted
                      <SortIcon field="latest_submitted" sortField={sortField} sortDirection={sortDirection} />
                    </div>
                  </TableHead>
                ) : null}
                {columnVisibility.overdue ? (
                  <TableHead
                    className="cursor-pointer text-muted-foreground hover:bg-slate-800/80"
                    onClick={() => handleSort('overdue')}
                  >
                    <div className="flex items-center gap-2">
                      Overdue
                      <SortIcon field="overdue" sortField={sortField} sortDirection={sortDirection} />
                    </div>
                  </TableHead>
                ) : null}
                <TableHead className="text-right text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
              <TableBody>
                {visibleActions.map((action) => (
                <TableRow
                  key={action.id}
                  className={cn(
                    'border-slate-700',
                    action.asset_route && 'cursor-pointer hover:bg-slate-800/50',
                  )}
                  onClick={() => openAssetHistory(action)}
                >
                  <TableCell className="font-medium text-foreground">
                    {action.asset_type === 'plant' ? getPlantIdSerialDisplay(action) : getPrimaryAssetValue(action)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {getAssetNickname(action) || (
                      <span className="text-slate-400 italic">No nickname</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {formatAssetUsage(action)}
                  </TableCell>
                  {columnVisibility.status ? (
                    <TableCell>
                      {getAssignmentStatus(action).label === 'Unassigned' ? (
                        <span className="text-sm italic text-slate-400">Unassigned</span>
                      ) : (
                        <Badge variant={getAssignmentStatus(action).variant}>
                          {getAssignmentStatus(action).label}
                        </Badge>
                      )}
                    </TableCell>
                  ) : null}
                  {columnVisibility.latest_submitted ? (
                    <TableCell className="text-sm text-muted-foreground">
                      {getLatestInspectionLabel(action)}
                    </TableCell>
                  ) : null}
                  {columnVisibility.overdue ? (
                    <TableCell>
                      {getOverdueBadge(action)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onAssign(action)}
                        className="border-slate-600 text-white hover:bg-slate-800"
                      >
                        Assign
                      </Button>
                      <IgnoreActionPopover action={action} onIgnore={onIgnore} />
                    </div>
                  </TableCell>
                </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <LoadMorePagination
            visibleCount={visibleActions.length}
            totalCount={sortedActions.length}
            itemLabel="actions"
            onShowMore={showMore}
          />
        </>
      )}
    </div>
  );
}
