'use client';

import { Fragment, useMemo, useState, type ComponentType, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ClipboardCheck,
  FileText,
  History,
  Wrench,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InspectionPhotoGallery } from '@/components/inspections/InspectionPhotoGallery';
import { WorkshopTaskTimeline } from '@/components/workshop-tasks/WorkshopTaskTimeline';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import {
  filterAssetHistoryRows,
  type AssetHistoryAssetType,
  type AssetHistoryFilters,
  type AssetHistoryRow,
  type AssetHistoryRowType,
  type AssetHistoryWorkshopTaskSource,
} from '@/lib/fleet/asset-history-events';
import type { InspectionPhoto } from '@/types/inspection';
import type { WorkshopTaskComment } from '@/lib/hooks/useWorkshopTaskComments';

interface AssetHistoryTableProps {
  assetType: AssetHistoryAssetType;
  rows: AssetHistoryRow[];
  loading: boolean;
  taskComments: Record<string, WorkshopTaskComment[]>;
  taskInspectionPhotos: Record<string, InspectionPhoto[]>;
}

interface FilterConfig {
  key: AssetHistoryRowType;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const DAILY_TASK_ROW_CLASS_NAMES: Record<AssetHistoryAssetType, string> = {
  van: 'bg-[hsl(var(--inspection-primary)/0.10)] hover:bg-[hsl(var(--inspection-primary)/0.18)]',
  plant: 'bg-[hsl(var(--plant-inspection-primary)/0.10)] hover:bg-[hsl(var(--plant-inspection-primary)/0.18)]',
  hgv: 'bg-[hsl(var(--hgv-inspection-primary)/0.10)] hover:bg-[hsl(var(--hgv-inspection-primary)/0.18)]',
};

const DAILY_TASK_ICON_CLASS_NAMES: Record<AssetHistoryAssetType, string> = {
  van: 'text-inspection',
  plant: 'text-plant-inspection',
  hgv: 'text-hgv-inspection',
};

const DAILY_TASK_ACCENT_CLASS_NAMES: Record<AssetHistoryAssetType, string> = {
  van: 'before:bg-[hsl(var(--inspection-primary))]',
  plant: 'before:bg-[hsl(var(--plant-inspection-primary))]',
  hgv: 'before:bg-[hsl(var(--hgv-inspection-primary))]',
};

const METER_COLUMN_LABELS: Record<AssetHistoryAssetType, string> = {
  van: 'Mileage',
  plant: 'Hours',
  hgv: 'KM',
};

const FILTERS: FilterConfig[] = [
  {
    key: 'workshop',
    label: 'Workshop',
    icon: Wrench,
  },
  {
    key: 'record',
    label: 'Records',
    icon: FileText,
  },
  {
    key: 'dailyTask',
    label: 'Daily Checks',
    icon: ClipboardCheck,
  },
];

const INITIAL_FILTERS: AssetHistoryFilters = {
  workshop: true,
  record: true,
  dailyTask: true,
};

function isHighPriorityWorkshopRow(row: AssetHistoryRow, assetType: AssetHistoryAssetType) {
  return row.type === 'workshop' && (
    row.source.priority === 'high'
    || row.source.priority === 'urgent'
    || (assetType === 'hgv' && row.source.action_type === 'inspection_defect')
  );
}

function getWorkshopStatusBadge(row: Extract<AssetHistoryRow, { type: 'workshop' }>, assetType: AssetHistoryAssetType) {
  const isHighPriority = isHighPriorityWorkshopRow(row, assetType);
  const statusConfig: Record<string, { label: string; className: string }> = {
    pending: {
      label: isHighPriority ? 'Pending [HP]' : 'Pending',
      className: isHighPriority
        ? 'bg-red-500/10 text-red-300 border-red-500/30'
        : 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    },
    in_progress: {
      label: 'In Progress',
      className: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    },
    logged: {
      label: 'In Progress',
      className: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    },
    on_hold: {
      label: 'On Hold',
      className: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
    },
    completed: {
      label: 'Completed',
      className: 'bg-green-500/10 text-green-300 border-green-500/30',
    },
  };
  const config = statusConfig[row.source.status] || statusConfig.pending;

  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

function getStatusBadge(row: AssetHistoryRow, assetType: AssetHistoryAssetType) {
  if (!row.statusLabel) return <span className="text-muted-foreground">-</span>;
  if (row.type === 'workshop') return getWorkshopStatusBadge(row, assetType);

  const normalisedStatus = row.statusLabel.replace(/_/g, ' ');
  const label = normalisedStatus.charAt(0).toUpperCase() + normalisedStatus.slice(1);
  const className =
    row.statusLabel.includes('Defect')
      ? 'bg-red-500/10 text-red-300 border-red-500/30'
      : row.statusLabel === 'All Passed'
        ? 'bg-green-500/10 text-green-300 border-green-500/30'
        : row.statusLabel === 'completed' || row.statusLabel === 'submitted'
          ? 'bg-green-500/10 text-green-300 border-green-500/30'
          : row.statusLabel === 'logged' || row.statusLabel === 'in_progress'
            ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
            : row.statusLabel === 'on_hold'
              ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
              : 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30';

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function getWorkshopCategory(task: AssetHistoryWorkshopTaskSource) {
  return task.workshop_task_subcategories?.workshop_task_categories?.name
    || task.workshop_task_categories?.name
    || null;
}

function getRowClassName(row: AssetHistoryRow, assetType: AssetHistoryAssetType) {
  const baseClassName = 'cursor-pointer border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (row.type === 'workshop') {
    return cn(baseClassName, 'bg-[hsl(var(--workshop-primary)/0.10)] hover:bg-[hsl(var(--workshop-primary)/0.18)]');
  }

  if (row.type === 'dailyTask') {
    return cn(baseClassName, DAILY_TASK_ROW_CLASS_NAMES[assetType]);
  }

  return cn(baseClassName, 'bg-blue-500/5 hover:bg-blue-500/10');
}

function getAccentCellClassName(row: AssetHistoryRow, assetType: AssetHistoryAssetType) {
  const baseClassName = 'relative pl-4 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1';

  if (row.type === 'workshop') return cn(baseClassName, 'before:bg-[hsl(var(--workshop-primary))]');
  if (row.type === 'dailyTask') return cn(baseClassName, DAILY_TASK_ACCENT_CLASS_NAMES[assetType]);

  return cn(baseClassName, 'before:bg-blue-500');
}

function getRowIcon(row: AssetHistoryRow) {
  if (row.type === 'workshop') return Wrench;
  if (row.type === 'dailyTask') return ClipboardCheck;
  return FileText;
}

function getRowIconClassName(row: AssetHistoryRow, assetType: AssetHistoryAssetType) {
  if (row.type === 'workshop') return 'text-orange-200';
  if (row.type === 'dailyTask') return DAILY_TASK_ICON_CLASS_NAMES[assetType];
  return 'text-blue-300';
}

function renderSummary(row: AssetHistoryRow) {
  if (row.type === 'record') {
    return (
      <div className="space-y-1">
        <div className="font-medium text-white">{row.fieldLabel}</div>
        {row.comment && (
          <p className="line-clamp-2 text-xs text-muted-foreground">&quot;{row.comment}&quot;</p>
        )}
      </div>
    );
  }

  if (row.type === 'dailyTask') {
    return (
      <div className="space-y-1">
        <div className="font-medium text-white">{row.summary}</div>
        <div className="text-xs text-muted-foreground">
          Inspection date: {formatDailyTaskRange(row.inspectionRange)}
        </div>
      </div>
    );
  }

  const category = getWorkshopCategory(row.source);

  return (
    <div className="space-y-1">
      <div className="font-medium text-white">{row.summary}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {category && <span>{category}</span>}
        {row.source.workshop_task_subcategories?.name && <span>{row.source.workshop_task_subcategories.name}</span>}
      </div>
      {row.source.workshop_comments && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{row.source.workshop_comments}</p>
      )}
    </div>
  );
}

function renderRecordDetails(row: Extract<AssetHistoryRow, { type: 'record' }>) {
  const hasChange = row.source.field_name !== 'no_changes' && (row.oldValue || row.newValue);

  return (
    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      {hasChange && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Change</p>
          <div className="text-sm text-muted-foreground">
            <span className="line-through">{row.oldValue || 'Not set'}</span>
            {' -> '}
            <span className="font-medium text-slate-200">{row.newValue || 'Not set'}</span>
          </div>
        </div>
      )}
      {row.comment && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Comment</p>
          <p className="text-sm text-slate-200">&quot;{row.comment}&quot;</p>
        </div>
      )}
      {!hasChange && !row.comment && (
        <p className="text-sm text-muted-foreground">No additional details recorded.</p>
      )}
    </div>
  );
}

