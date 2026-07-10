import { useMemo, useState, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  AlertTriangle,
  ArrowUpDown,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit,
  HardHat,
  MessageSquare,
  Paperclip,
  Pause,
  Plus,
  Loader2,
  Search,
  Trash2,
  Truck,
  Undo2,
  Wrench,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import type { Action, AssetTab, Vehicle, WorkshopTaskStatusFilter, WorkshopTaskTileFilter } from '../types';
import type { InspectionPhoto } from '@/types/inspection';

interface WorkshopTasksOverviewTabProps {
  assetTab: AssetTab;
  onAssetTabChange: (tab: string) => void;
  statusFilter: WorkshopTaskTileFilter;
  onStatusFilterChange: (status: WorkshopTaskTileFilter) => void;
  vehicleFilter: string;
  onVehicleFilterChange: (vehicleId: string) => void;
  vehicles: Vehicle[];
  loading: boolean;
  tabFilteredTasks: Action[];
  taskCount: number;
  pendingTaskCount: number;
  pendingTasks: Action[];
  highPriorityPendingCount: number;
  inProgressTaskCount: number;
  inProgressTasks: Action[];
  onHoldTaskCount: number;
  onHoldTasks: Action[];
  completedTaskCount: number;
  completedTasks: Action[];
  showPending: boolean;
  onShowPendingChange: (show: boolean) => void;
  showInProgress: boolean;
  onShowInProgressChange: (show: boolean) => void;
  showOnHold: boolean;
  onShowOnHoldChange: (show: boolean) => void;
  showCompleted: boolean;
  onShowCompletedChange: (show: boolean) => void;
  updatingStatus: Set<string>;
  taskAttachmentCounts: Map<string, number>;
  taskInspectionPhotos: Record<string, InspectionPhoto[]>;
  getStatusIcon: (status: string, task?: Action) => ReactNode;
  getVehicleReg: (task: Action) => string;
  getSourceLabel: (task: Action) => string;
  getAssetDisplay: (vehicle: Vehicle) => string;
  onCreateTask: () => void;
  onOpenTaskModal: (task: Action) => void;
  onOpenComments: (task: Action) => void;
  onMarkInProgress: (task: Action) => void;
  onMarkComplete: (task: Action) => void;
  onMarkOnHold: (task: Action) => void;
  onResumeTask: (task: Action) => void;
  onUndoLogged: (taskId: string) => void;
  onUndoComplete: (taskId: string) => void;
  onEditTask: (task: Action) => void;
  onDeleteTask: (task: Action) => void;
}

type CompletedSortField =
  | 'completedAt'
  | 'asset'
  | 'source'
  | 'category'
  | 'summary';

type CompletedSortDirection = 'asc' | 'desc';

type CompletedTaskRow = {
  id: string;
  task: Action;
  asset: string;
  source: string;
  category: string;
  subcategory: string;
  summary: string;
  createdAt: string | null;
  completedAt: string | null;
  searchText: string;
};

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

function SortableHeader({
  label,
  field,
  currentField,
  direction,
  onSort,
  className,
}: {
  label: string;
  field: CompletedSortField;
  currentField: CompletedSortField;
  direction: CompletedSortDirection;
  onSort: (field: CompletedSortField) => void;
  className?: string;
}) {
  const isActive = currentField === field;
  const isDesc = isActive && direction === 'desc';

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-left transition-colors hover:text-foreground ${className ?? ''}`}
    >
      <span>{label}</span>
      <ArrowUpDown
        className={`h-3 w-3 transition-transform ${
          isActive ? 'text-green-400' : 'text-muted-foreground/50'
        } ${isDesc ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

export function WorkshopTasksOverviewTab({
  assetTab,
  onAssetTabChange,
  statusFilter,
  onStatusFilterChange,
  vehicleFilter,
  onVehicleFilterChange,
  vehicles,
  loading,
  tabFilteredTasks,
  taskCount,
  pendingTaskCount,
  pendingTasks,
  highPriorityPendingCount,
  inProgressTaskCount,
  inProgressTasks,
  onHoldTaskCount,
  onHoldTasks,
  completedTaskCount,
  completedTasks,
  showPending,
  onShowPendingChange,
  showInProgress,
  onShowInProgressChange,
  showOnHold,
  onShowOnHoldChange,
  showCompleted,
  onShowCompletedChange,
  updatingStatus,
  taskAttachmentCounts,
  taskInspectionPhotos,
  getStatusIcon,
  getVehicleReg,
  getSourceLabel,
  getAssetDisplay,
  onCreateTask,
  onOpenTaskModal,
  onOpenComments,
  onMarkInProgress,
  onMarkComplete,
  onMarkOnHold,
  onResumeTask,
  onUndoLogged,
  onUndoComplete,
  onEditTask,
  onDeleteTask,
}: WorkshopTasksOverviewTabProps) {
  const showInitialLoading = loading && tabFilteredTasks.length === 0;
  const { tabletModeEnabled } = useTabletMode();
  const hasHighPriorityPending = highPriorityPendingCount > 0;
  const pendingHeaderIconClass = hasHighPriorityPending ? 'text-red-500' : 'text-amber-400';
  const taskActionButtonClass = tabletModeEnabled ? 'min-h-11 px-4 text-base' : 'h-9 px-3 text-xs';
  const taskActionGroupClass = tabletModeEnabled
    ? 'flex flex-wrap items-center gap-1.5 w-full lg:w-auto'
    : 'flex flex-wrap items-center gap-1.5 w-full md:w-auto';
  const getTaskPhotos = (taskId: string) => taskInspectionPhotos[taskId] ?? [];
  const statusSelectValue: WorkshopTaskStatusFilter = statusFilter === 'high_priority' ? 'pending' : statusFilter;
  const visibleTaskCount = pendingTasks.length + inProgressTasks.length + onHoldTasks.length + completedTasks.length;
  const [completedLoadState, setCompletedLoadState] = useState({ key: '', count: 20 });
  const [completedSearch, setCompletedSearch] = useState('');
  const [completedDateFrom, setCompletedDateFrom] = useState('');
  const [completedDateTo, setCompletedDateTo] = useState('');
  const [completedAssetFilter, setCompletedAssetFilter] = useState('');
  const [completedSourceFilter, setCompletedSourceFilter] = useState('all');
  const [completedCategoryFilter, setCompletedCategoryFilter] = useState('all');
  const [completedSummaryFilter, setCompletedSummaryFilter] = useState('');
  const [completedSortField, setCompletedSortField] = useState<CompletedSortField>('completedAt');
  const [completedSortDirection, setCompletedSortDirection] = useState<CompletedSortDirection>('desc');

  const completedFilterKey = `${completedAssetFilter}|${completedCategoryFilter}|${completedDateFrom}|${completedDateTo}|${completedSearch}|${completedSortDirection}|${completedSortField}|${completedSourceFilter}|${completedSummaryFilter}`;
  const completedVisibleCount = completedLoadState.key === completedFilterKey ? completedLoadState.count : 20;

  const renderInspectionPhotoBadge = (task: Action) => {
    const count = getTaskPhotos(task.id).length;
    if (task.action_type !== 'inspection_defect' || count === 0) {
      return null;
    }

    return (
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-xs">
        <Camera className="h-3 w-3 mr-1" />
        {count}
      </Badge>
    );
  };

  const getSourceBadgeClass = (task: Action) => {
    if (task.action_type !== 'inspection_defect') {
      return 'bg-transparent text-workshop border-workshop';
    }

    if (task.hgv_id) {
      return 'bg-transparent text-hgv-inspection border-hgv-inspection';
    }

    if (task.plant_id) {
      return 'bg-transparent text-plant-inspection border-plant-inspection';
    }

    return 'bg-transparent text-inspection border-inspection';
  };

  const renderSourceBadge = (task: Action, label = getSourceLabel(task)) => (
    <Badge variant="outline" className={`text-xs font-semibold shadow-sm ${getSourceBadgeClass(task)}`}>
      {label}
    </Badge>
  );

  const renderInspectionDescription = (task: Action) => (
    task.action_type === 'inspection_defect' && task.description ? (
      <p className="mb-2 whitespace-pre-line text-sm text-muted-foreground">{task.description}</p>
    ) : null
  );

  const completedRows = useMemo<CompletedTaskRow[]>(
    () =>
      completedTasks.map((task) => {
        const category =
          task.workshop_task_subcategories?.workshop_task_categories?.name ||
          task.workshop_task_categories?.name ||
          '';
        const subcategory = task.workshop_task_subcategories?.name || '';
        const summary = (task.description || task.workshop_comments || task.title || '').trim();
        const asset = getVehicleReg(task);
        const source = getSourceLabel(task);

        return {
          id: task.id,
          task,
          asset,
          source,
          category,
          subcategory,
          summary,
          createdAt: task.created_at,
          completedAt: task.actioned_at,
          searchText: [asset, source, category, subcategory, task.title, task.description, task.workshop_comments]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        };
      }),
    [completedTasks, getSourceLabel, getVehicleReg]
  );

  const completedSourceOptions = useMemo(
    () => Array.from(new Set(completedRows.map((row) => row.source).filter(Boolean))).sort(),
    [completedRows]
  );
  const completedCategoryOptions = useMemo(
    () => Array.from(new Set(completedRows.map((row) => row.category).filter(Boolean))).sort(),
    [completedRows]
  );
  const filteredCompletedRows = useMemo(() => {
    const searchValue = normalizeFilterValue(completedSearch);
    const assetFilterValue = normalizeFilterValue(completedAssetFilter);
    const summaryFilterValue = normalizeFilterValue(completedSummaryFilter);
    const fromDate = completedDateFrom ? new Date(`${completedDateFrom}T00:00:00`).getTime() : null;
    const toDate = completedDateTo ? new Date(`${completedDateTo}T23:59:59.999`).getTime() : null;

    return completedRows.filter((row) => {
      if (searchValue && !row.searchText.includes(searchValue)) {
        return false;
      }

      if (assetFilterValue && !row.asset.toLowerCase().includes(assetFilterValue)) {
        return false;
      }

      if (completedSourceFilter !== 'all' && row.source !== completedSourceFilter) {
        return false;
      }

      if (completedCategoryFilter !== 'all' && row.category !== completedCategoryFilter) {
        return false;
      }

      if (summaryFilterValue && !row.summary.toLowerCase().includes(summaryFilterValue)) {
        return false;
      }

      const completedTime = row.completedAt ? new Date(row.completedAt).getTime() : null;
      if (fromDate !== null && (completedTime === null || completedTime < fromDate)) {
        return false;
      }
      if (toDate !== null && (completedTime === null || completedTime > toDate)) {
        return false;
      }

      return true;
    });
  }, [
    completedAssetFilter,
    completedCategoryFilter,
    completedDateFrom,
    completedDateTo,
    completedRows,
    completedSearch,
    completedSourceFilter,
    completedSummaryFilter,
  ]);

  const sortedCompletedRows = useMemo(() => {
    const rows = [...filteredCompletedRows];

    rows.sort((a, b) => {
      const compareMultiplier = completedSortDirection === 'asc' ? 1 : -1;

      if (completedSortField === 'completedAt') {
        const aTime = a[completedSortField] ? new Date(a[completedSortField] as string).getTime() : 0;
        const bTime = b[completedSortField] ? new Date(b[completedSortField] as string).getTime() : 0;
        return (aTime - bTime) * compareMultiplier;
      }

      const aValue = (a[completedSortField] || '').toString().toLowerCase();
      const bValue = (b[completedSortField] || '').toString().toLowerCase();
      return aValue.localeCompare(bValue) * compareMultiplier;
    });

    return rows;
  }, [completedSortDirection, completedSortField, filteredCompletedRows]);

  const visibleCompletedRows = useMemo(
    () => sortedCompletedRows.slice(0, completedVisibleCount),
    [completedVisibleCount, sortedCompletedRows]
  );
  const mobileVisibleCompletedRows = useMemo(
    () => completedTasks.slice(0, completedVisibleCount),
    [completedTasks, completedVisibleCount]
  );

  const hasMoreCompletedRows = sortedCompletedRows.length > visibleCompletedRows.length;
  const hasMoreCompletedRowsMobile = completedTasks.length > mobileVisibleCompletedRows.length;


  const handleCompletedSort = (field: CompletedSortField) => {
    if (completedSortField === field) {
      setCompletedSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setCompletedSortField(field);
    setCompletedSortDirection(field === 'completedAt' ? 'desc' : 'asc');
  };

  const resetCompletedFilters = () => {
    setCompletedSearch('');
    setCompletedDateFrom('');
    setCompletedDateTo('');
    setCompletedAssetFilter('');
    setCompletedSourceFilter('all');
    setCompletedCategoryFilter('all');
    setCompletedSummaryFilter('');
    setCompletedSortField('completedAt');
    setCompletedSortDirection('desc');
  };

  const renderStatusTile = ({
    filter,
    label,
    count,
    countClassName,
    activeClassName,
    ariaLabel,
  }: {
    filter: WorkshopTaskTileFilter;
    label: string;
    count: number;
    countClassName: string;
    activeClassName: string;
    ariaLabel: string;
  }) => {
    const isActive = statusFilter === filter;

    return (
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isActive}
        onClick={() => onStatusFilterChange(filter)}
        className={cn(
          'rounded-lg border bg-slate-900 text-card-foreground shadow-sm text-left transition-all duration-200',
          'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isActive ? activeClassName : 'border-border hover:border-workshop/50 hover:bg-slate-800/80'
        )}
      >
        <CardHeader className="pb-3">
          <CardDescription className="text-muted-foreground">{label}</CardDescription>
          <CardTitle className={`text-3xl ${countClassName}`}>{count}</CardTitle>
        </CardHeader>
      </button>
    );
  };

  return (
    <TabsContent value="overview" className="space-y-6 mt-0">
      <div className={`flex ${tabletModeEnabled ? 'justify-start' : 'justify-end'}`}>
        <Tabs value={assetTab} onValueChange={onAssetTabChange}>
          <TabsList className={tabletModeEnabled ? 'h-auto flex-wrap gap-2 p-1.5 justify-start' : undefined}>
            <TabsTrigger value="all" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
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

      <Card>
        <CardContent className="pt-6">
          <div className={`grid grid-cols-1 md:grid-cols-2 ${tabletModeEnabled ? 'gap-5' : 'gap-4'}`}>
            <div className="space-y-2">
              <Label>Status Filter</Label>
              <Select value={statusSelectValue} onValueChange={(value) => onStatusFilterChange(value as WorkshopTaskStatusFilter)}>
                <SelectTrigger className={`bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="logged">In Progress</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{assetTab === 'plant' ? 'Plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'van' ? 'Van' : 'Asset'} Filter</Label>
              <Select value={vehicleFilter} onValueChange={onVehicleFilterChange}>
                <SelectTrigger className={`bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {assetTab === 'plant' ? 'All Plant' : assetTab === 'hgv' ? 'All HGVs' : assetTab === 'van' ? 'All Vans' : 'All Assets'}
                  </SelectItem>
                  {vehicles
                    .filter(v => assetTab === 'all' ? true : assetTab === 'plant' ? v.asset_type === 'plant' : assetTab === 'hgv' ? v.asset_type === 'hgv' : v.asset_type === 'van')
                    .map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {getAssetDisplay(vehicle)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        className={`grid gap-4 ${
          tabletModeEnabled
            ? hasHighPriorityPending
              ? 'grid-cols-2 xl:grid-cols-6'
              : 'grid-cols-2 xl:grid-cols-5'
            : hasHighPriorityPending
              ? 'grid-cols-6'
              : 'grid-cols-5'
        }`}
      >
        {renderStatusTile({
          filter: 'all',
          label: 'All Tasks',
          count: taskCount,
          countClassName: 'text-workshop',
          activeClassName: 'border-workshop bg-[hsl(var(--workshop-primary)/0.28)] hover:bg-[hsl(var(--workshop-primary)/0.34)] ring-1 ring-[hsl(var(--workshop-primary)/0.45)]',
          ariaLabel: 'Show all workshop tasks',
        })}
        {hasHighPriorityPending && (
          renderStatusTile({
            filter: 'high_priority',
            label: 'High Priority',
            count: highPriorityPendingCount,
            countClassName: 'text-red-500',
            activeClassName: 'border-red-500/70 bg-red-500/15 ring-1 ring-red-500/40',
            ariaLabel: 'Show high priority workshop tasks',
          })
        )}
        {renderStatusTile({
          filter: 'pending',
          label: 'Pending',
          count: pendingTaskCount,
          countClassName: 'text-amber-600 dark:text-amber-400',
          activeClassName: 'border-amber-500/70 bg-amber-500/15 ring-1 ring-amber-500/40',
          ariaLabel: 'Show pending workshop tasks',
        })}
        {renderStatusTile({
          filter: 'logged',
          label: 'In Progress',
          count: inProgressTaskCount,
          countClassName: 'text-blue-600 dark:text-blue-400',
          activeClassName: 'border-blue-500/70 bg-blue-500/15 ring-1 ring-blue-500/40',
          ariaLabel: 'Show in progress workshop tasks',
        })}
        {renderStatusTile({
          filter: 'on_hold',
          label: 'On Hold',
          count: onHoldTaskCount,
          countClassName: 'text-purple-600 dark:text-purple-400',
          activeClassName: 'border-purple-500/70 bg-purple-500/15 ring-1 ring-purple-500/40',
          ariaLabel: 'Show on hold workshop tasks',
        })}
        {renderStatusTile({
          filter: 'completed',
          label: 'Completed',
          count: completedTaskCount,
          countClassName: 'text-green-600 dark:text-green-400',
          activeClassName: 'border-green-500/70 bg-green-500/15 ring-1 ring-green-500/40',
          ariaLabel: 'Show completed workshop tasks',
        })}
      </div>

      {showInitialLoading ? (
        <PanelLoader message="Loading tasks..." accent="workshop" className="min-h-[400px]" />
      ) : tabFilteredTasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No {assetTab === 'plant' ? 'plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'van' ? 'van' : ''} workshop tasks yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first workshop task or wait for inspection defects
            </p>
            <Button
              onClick={onCreateTask}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </CardContent>
        </Card>
      ) : visibleTaskCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No tasks match this status filter</h3>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing tasks...
            </div>
          )}
          {pendingTasks.length > 0 && (
            <div className="border-2 border-amber-500/30 rounded-lg overflow-hidden bg-amber-500/5">
              <button
                onClick={() => onShowPendingChange(!showPending)}
                className="w-full flex items-center justify-between p-4 bg-amber-500/10 hover:bg-amber-500/20 transition-colors border-b-2 border-amber-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className={`h-5 w-5 ${pendingHeaderIconClass}`} />
                  Pending Tasks ({pendingTasks.length})
                </h2>
                {showPending ? (
                  <ChevronUp className={`h-5 w-5 ${pendingHeaderIconClass}`} />
                ) : (
                  <ChevronDown className={`h-5 w-5 ${pendingHeaderIconClass}`} />
                )}
              </button>
              {showPending && (
                <div className="space-y-3 p-4">
                {pendingTasks.map((task) => {
                  const isUpdating = updatingStatus.has(task.id);
                  return (
                    <Card
                      key={task.id}
                      className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-workshop/50 transition-all duration-200 cursor-pointer"
                      onClick={() => onOpenTaskModal(task)}
                    >
                      <CardContent className="pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex-1 w-full">
                              <div className="flex items-center gap-2 mb-2">
                                {getStatusIcon(task.status ?? 'pending', task)}
                                <h3 className="font-semibold text-lg text-foreground">
                                  {getVehicleReg(task)}
                                </h3>
                                {renderSourceBadge(task)}
                                {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(task)}
                              </div>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {task.workshop_task_subcategories?.workshop_task_categories && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                    {task.workshop_task_subcategories.workshop_task_categories.name}
                                  </Badge>
                                )}
                                {task.workshop_task_subcategories && (
                                  <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                    {task.workshop_task_subcategories.name}
                                  </Badge>
                                )}
                              </div>
                              {renderInspectionDescription(task)}
                              {task.workshop_comments && (
                                <p className="text-sm text-muted-foreground mb-2">
                                  <strong>Notes:</strong> {task.workshop_comments}
                                </p>
                              )}
                            </div>
                            <div className={taskActionGroupClass}>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenComments(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                variant="outline"
                                className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}
                              >
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                Comments
                              </Button>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMarkInProgress(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                className={`${taskActionButtonClass} bg-blue-600/80 hover:bg-blue-600 text-white border-0`}
                              >
                                <Clock className="h-3.5 w-3.5 mr-1.5" />
                                In Progress
                              </Button>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMarkOnHold(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                className={`${taskActionButtonClass} bg-purple-600/80 hover:bg-purple-600 text-white border-0`}
                              >
                                <Pause className="h-3.5 w-3.5 mr-1.5" />
                                On Hold
                              </Button>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMarkComplete(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                className={`${taskActionButtonClass} transition-all border-0 bg-green-600 hover:bg-green-700 text-white`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Complete
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between w-full">
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <span>Created: {formatDate(task.created_at)}</span>
                            </div>
                            {task.action_type === 'workshop_vehicle_task' && (
                              <div className="flex items-center gap-1">
                                <Button
                                  onClick={(e) => { e.stopPropagation(); onEditTask(task); }}
                                  disabled={isUpdating}
                                  size="sm"
                                  variant="ghost"
                                  className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800`}
                                  title="Edit task"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }}
                                  disabled={isUpdating}
                                  size="sm"
                                  variant="ghost"
                                  className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50`}
                                  title="Delete task"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                </div>
              )}
            </div>
          )}

          {inProgressTasks.length > 0 && (
            <div className="border-2 border-blue-500/30 rounded-lg overflow-hidden bg-blue-500/5">
              <button
                onClick={() => onShowInProgressChange(!showInProgress)}
                className="w-full flex items-center justify-between p-4 bg-blue-500/10 hover:bg-blue-500/20 transition-colors border-b-2 border-blue-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <Clock className="h-5 w-5 text-blue-400" />
                  In Progress Tasks ({inProgressTasks.length})
                </h2>
                {showInProgress ? (
                  <ChevronUp className="h-5 w-5 text-blue-400" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-blue-400" />
                )}
              </button>
              {showInProgress && (
                <div className="space-y-3 p-4">
                {inProgressTasks.map((task) => {
                  const isUpdating = updatingStatus.has(task.id);
                  return (
                    <Card
                      key={task.id}
                      className="bg-white dark:bg-slate-900 border-blue-500/30 dark:border-blue-500/30 hover:shadow-lg hover:border-blue-500/50 transition-all duration-200 cursor-pointer"
                      onClick={() => onOpenTaskModal(task)}
                    >
                      <CardContent className="pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex-1 w-full">
                              <div className="flex items-center gap-2 mb-2">
                                {getStatusIcon(task.status ?? 'pending')}
                                <h3 className="font-semibold text-lg text-foreground">{getVehicleReg(task)}</h3>
                                {renderSourceBadge(task)}
                                {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(task)}
                              </div>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {task.workshop_task_subcategories?.workshop_task_categories && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                    {task.workshop_task_subcategories.workshop_task_categories.name}
                                  </Badge>
                                )}
                                {task.workshop_task_subcategories && (
                                  <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                    {task.workshop_task_subcategories.name}
                                  </Badge>
                                )}
                              </div>
                              {renderInspectionDescription(task)}
                              {task.logged_comment && (
                                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-2">
                                  <p className="text-sm text-blue-300">
                                    <strong>Progress Note:</strong> {task.logged_comment}
                                  </p>
                                </div>
                              )}
                              {task.workshop_comments && (
                                <p className="text-sm text-muted-foreground mb-2">
                                  <strong>Notes:</strong> {task.workshop_comments}
                                </p>
                              )}
                            </div>
                            <div className={taskActionGroupClass}>
                              <Button onClick={(e) => { e.stopPropagation(); onOpenComments(task); }} disabled={isUpdating} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                Comments
                              </Button>
                              <Button onClick={(e) => { e.stopPropagation(); onUndoLogged(task.id); }} variant="outline" disabled={isUpdating} size="sm" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                                Undo
                              </Button>
                              {task.status === 'logged' && (
                                <Button onClick={(e) => { e.stopPropagation(); onMarkOnHold(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} bg-purple-600/80 hover:bg-purple-600 text-white border-0`}>
                                  <Pause className="h-3.5 w-3.5 mr-1.5" />
                                  On Hold
                                </Button>
                              )}
                              {task.status === 'on_hold' && (
                                <Button onClick={(e) => { e.stopPropagation(); onResumeTask(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} bg-blue-600/80 hover:bg-blue-600 text-white border-0`}>
                                  <Clock className="h-3.5 w-3.5 mr-1.5" />
                                  Resume
                                </Button>
                              )}
                              <Button onClick={(e) => { e.stopPropagation(); onMarkComplete(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} transition-all border-0 bg-green-600 hover:bg-green-700 text-white`}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Complete
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between w-full">
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <span>Created: {formatDate(task.created_at)}</span>
                              {task.logged_at && (
                                <span className="text-blue-400">
                                  Started: {formatDate(task.logged_at)}
                                </span>
                              )}
                            </div>
                            {task.action_type === 'workshop_vehicle_task' && (
                              <div className="flex items-center gap-1">
                                <Button onClick={(e) => { e.stopPropagation(); onEditTask(task); }} disabled={isUpdating} size="sm" variant="ghost" className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800`} title="Edit task">
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                </div>
              )}
            </div>
          )}

          {onHoldTasks.length > 0 && (
            <div className="border-2 border-purple-500/30 rounded-lg overflow-hidden bg-purple-500/5">
              <button
                onClick={() => onShowOnHoldChange(!showOnHold)}
                className="w-full flex items-center justify-between p-4 bg-purple-500/10 hover:bg-purple-500/20 transition-colors border-b-2 border-purple-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <Pause className="h-5 w-5 text-purple-400" />
                  On Hold Tasks ({onHoldTasks.length})
                </h2>
                {showOnHold ? (
                  <ChevronUp className="h-5 w-5 text-purple-400" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-purple-400" />
                )}
              </button>
              {showOnHold && (
                <div className="space-y-3 p-4">
                {onHoldTasks.map((task) => {
                  const isUpdating = updatingStatus.has(task.id);
                  return (
                    <Card key={task.id} className="bg-white dark:bg-slate-900 border-purple-500/30 dark:border-purple-500/30 hover:shadow-lg hover:border-purple-500/50 transition-all duration-200 cursor-pointer" onClick={() => onOpenTaskModal(task)}>
                      <CardContent className="pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex-1 w-full">
                              <div className="flex items-center gap-2 mb-2">
                                {getStatusIcon(task.status ?? 'pending')}
                                <h3 className="font-semibold text-lg text-foreground">{getVehicleReg(task)}</h3>
                                {renderSourceBadge(task)}
                                {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(task)}
                              </div>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {task.workshop_task_subcategories?.workshop_task_categories && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                    {task.workshop_task_subcategories.workshop_task_categories.name}
                                  </Badge>
                                )}
                                {task.workshop_task_subcategories && (
                                  <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                    {task.workshop_task_subcategories.name}
                                  </Badge>
                                )}
                              </div>
                              {renderInspectionDescription(task)}
                              {task.logged_comment && (
                                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-2">
                                  <p className="text-sm text-purple-200 font-medium">Progress Note: {task.logged_comment}</p>
                                </div>
                              )}
                              {task.action_type === 'workshop_vehicle_task' && task.workshop_comments && (
                                <p className="text-sm text-muted-foreground">{task.workshop_comments}</p>
                              )}
                            </div>
                            <div className={taskActionGroupClass}>
                              <Button onClick={(e) => { e.stopPropagation(); onOpenComments(task); }} disabled={isUpdating} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                Comments
                              </Button>
                              <Button onClick={(e) => { e.stopPropagation(); onResumeTask(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} transition-all border-0 bg-workshop hover:bg-workshop-dark text-white`}>
                                <Clock className="h-3.5 w-3.5 mr-1.5" />
                                Resume
                              </Button>
                              <Button onClick={(e) => { e.stopPropagation(); onMarkComplete(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} transition-all border-0 bg-green-600 hover:bg-green-700 text-white`}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Complete
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between w-full">
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <span>Created: {formatDate(task.created_at)}</span>
                              {task.logged_at && (
                                <span>Placed On Hold: {formatDate(task.logged_at)}</span>
                              )}
                            </div>
                            {task.action_type === 'workshop_vehicle_task' && (
                              <div className="flex items-center gap-1">
                                <Button onClick={(e) => { e.stopPropagation(); onEditTask(task); }} disabled={isUpdating} size="sm" variant="ghost" className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800`} title="Edit task">
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }} disabled={isUpdating} size="sm" variant="ghost" className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50`} title="Delete task">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                </div>
              )}
            </div>
          )}

          {completedTasks.length > 0 && (
            <div className="border-2 border-green-500/30 rounded-lg overflow-hidden bg-green-500/5">
              <button
                onClick={() => onShowCompletedChange(!showCompleted)}
                className="w-full flex items-center justify-between p-4 bg-green-500/10 hover:bg-green-500/20 transition-colors border-b-2 border-green-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                  Completed Tasks ({completedTasks.length})
                </h2>
                {showCompleted ? (
                  <ChevronUp className="h-5 w-5 text-green-400" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-green-400" />
                )}
              </button>
              {showCompleted && (
                <div className="space-y-4 p-4">
                  <div className="hidden md:flex items-end justify-between gap-4 rounded-lg border border-border bg-slate-900/40 p-4">
                    <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,1.6fr)_repeat(2,minmax(140px,1fr))]">
                      <div className="space-y-2">
                        <Label htmlFor="completed-search">Search</Label>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="completed-search"
                            value={completedSearch}
                            onChange={(e) => setCompletedSearch(e.target.value)}
                            placeholder="Search asset, summary, category..."
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="completed-date-from">Completed From</Label>
                        <Input
                          id="completed-date-from"
                          type="date"
                          value={completedDateFrom}
                          onChange={(e) => setCompletedDateFrom(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="completed-date-to">Completed To</Label>
                        <Input
                          id="completed-date-to"
                          type="date"
                          value={completedDateTo}
                          onChange={(e) => setCompletedDateTo(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm text-muted-foreground">
                        Showing {visibleCompletedRows.length} of {sortedCompletedRows.length}
                      </p>
                      <Button type="button" variant="outline" onClick={resetCompletedFilters}>
                        Reset
                      </Button>
                    </div>
                  </div>

                  <div className="hidden overflow-x-auto rounded-lg border border-border bg-white dark:bg-slate-900 md:block">
                    <TooltipProvider>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <TableHead className="w-[11rem]">
                            <SortableHeader
                              label="Completed"
                              field="completedAt"
                              currentField={completedSortField}
                              direction={completedSortDirection}
                              onSort={handleCompletedSort}
                            />
                          </TableHead>
                          <TableHead className="w-[14rem]">
                            <SortableHeader
                              label="Asset"
                              field="asset"
                              currentField={completedSortField}
                              direction={completedSortDirection}
                              onSort={handleCompletedSort}
                            />
                          </TableHead>
                          <TableHead className="w-[10rem]">
                            <SortableHeader
                              label="Source"
                              field="source"
                              currentField={completedSortField}
                              direction={completedSortDirection}
                              onSort={handleCompletedSort}
                            />
                          </TableHead>
                          <TableHead className="w-[10rem]">
                            <SortableHeader
                              label="Category"
                              field="category"
                              currentField={completedSortField}
                              direction={completedSortDirection}
                              onSort={handleCompletedSort}
                            />
                          </TableHead>
                          <TableHead>
                            <SortableHeader
                              label="Summary"
                              field="summary"
                              currentField={completedSortField}
                              direction={completedSortDirection}
                              onSort={handleCompletedSort}
                            />
                          </TableHead>
                          <TableHead className="w-[7rem] pr-3 text-right">Actions</TableHead>
                        </TableRow>
                        <TableRow className="bg-slate-50/60 dark:bg-slate-900/60 hover:bg-slate-50/60 dark:hover:bg-slate-900/60">
                          <TableHead className="w-[7rem]" />
                          <TableHead>
                            <Input
                              value={completedAssetFilter}
                              onChange={(e) => setCompletedAssetFilter(e.target.value)}
                              placeholder="Filter asset"
                              className="h-8"
                            />
                          </TableHead>
                          <TableHead>
                            <Select value={completedSourceFilter} onValueChange={setCompletedSourceFilter}>
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="All sources" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                {completedSourceOptions.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableHead>
                          <TableHead>
                            <Select value={completedCategoryFilter} onValueChange={setCompletedCategoryFilter}>
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="All categories" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                {completedCategoryOptions.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableHead>
                          <TableHead>
                            <Input
                              value={completedSummaryFilter}
                              onChange={(e) => setCompletedSummaryFilter(e.target.value)}
                              placeholder="Filter summary"
                              className="h-8"
                            />
                          </TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleCompletedRows.length > 0 ? (
                          visibleCompletedRows.map((row) => (
                            <TableRow
                              key={row.id}
                              className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30"
                              onClick={() => onOpenTaskModal(row.task)}
                            >
                              <TableCell className="text-sm text-green-400">
                                {row.completedAt ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex cursor-help underline decoration-dotted underline-offset-4">
                                        {formatDate(row.completedAt)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Created: {row.createdAt ? formatDate(row.createdAt) : '-'}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  '-'
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">{row.asset}</span>
                                  {taskAttachmentCounts.get(row.task.id) && taskAttachmentCounts.get(row.task.id)! > 0 && (
                                    <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                      <Paperclip className="h-3 w-3 mr-1" />
                                      {taskAttachmentCounts.get(row.task.id)}
                                    </Badge>
                                  )}
                                  {renderInspectionPhotoBadge(row.task)}
                                </div>
                              </TableCell>
                              <TableCell>
                                {renderSourceBadge(row.task, row.source)}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {row.subcategory ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex cursor-help underline decoration-dotted underline-offset-4">
                                        {row.category || '-'}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Subcategory: {row.subcategory}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  row.category || '-'
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-foreground">{row.task.title}</p>
                                  {row.summary && (
                                    <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{row.summary}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="w-[7rem] px-2 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="ml-auto flex w-fit justify-end gap-1">
                                  <Button
                                    onClick={() => onOpenComments(row.task)}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 border-slate-600 p-0 text-muted-foreground hover:bg-slate-800 hover:text-white"
                                    title="Comments"
                                    aria-label="Comments"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    onClick={() => onUndoComplete(row.task.id)}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 border-slate-600 p-0 text-muted-foreground hover:bg-slate-800 hover:text-white"
                                    title="Undo"
                                    aria-label="Undo"
                                  >
                                    <Undo2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                              No completed tasks match the current filters.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    </TooltipProvider>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {mobileVisibleCompletedRows.map((task) => {
                      const row = completedRows.find((candidate) => candidate.id === task.id);
                      const assetLabel = row?.asset || getVehicleReg(task);
                      const sourceLabel = row?.source || getSourceLabel(task);
                      return (
                        <Card
                          key={task.id}
                          className="bg-white dark:bg-slate-900 border-border opacity-70 hover:opacity-90 transition-opacity cursor-pointer"
                          onClick={() => onOpenTaskModal(task)}
                        >
                          <CardContent className="pt-6">
                            <div className="flex flex-col items-start gap-4">
                              <div className="flex-1 space-y-2 w-full">
                                <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                                  <div className="flex-1 w-full">
                                    <div className="flex items-center gap-2 mb-2">
                                      <CheckCircle2 className="h-5 w-5 text-green-400" />
                                      <h3 className="font-semibold text-lg text-foreground">{assetLabel}</h3>
                                      {renderSourceBadge(task, sourceLabel)}
                                      {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                        <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                          <Paperclip className="h-3 w-3 mr-1" />
                                          {taskAttachmentCounts.get(task.id)}
                                        </Badge>
                                      )}
                                      {renderInspectionPhotoBadge(task)}
                                    </div>
                                    <div className="flex flex-wrap gap-2 mb-1">
                                      {task.workshop_task_subcategories?.workshop_task_categories && (
                                        <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                          {task.workshop_task_subcategories.workshop_task_categories.name}
                                        </Badge>
                                      )}
                                      {task.workshop_task_subcategories && (
                                        <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                          {task.workshop_task_subcategories.name}
                                        </Badge>
                                      )}
                                      {!task.workshop_task_subcategories && task.workshop_task_categories && (
                                        <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                          {task.workshop_task_categories.name}
                                        </Badge>
                                      )}
                                    </div>
                                    {renderInspectionDescription(task)}
                                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                      {task.actioned_at && (
                                        <span className="text-green-400">
                                          Completed: {formatDate(task.actioned_at)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className={taskActionGroupClass}>
                                    <Button onClick={(e) => { e.stopPropagation(); onOpenComments(task); }} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                      <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                      Comments
                                    </Button>
                                    <Button onClick={(e) => { e.stopPropagation(); onUndoComplete(task.id); }} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                      <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                                      Undo
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    {mobileVisibleCompletedRows.length === 0 && (
                      <div className="rounded-lg border border-border bg-slate-900/40 p-6 text-center text-sm text-muted-foreground">
                        No completed tasks yet.
                      </div>
                    )}
                  </div>

                  {hasMoreCompletedRows && (
                    <div className="hidden items-center justify-center pt-2 md:flex">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCompletedLoadState(prev => ({ key: completedFilterKey, count: (prev.key === completedFilterKey ? prev.count : 20) + 10 }))}
                      >
                        Show More
                      </Button>
                    </div>
                  )}

                  {hasMoreCompletedRowsMobile && (
                    <div className="flex items-center justify-center pt-2 md:hidden">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCompletedLoadState(prev => ({ key: completedFilterKey, count: (prev.key === completedFilterKey ? prev.count : 20) + 10 }))}
                      >
                        Show More
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </TabsContent>
  );
}