function formatDailyTaskRange(range: string) {
  const [startDate, endDate] = range.split(' - ');
  if (!endDate) return formatDate(startDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function renderWorkshopDetails(
  task: AssetHistoryWorkshopTaskSource,
  comments: WorkshopTaskComment[],
  inspectionPhotos: InspectionPhoto[]
) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      {(task.description || task.workshop_comments) && (
        <div className="rounded-md border border-slate-700 bg-slate-950/50 p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Task Details</p>
          <p className="text-sm text-slate-200">{task.workshop_comments || task.description}</p>
        </div>
      )}

      {task.action_type === 'inspection_defect' && inspectionPhotos.length > 0 && (
        <InspectionPhotoGallery
          photos={inspectionPhotos}
          title="Defect Photos"
          description="Uploaded photos linked to this inspection defect."
        />
      )}

      <WorkshopTaskTimeline task={task} comments={comments} />
    </div>
  );
}

export function AssetHistoryTable({
  assetType,
  rows,
  loading,
  taskComments,
  taskInspectionPhotos,
}: AssetHistoryTableProps) {
  const router = useRouter();
  const [filters, setFilters] = useState<AssetHistoryFilters>(INITIAL_FILTERS);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const visibleRows = useMemo(() => filterAssetHistoryRows(rows, filters), [rows, filters]);
  const counts = useMemo(
    () => ({
      workshop: rows.filter((row) => row.type === 'workshop').length,
      record: rows.filter((row) => row.type === 'record').length,
      dailyTask: rows.filter((row) => row.type === 'dailyTask').length,
    }),
    [rows]
  );

  const toggleFilter = (filter: AssetHistoryRowType) => {
    setFilters((current) => ({
      ...current,
      [filter]: !current[filter],
    }));
  };

  const toggleRowExpansion = (rowId: string) => {
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const handleRowAction = (row: AssetHistoryRow) => {
    if (row.type === 'dailyTask') {
      router.push(row.href);
      return;
    }

    toggleRowExpansion(row.id);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: AssetHistoryRow) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    handleRowAction(row);
  };

  return (
    <Card className="bg-slate-800/50 border-border">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Asset History</CardTitle>
            <CardDescription>
              Combined timeline of record updates, workshop tasks, and daily task submissions
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              Filters
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filter) => {
                const Icon = filter.icon;
                const isActive = filters[filter.key];

                return (
                  <Button
                    key={filter.key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleFilter(filter.key)}
                    className={cn(
                      'h-9 gap-2 border px-3 transition-all',
                      isActive
                        ? 'border-green-500/60 bg-green-500/20 text-green-100 shadow-sm shadow-green-950/20 hover:bg-green-500/30'
                        : 'border-slate-600 bg-slate-800/60 text-slate-400 hover:border-slate-500 hover:bg-slate-700/70 hover:text-slate-200'
                    )}
                    aria-pressed={isActive}
                  >
                    {isActive ? (
                      <Check className="h-4 w-4 shrink-0 text-green-200" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    )}
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-green-100' : 'text-slate-400')} />
                    <span>{filter.label}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                        isActive ? 'bg-green-950/50 text-green-100' : 'bg-slate-950/40 text-slate-400'
                      )}
                    >
                      {counts[filter.key]}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
            <Wrench className="h-14 w-14 opacity-50" />
            <p>
              {rows.length > 0
                ? 'Enable filters to view history'
                : 'No asset history has been recorded yet'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-700">
            <div className="overflow-x-auto">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                      Date
                    </TableHead>
                    <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                      Summary
                    </TableHead>
                    <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                      Status
                    </TableHead>
                    <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                      Person
                    </TableHead>
                    <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                      {METER_COLUMN_LABELS[assetType]}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => {
                    const isExpanded = row.type !== 'dailyTask' && expandedRowIds.has(row.id);
                    const RowIcon = getRowIcon(row);

                    return (
                      <Fragment key={row.id}>
                        <TableRow
                          className={getRowClassName(row, assetType)}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleRowAction(row)}
                          onKeyDown={(event) => handleRowKeyDown(event, row)}
                          aria-expanded={row.type === 'dailyTask' ? undefined : isExpanded}
                        >
                          <TableCell className={cn('whitespace-nowrap text-muted-foreground', getAccentCellClassName(row, assetType))}>
                            <div className="flex items-center gap-2">
                              <RowIcon className={cn('h-4 w-4', getRowIconClassName(row, assetType))} />
                              <span className="sr-only">{row.typeLabel}</span>
                              {formatDateTime(row.timestamp)}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[280px]">{renderSummary(row)}</TableCell>
                          <TableCell>{getStatusBadge(row, assetType)}</TableCell>
                          <TableCell className="text-muted-foreground">{row.person}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {row.meter || '-'}
                          </TableCell>
                        </TableRow>
                        {row.type === 'workshop' && isExpanded && (
                          <TableRow className="border-slate-700 bg-slate-950/30 hover:bg-slate-950/30">
                            <TableCell colSpan={5} className="p-4">
                              {renderWorkshopDetails(
                                row.source,
                                taskComments[row.source.id] || [],
                                taskInspectionPhotos[row.source.id] || []
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                        {row.type === 'record' && isExpanded && (
                          <TableRow className="border-slate-700 bg-slate-950/30 hover:bg-slate-950/30">
                            <TableCell colSpan={5} className="p-4">
                              {renderRecordDetails(row)}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
