'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  Accessibility,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from '@dnd-kit/dom';
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addMinutes, format, parseISO } from 'date-fns';
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  useQueryStates,
} from 'nuqs';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarOff,
  CalendarPlus,
  Check,
  Clock3,
  ExternalLink,
  GripVertical,
  ListRestart,
  Minimize2,
  MoveHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Tractor,
  Users,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/page-loader';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  addScheduleDayTeamMember,
  assignScheduleDayTeam,
  createProjectScheduleJob,
  createScheduleAssignment,
  deletePlantUnavailability,
  deleteScheduleAssignment,
  deleteScheduleJob,
  deleteScheduleVisit,
  enqueueScheduleVisit,
  fetchScheduleQuoteCandidates,
  fetchScheduleProjectCandidates,
  fetchScheduleVisitBacklog,
  fetchSchedulingBoard,
  moveScheduleAssignment,
  previewScheduleVisitBacklog,
  quickAddScheduleProject,
  removeScheduleDayTeamMember,
  scheduleQueuedVisit,
  saveQuoteSchedule,
  savePlantUnavailability,
  saveScheduleJob,
  saveScheduleVisit,
  SchedulingApiError,
  type AssignmentMutationResult,
  type AssignmentMutationRow,
  type CreateAssignmentInput,
  type CreateProjectScheduleJobInput,
  type QuickAddScheduleProjectInput,
  type ScheduleQuoteInput,
  type SavePlantUnavailabilityInput,
  type SaveScheduleVisitInput,
} from '@/lib/client/scheduling';
import {
  patchBoardRemoveJob,
  patchBoardMoveAssignment,
  patchBoardRemovePlantBlock,
  patchBoardRemoveAssignment,
  patchBoardRemoveVisit,
  patchBoardWithJob,
  patchBoardWithPlantBlock,
  patchBoardWithAssignment,
  patchBoardWithDayTeamMember,
  patchBoardRemoveDayTeamMember,
  patchBoardWithQuickAdd,
  patchBoardWithVisit,
  removeProjectCandidateFromQueue,
  removeQuoteCandidate,
  removeVisitBacklogItem,
  replaceEmployeeCapacity,
  upsertProjectCandidate,
  upsertQuoteCandidate,
  upsertVisitBacklogItem,
} from './scheduling-board-cache';
import {
  createOptimisticEntityId,
  isOptimisticEntityId,
  projectSchedulingState,
  reconcileOptimisticOperations,
  removeOptimisticOperation,
  type SchedulingOptimisticOperation,
  type SchedulingProjection,
} from './scheduling-optimistic-ledger';
import {
  assignmentCreateClaims,
  assignmentDeleteClaims,
  assignmentDuplicateKey,
  assignmentMoveClaims,
  assignmentMoveCoalesceGroup,
  claimsFromLockKeys,
  dayTeamAssignClaims,
  visitCreateClaims,
  visitReturnPlaceClaims,
  visitTimesClaims,
  visitTimesCoalesceGroup,
} from './scheduling-mutation-claims';
import {
  findCoordinatorPersistTarget,
  SchedulingMutationCoordinator,
  toPersistOutcome,
  type SchedulingCoordinatorOperation,
  type SchedulingPersistOutcome,
} from './scheduling-mutation-coordinator';
import {
  CoalescedBackgroundReconciler,
  planPostMutationReconciliation,
  proofsSatisfiedForKeys,
} from './scheduling-board-reconciliation';
import { ScheduleBoardQuickAddDialog } from './ScheduleBoardQuickAddDialog';
import {
  SCHEDULING_BOARD_PRIMARIES,
  readSchedulingPrimaryPreference,
  type SchedulingBoardPrimary,
  writeSchedulingPrimaryPreference,
} from '@/lib/config/scheduling-primary-preference';
import {
  SCHEDULING_BOARD_VIEWS,
  readSchedulingViewPreference,
  type SchedulingBoardView,
  writeSchedulingViewPreference,
} from '@/lib/config/scheduling-view-preference';
import { cn } from '@/lib/utils/cn';
import { isResourceUnavailableForVisit } from '@/lib/utils/scheduling-availability';
import { slotsForScheduleDate } from '@/lib/utils/scheduling-day-teams';
import {
  buildEmployeeOccupancySegments,
  formatOccupancySummary,
} from '@/lib/utils/scheduling-occupancy';
import { ScheduleDayTeamBuckets, type ScheduleDayTeamDragData } from './ScheduleDayTeamBuckets';
import {
  ResourceOccupancyLegend,
  ResourceOccupancyStrip,
} from './ResourceOccupancyStrip';
import {
  buildScheduleBoardRows,
  filterHiddenBoardAssignments,
  getScheduleBoardAxisLabel,
  getScheduleBoardCellTestId,
  getScheduleBoardDailyRailTestId,
  getScheduleBoardRowTestId,
  getScheduleBoardTitle,
  type ScheduleBoardHiddenAssignment,
  type ScheduleBoardRow,
  type ScheduleBoardVisitPlacement,
} from '@/lib/utils/scheduling-board-primary';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  SensitiveModuleGate,
  SensitiveModuleSessionManager,
  useSensitiveModuleAccess,
} from '@/components/security/SensitiveModuleGate';
import {
  enumerateScheduleDates,
  formatScheduleEmployeeCompactName,
  formatScheduleDate,
  formatScheduleVisitTime,
  getScheduleQuoteEndDate,
  getDailyInitialVisitWindow,
  mapDailyScheduleClientXToMinutes,
  getScheduleQuoteStage,
  getScheduleVisitDate,
  toScheduleLondonDateTimeIso,
  getSchedulingWeek,
  SCHEDULE_QUOTE_STAGES,
  type ScheduleQuoteStage,
} from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleDayCapacity,
  ScheduleDayTeamSlotIndex,
  ScheduleOccupancySegment,
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantResource,
  SchedulePlantUnavailability,
  ScheduleProjectCandidate,
  ScheduleQuoteCandidate,
  ScheduleVisitBacklogItem,
  ScheduleVisitBacklogPreview,
  SchedulingQueueItem,
  ScheduleVisit,
  SchedulingBoardPayload,
  SchedulingConflict,
} from '@/types/scheduling';
import { PlantUnavailabilityDialog } from './PlantUnavailabilityDialog';
import type { SelectedScheduleResource } from './ScheduleAssignmentDialog';
import {
  ScheduleJobDialog,
  type ScheduleJobUpdateInput,
} from './ScheduleJobDialog';
import { ScheduleQuoteDialog } from './ScheduleQuoteDialog';
import { ScheduleVisitDialog } from './ScheduleVisitDialog';
import { ScheduleProjectPlacementDialog } from './ScheduleProjectPlacementDialog';
import { SchedulingDateRangeControls } from './SchedulingDateRangeControls';
import { schedulingControlStyles } from './scheduling-control-styles';
import { QuoteCreationHost } from '@/app/(dashboard)/quotes/components/QuoteCreationHost';
import { ProjectNumberFormDialog } from '@/app/(dashboard)/quotes/components/ProjectNumberFormDialog';
import type { QuoteManagerOption, QuoteProjectNumber } from '@/app/(dashboard)/quotes/types';

interface ResourceCardProps {
  resource: SelectedScheduleResource;
  subtitle: string;
  metadata: string;
  selected: boolean;
  dragEnabled: boolean;
  warning?: string;
  occupancySegments?: ScheduleOccupancySegment[];
  onSelect: () => void;
}

const RESOURCE_GUIDANCE_CLASS =
  'rounded-md border border-dashed border-slate-700 bg-slate-950/40 p-2 text-xs leading-relaxed text-slate-300';

interface WeeklyDayHeaderProps {
  date: string;
  capacity: ScheduleDayCapacity | null;
  compact?: boolean;
  dropScope: 'desktop' | 'mobile';
  selectedQuote: SchedulingQueueItem | null;
  isSchedulingQuote: boolean;
  onOpenDaily: (date: string) => void;
  onScheduleQuote: (quote: SchedulingQueueItem, date: string) => void;
}

function formatCapacityHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

function formatPeople(count: number): string {
  return `${count} ${count === 1 ? 'person' : 'people'}`;
}

function WeeklyDayHeader({
  date,
  capacity,
  compact = false,
  dropScope,
  selectedQuote,
  isSchedulingQuote,
  onOpenDaily,
  onScheduleQuote,
}: WeeklyDayHeaderProps) {
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `${dropScope}:schedule-date:${date}`,
    type: 'schedule-date',
    accept: ['schedule-queue-item'],
    data: { workDate: date },
  });

  return (
    <div
      ref={dropRef}
      data-testid={`schedule-date-drop-${dropScope}-${date}`}
      className={cn(
        'border-l border-border text-center transition',
        compact ? 'p-2' : 'p-3',
        isDropTarget && 'bg-scheduling-soft ring-2 ring-inset ring-scheduling'
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDaily(date)}
        className={cn('w-full rounded-sm', schedulingControlStyles.ghost)}
        aria-label={`Open daily schedule for ${format(parseISO(date), 'EEEE d MMMM')}`}
      >
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {format(parseISO(date), compact ? 'EEE' : 'EEEE')}
        </span>
        <span className="block text-sm font-semibold text-foreground">
          {format(parseISO(date), 'd MMM')}
        </span>
      </button>
      {capacity ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'mt-2 inline-flex items-center justify-center gap-1 rounded-full px-2 py-1 font-medium',
                schedulingControlStyles.outline,
                compact ? 'text-[10px]' : 'text-xs'
              )}
              aria-label={`${formatPeople(capacity.available_employee_count)} with ${formatCapacityHours(capacity.total_available_minutes)} available on ${format(parseISO(date), 'EEEE d MMMM')}`}
            >
              <Users className="h-3 w-3" />
              {capacity.available_employee_count} · {formatCapacityHours(capacity.total_available_minutes)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-72 p-0">
            <div className="border-b border-border p-3">
              <p className="font-semibold text-foreground">
                {format(parseISO(date), 'EEEE d MMMM')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatPeople(capacity.available_employee_count)} ·{' '}
                {formatCapacityHours(capacity.total_available_minutes)} available
              </p>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto p-2">
              {capacity.employees.length > 0 ? (
                capacity.employees.map((employee) => (
                  <div
                    key={employee.profile_id}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="truncate text-foreground">{employee.full_name}</span>
                    <span className="shrink-0 font-medium tabular-nums text-scheduling">
                      {formatCapacityHours(employee.available_minutes)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No employee capacity remains.
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      {selectedQuote ? (
        <button
          type="button"
          onClick={() => onScheduleQuote(selectedQuote, date)}
          disabled={isSchedulingQuote}
          className={cn('mt-2 w-full rounded px-1.5 py-1 text-[10px] font-semibold', schedulingControlStyles.primary)}
          aria-label={`Schedule ${selectedQuote.base_quote_reference} from ${date}`}
        >
          Place job here
        </button>
      ) : null}
    </div>
  );
}

interface DndAnnouncementEntity {
  id: string | number;
  data?: Record<string, unknown>;
}

interface DndAnnouncementEvent {
  operation: {
    source: DndAnnouncementEntity | null;
    target: DndAnnouncementEntity | null;
  };
  canceled?: boolean;
}

function useDragSafeActivation(isDragging: boolean, onActivate: () => void) {
  const didDrag = useRef(false);

  useEffect(() => {
    if (isDragging) didDrag.current = true;
  }, [isDragging]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (didDrag.current) {
      didDrag.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onActivate();
  }

  function resetDragState() {
    if (!isDragging) didDrag.current = false;
  }

  return { handleClick, resetDragState };
}

function ResourceDragCue({ testId }: { testId: string }) {
  return (
    <GripVertical
      aria-hidden="true"
      focusable="false"
      data-testid={testId}
      className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground"
    />
  );
}

/** Must render inside DragDropProvider so the droppable registers with the manager. */
function ResourcesReturnDropCard({ children }: { children: ReactNode }) {
  const { ref, isDropTarget } = useDroppable({
    id: 'schedule-resources-return-drop',
    type: 'schedule-resources-return',
    accept: ['schedule-board-visit'],
    data: { returnToResources: true },
  });

  return (
    <Card
      ref={ref}
      className={cn(
        'flex min-h-0 flex-col border-border transition xl:h-full xl:overflow-hidden',
        isDropTarget && 'border-scheduling bg-scheduling-soft ring-2 ring-scheduling'
      )}
      data-testid="schedule-resources-panel"
      data-visit-return-target="true"
    >
      {children}
    </Card>
  );
}

function resourceCardTint(type: SelectedScheduleResource['type']): string {
  return type === 'employee'
    ? schedulingControlStyles.resourceEmployee
    : schedulingControlStyles.resourcePlant;
}

function ResourceCard({
  resource,
  subtitle,
  metadata,
  selected,
  dragEnabled,
  warning,
  occupancySegments,
  onSelect,
}: ResourceCardProps) {
  if (dragEnabled) {
    return (
      <DraggableResourceCard
        resource={resource}
        subtitle={subtitle}
        metadata={metadata}
        selected={selected}
        warning={warning}
        occupancySegments={occupancySegments}
        onSelect={onSelect}
      />
    );
  }

  const occupancyLabel = occupancySegments
    ? formatOccupancySummary(occupancySegments)
    : undefined;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${selected ? 'Selected' : 'Select'} ${resource.label}${occupancyLabel ? `. ${occupancyLabel}` : ''}`}
      title={occupancyLabel}
      data-testid={`schedule-resource-${resource.type}-${resource.id}`}
      className={cn(
        'relative flex w-full items-center gap-2 overflow-hidden rounded-lg p-2 text-left transition',
        selected
          ? schedulingControlStyles.primary
          : resourceCardTint(resource.type)
      )}
    >
      <ResourceDragCue testId="schedule-resource-drag-cue" />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className={cn('block truncate text-sm font-semibold', selected ? 'text-slate-950' : 'text-slate-100')} title={resource.label}>
          {resource.label}
        </span>
        <span className={cn('block truncate text-xs', selected ? 'text-slate-800' : 'text-slate-300')} title={subtitle}>
          {subtitle}
        </span>
        <span className={cn('block truncate text-[10px]', selected ? 'text-slate-700' : 'text-slate-400')} title={metadata}>
          {metadata}
        </span>
      </span>
      {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
      {occupancySegments ? (
        <ResourceOccupancyStrip resourceId={resource.id} segments={occupancySegments} />
      ) : null}
    </button>
  );
}

function DraggableResourceCard({
  resource,
  subtitle,
  metadata,
  selected,
  warning,
  occupancySegments,
  onSelect,
}: Omit<ResourceCardProps, 'dragEnabled'>) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `resource:${resource.type}:${resource.id}`,
    type: 'schedule-resource',
    data: { resource },
  });
  const { handleClick, resetDragState } = useDragSafeActivation(isDragging, onSelect);
  const occupancyLabel = occupancySegments
    ? formatOccupancySummary(occupancySegments)
    : undefined;

  return (
    <button
      ref={(node) => {
        ref(node);
        handleRef(node);
      }}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        handleClick(event);
      }}
      onPointerDown={resetDragState}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') resetDragState();
      }}
      aria-pressed={selected}
      aria-label={`${resource.label}: select resource or drag to a timed visit${occupancyLabel ? `. ${occupancyLabel}` : ''}`}
      title={occupancyLabel || 'Tap to assign, or drag to a timed visit'}
      data-testid={`schedule-resource-${resource.type}-${resource.id}`}
      className={cn(
        'relative flex min-h-11 w-full touch-none cursor-grab items-stretch overflow-hidden rounded-lg text-left transition',
        selected
          ? schedulingControlStyles.primary
          : resourceCardTint(resource.type),
        isDragging && 'cursor-grabbing opacity-40'
      )}
      style={{ touchAction: 'none' }}
    >
      <span
        data-testid={`schedule-resource-drag-handle-${resource.type}-${resource.id}`}
        className="flex min-h-11 min-w-11 touch-none items-center justify-center self-stretch"
        style={{ touchAction: 'none' }}
        aria-hidden="true"
      >
        <ResourceDragCue testId="schedule-resource-drag-cue" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 p-2 pl-0">
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className={cn('block truncate text-sm font-semibold', selected ? 'text-slate-950' : 'text-slate-100')} title={resource.label}>
            {resource.label}
          </span>
          <span className={cn('block truncate text-xs', selected ? 'text-slate-800' : 'text-slate-300')} title={subtitle}>
            {subtitle}
          </span>
          <span className={cn('block truncate text-[10px]', selected ? 'text-slate-700' : 'text-slate-300')} title={metadata}>
            {metadata}
          </span>
        </span>
        {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
      </span>
      {occupancySegments ? (
        <ResourceOccupancyStrip resourceId={resource.id} segments={occupancySegments} />
      ) : null}
    </button>
  );
}

interface DraggableQuoteCardProps {
  quote: SchedulingQueueItem;
  selected: boolean;
  onSelect: () => void;
}

function formatQuoteStatusLabel(status: string | null): string {
  if (!status) return 'No status';
  return status
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function DraggableQuoteCard({
  quote,
  selected,
  onSelect,
}: DraggableQuoteCardProps) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `schedule-queue:${quote.kind}:${quote.id}`,
    type: 'schedule-queue-item',
    data: { quote },
  });
  const durationDays = quote.estimated_duration_days || 1;
  const { handleClick, resetDragState } = useDragSafeActivation(isDragging, onSelect);

  return (
    <div
      ref={ref}
    >
      <button
        ref={handleRef}
        type="button"
        onClick={handleClick}
        onPointerDown={resetDragState}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') resetDragState();
        }}
        aria-pressed={selected}
        aria-label={`${quote.base_quote_reference}: select job or drag to a calendar date`}
        title={`${quote.base_quote_reference} — ${quote.customer_name ? `${quote.customer_name} · ` : ''}${quote.title}`}
        data-testid={`schedule-quote-${quote.id}`}
        className={cn(
          'flex min-h-11 w-full touch-none cursor-grab items-stretch rounded-lg p-1 text-left transition',
          selected
            ? schedulingControlStyles.primary
            : schedulingControlStyles.resourceJob,
          isDragging && 'cursor-grabbing opacity-40'
        )}
        style={{ touchAction: 'none' }}
      >
        <span
          className="flex min-h-11 min-w-11 items-center justify-center self-stretch"
          data-testid={`schedule-quote-drag-handle-${quote.kind}-${quote.id}`}
          aria-hidden="true"
        >
          <ResourceDragCue testId="schedule-quote-drag-cue" />
        </span>
        <span className="min-w-0 flex-1 py-1.5 pr-1.5">
          <span className={cn('block truncate text-sm font-semibold', selected ? 'text-slate-950' : 'text-slate-100')}>
            {quote.base_quote_reference}
          </span>
          <span className={cn('mt-1 block truncate text-xs', selected ? 'text-slate-800' : 'text-slate-300')}>
            {quote.customer_name ? `${quote.customer_name} · ` : ''}{quote.title}
          </span>
          <span className={cn('mt-1.5 flex items-center justify-between gap-2 text-[10px]', selected ? 'text-slate-800' : 'text-slate-300')}>
            <span>{durationDays} {durationDays === 1 ? 'day' : 'days'}</span>
            <span className={cn('truncate text-[9px]', selected ? 'text-slate-700' : 'text-slate-400')}>
              {'optimistic' in quote && quote.optimistic
                ? 'Updating…'
                : formatQuoteStatusLabel(quote.status)}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

interface ScheduledJobActionsProps {
  job: ScheduleJob;
  visitDate?: string;
  isMobile?: boolean;
  isCrewOfferPending: boolean;
  onAddVisit: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onReschedule: () => void;
  onToggleCrewOffer: () => void;
}

function ScheduledJobActions({
  job,
  visitDate,
  isMobile = false,
  isCrewOfferPending,
  onAddVisit,
  onEdit,
  onRemove,
  onReschedule,
  onToggleCrewOffer,
}: ScheduledJobActionsProps) {
  const buttonClass = cn(
    'p-0',
    isMobile ? 'h-11 w-11' : 'h-6 w-6'
  );
  const iconClass = isMobile ? 'h-4 w-4' : 'h-3 w-3';

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      data-testid={`schedule-job-actions-${isMobile ? 'mobile' : 'desktop'}-${job.id}`}
    >
      {visitDate ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            buttonClass,
            schedulingControlStyles.ghost
          )}
          onClick={onAddVisit}
          aria-label={`Add Additional Visit to ${job.job_reference} on ${visitDate}`}
          title="Add Additional Visit"
        >
          <Plus className={iconClass} />
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          buttonClass,
          job.is_drop_on_ready
            ? schedulingControlStyles.primary
            : schedulingControlStyles.ghost
        )}
        onClick={onToggleCrewOffer}
        aria-label="Offer if crew finishes early"
        aria-pressed={job.is_drop_on_ready}
        disabled={isCrewOfferPending}
        title="Offer if crew finishes early"
      >
        <Check className={cn(iconClass, !job.is_drop_on_ready && 'opacity-40')} />
      </Button>
      {job.source_type === 'quote' && job.quote_id ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              buttonClass,
              schedulingControlStyles.ghost
            )}
            onClick={onReschedule}
            aria-label={`Reschedule ${job.job_reference}`}
            title="Reschedule"
          >
            <CalendarPlus className={iconClass} />
          </Button>
          <Button
            asChild
            size="sm"
            variant="ghost"
            className={cn(
              buttonClass,
              schedulingControlStyles.ghost
            )}
          >
            <Link
              href={`/quotes/overview/${encodeURIComponent(job.job_reference)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open Quote ${job.job_reference} in new tab`}
              title="Open Quote in new tab"
            >
              <ExternalLink className={iconClass} />
            </Link>
          </Button>
        </>
      ) : null}
      {job.source_type === 'manual' && job.quote_project_number_id ? (
        <Button asChild size="sm" variant="ghost" className={cn(buttonClass, schedulingControlStyles.ghost)}>
          <Link
            href="/quotes?tab=projects"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open Project ${job.job_reference} in new tab`}
            title="Open Projects in new tab"
          >
            <ExternalLink className={iconClass} />
          </Link>
        </Button>
      ) : null}
      {job.source_type !== 'sample' ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            buttonClass,
            schedulingControlStyles.ghost
          )}
          onClick={onRemove}
          aria-label={`Remove ${job.job_reference}`}
          title="Remove from schedule"
        >
          <Trash2 className={iconClass} />
        </Button>
      ) : null}
      {job.source_type !== 'quote' ? <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          buttonClass,
          schedulingControlStyles.ghost
        )}
        onClick={onEdit}
        aria-label={`Edit ${job.job_reference}`}
        title="Edit scheduled job"
      >
        <Pencil className={iconClass} />
      </Button> : null}
    </div>
  );
}

interface AssignmentChipProps {
  assignment: ScheduleAssignment;
  onDelete: (assignment: ScheduleAssignment) => void;
  dragScope?: 'desktop' | 'mobile';
  dndInstanceId?: string;
}

function AssignmentChip({
  assignment,
  onDelete,
  dragScope = 'desktop',
  dndInstanceId,
}: AssignmentChipProps) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: dndInstanceId
      ? `${dragScope}:${dndInstanceId}:assignment:${assignment.resource_type}:${assignment.id}`
      : `${dragScope}:assignment:${assignment.resource_type}:${assignment.id}`,
    type: 'schedule-assignment',
    data: { assignment },
  });
  const fullLabel =
    assignment.resource_type === 'employee'
      ? assignment.employee?.full_name || 'Employee'
      : assignment.plant?.nickname || assignment.plant?.plant_id || 'Plant';
  const label = assignment.resource_type === 'employee'
    ? formatScheduleEmployeeCompactName(fullLabel)
    : fullLabel;
  const hasConflict = assignment.conflicts.length > 0;

  return (
    <div
      ref={ref}
      data-testid={`schedule-assignment-chip-${assignment.id}`}
      className={cn(
        'group inline-flex min-w-0 max-w-full shrink items-center overflow-hidden rounded-full border pr-0.5 text-[11px]',
        assignment.resource_type === 'employee'
          ? 'border-sky-500/35 bg-sky-500/10 text-sky-100'
          : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100',
        hasConflict && 'border-amber-400/70 bg-amber-500/10',
        isDragging && 'opacity-40'
      )}
      title={hasConflict ? assignment.conflicts.map((conflict) => conflict.message).join('\n') : fullLabel}
    >
      <button
        ref={handleRef}
        type="button"
        className={cn(
          'flex min-h-11 min-w-11 touch-none cursor-grab items-center justify-center rounded-l-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current',
          isDragging && 'cursor-grabbing'
        )}
        style={{ touchAction: 'none' }}
        aria-label={`Move ${fullLabel} to another visit`}
        data-testid={`schedule-assignment-drag-handle-${assignment.id}`}
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
      </button>
      <span className="flex min-w-0 items-center gap-1 py-0.5 pr-1">
        {assignment.resource_type === 'employee' ? (
          <UserRound className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Tractor className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 truncate">{label}</span>
        {hasConflict ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" /> : null}
        {assignment.conflict_override ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-label="Conflict overridden" />
        ) : null}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(assignment);
        }}
        className="ml-0.5 shrink-0 rounded-full p-0.5 opacity-70 hover:bg-black/20 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current focus-visible:opacity-100"
        aria-label={`Remove ${fullLabel}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

interface DayCellProps {
  row: ScheduleBoardRow;
  date: string;
  activeVisitId: string | null;
  onActivateVisit: (job: ScheduleJob, visit: ScheduleVisit) => void;
  onAddVisit: ((job: ScheduleJob) => void) | null;
  onEditVisit: (job: ScheduleJob, visit: ScheduleVisit) => void;
  onReturnVisit: (job: ScheduleJob, visit: ScheduleVisit) => void;
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
}

interface VisitCardProps {
  job: ScheduleJob;
  visit: ScheduleVisit;
  assignments: ScheduleAssignment[];
  className?: string;
  style?: CSSProperties;
  isDropEnabled: boolean;
  isActiveTarget: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onReturn: () => void;
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
  dndScope?: 'desktop' | 'mobile';
  cardWidth?: number;
  dndInstanceId?: string;
  hiddenAssignment?: ScheduleBoardHiddenAssignment | null;
}

function visitCardTestId(visitId: string, dndInstanceId?: string): string {
  return dndInstanceId
    ? `schedule-visit-${dndInstanceId}-${visitId}`
    : `schedule-visit-${visitId}`;
}

function VisitCard({
  job,
  visit,
  assignments,
  className,
  style,
  isDropEnabled,
  isActiveTarget,
  onActivate,
  onEdit,
  onReturn,
  onDeleteAssignment,
  dndScope = 'desktop',
  cardWidth,
  dndInstanceId,
  hiddenAssignment = null,
}: VisitCardProps) {
  const workDate = getScheduleVisitDate(visit.starts_at);
  const cardAssignments = filterHiddenBoardAssignments(assignments, hiddenAssignment);
  const visitDroppableId = dndInstanceId
    ? `${dndScope}:${dndInstanceId}:visit:${visit.id}`
    : `${dndScope}:visit:${visit.id}`;
  const visitDraggableId = dndInstanceId
    ? `${dndScope}:${dndInstanceId}:schedule-visit:${visit.id}`
    : `${dndScope}:schedule-visit:${visit.id}`;
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: visitDroppableId,
    type: 'schedule-visit',
    accept: ['schedule-resource', 'schedule-assignment', 'schedule-day-team'],
    disabled: !isDropEnabled || visit.status === 'cancelled',
    data: {
      jobId: job.id,
      jobReference: job.job_reference,
      visitId: visit.id,
      visitSequenceNumber: visit.sequence_number,
      workDate,
    },
  });
  const {
    ref: dragRef,
    handleRef: dragHandleRef,
    isDragging,
  } = useDraggable({
    id: visitDraggableId,
    type: 'schedule-board-visit',
    disabled: visit.status !== 'planned',
    data: { visit, job },
  });
  const { handleClick, resetDragState } = useDragSafeActivation(
    isDragging,
    visit.status === 'cancelled' ? onEdit : onActivate
  );
  const assignmentsPerRow =
    cardWidth === undefined || cardWidth >= 260 ? 3 : cardWidth >= 140 ? 2 : 1;
  const isCountOnly = cardWidth !== undefined && cardWidth < 140;
  const maximumSlots = assignmentsPerRow * 2;
  const hasOverflow = isCountOnly || cardAssignments.length > maximumSlots;
  const visibleAssignmentCount = hasOverflow
    ? Math.max(0, maximumSlots - 1)
    : cardAssignments.length;
  const visibleAssignments = cardAssignments.slice(0, visibleAssignmentCount);
  const hiddenAssignments = cardAssignments.slice(visibleAssignmentCount);
  const hiddenLabels = hiddenAssignments.map((assignment) =>
    assignment.resource_type === 'employee'
      ? assignment.employee?.full_name || 'Employee'
      : assignment.plant?.nickname || assignment.plant?.plant_id || 'Plant'
  );
  const assignmentItems = [
    ...visibleAssignments.map((assignment) => ({
      assignment,
      key: assignment.id,
    })),
    ...(hiddenAssignments.length > 0
      ? [{ assignment: null, key: 'overflow' }]
      : []),
  ];
  const assignmentRows = Array.from(
    { length: Math.ceil(assignmentItems.length / assignmentsPerRow) },
    (_, rowIndex) =>
      assignmentItems.slice(
        rowIndex * assignmentsPerRow,
        (rowIndex + 1) * assignmentsPerRow
      )
  );
  const shouldShowStatus =
    visit.status !== 'planned' && (cardWidth === undefined || cardWidth >= 220);

  return (
    <div
      ref={(node) => {
        dropRef(node);
        dragRef(node);
      }}
      data-schedule-visit-card
      data-testid={visitCardTestId(visit.id, dndInstanceId)}
      style={{ ...style, touchAction: 'none' }}
      className={cn(
        'flex h-full min-h-0 cursor-grab flex-col overflow-hidden rounded-md border border-border bg-card/80 p-1.5',
        className,
        visit.status === 'cancelled' && 'opacity-60',
        isDragging && 'cursor-grabbing opacity-40',
        isActiveTarget && 'border-scheduling ring-1 ring-scheduling',
        isDropTarget && 'border-scheduling bg-scheduling-soft ring-2 ring-scheduling'
      )}
    >
      <div className="mb-1 flex min-w-0 items-start justify-between gap-1">
        <button
          ref={dragHandleRef}
          type="button"
          onClick={handleClick}
          onPointerDown={resetDragState}
          className={cn(
            'min-w-0 flex-1 touch-none cursor-grab overflow-hidden rounded text-left text-xs font-semibold text-slate-100 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300',
            isDragging && 'cursor-grabbing'
          )}
          style={{ touchAction: 'none' }}
          aria-label={
            visit.status === 'cancelled'
              ? `Edit cancelled visit ${visit.sequence_number} for ${job.job_reference}`
              : `Select visit ${visit.sequence_number} for ${job.job_reference}`
          }
        >
          <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
            <Clock3 className="h-3 w-3 shrink-0" />
            {formatScheduleVisitTime(visit.starts_at)}–{formatScheduleVisitTime(visit.ends_at)}
            {shouldShowStatus ? (
              <span className="truncate font-normal text-muted-foreground">
                · {visit.status.replace('_', ' ')}
              </span>
            ) : null}
          </span>
          {visit.title ? (
            <span
              className="mt-0.5 block truncate font-normal text-muted-foreground"
              title={visit.title}
            >
              {visit.title}
            </span>
          ) : null}
          {dndInstanceId || (cardWidth !== undefined && cardWidth >= 120) ? (
            <span
              className="mt-0.5 block truncate text-[10px] font-medium text-slate-300"
              title={job.job_reference}
            >
              {job.job_reference}
            </span>
          ) : null}
        </button>
        <span className="flex shrink-0 items-center gap-0.5">
          {visit.status === 'planned' ? (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onReturn();
              }}
              className={cn('h-6 w-6 rounded p-0.5', schedulingControlStyles.ghost)}
              aria-label={`Return visit ${visit.sequence_number} for ${job.job_reference} to Jobs`}
              title="Return visit to Jobs"
            >
              <ListRestart className="h-3 w-3" />
            </button>
          ) : null}
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onEdit}
            className={cn('h-6 w-6 rounded p-0.5', schedulingControlStyles.ghost)}
            aria-label={`Edit visit ${visit.sequence_number}`}
          >
            <Pencil className="h-3 w-3" />
          </button>
        </span>
      </div>
      <div
        className="mt-auto max-h-12 shrink-0 space-y-1 overflow-hidden"
        data-testid={`schedule-assignment-layout-${visit.id}`}
        data-assignment-row-count={assignmentRows.length}
      >
        {assignmentRows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="flex min-w-0 items-center gap-1 overflow-hidden"
            data-testid={`schedule-assignment-row-${visit.id}-${rowIndex + 1}`}
          >
            {row.map((item) =>
              item.assignment ? (
                <AssignmentChip
                  key={item.key}
                  assignment={item.assignment}
                  onDelete={onDeleteAssignment}
                  dragScope={dndScope}
                  dndInstanceId={dndInstanceId}
                />
              ) : (
                <span
                  key={item.key}
                  tabIndex={0}
                  className="inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-muted px-1.5 text-[10px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-scheduling"
                  aria-label={`${hiddenAssignments.length} more assignments: ${hiddenLabels.join(', ')}`}
                  title={hiddenLabels.join(', ')}
                  data-testid={`schedule-assignment-overflow-${visit.id}`}
                >
                  +{hiddenAssignments.length}
                </span>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function boardRowDndInstanceId(row: ScheduleBoardRow): string | undefined {
  return row.kind === 'job' ? undefined : row.id;
}

function DayCell({
  row,
  date,
  activeVisitId,
  onActivateVisit,
  onAddVisit,
  onEditVisit,
  onReturnVisit,
  onDeleteAssignment,
}: DayCellProps) {
  const job = row.job;
  const active = row.kind === 'job' && job
    ? date >= job.start_date && date <= job.end_date
    : true;
  const placements = row.visitsByDate[date] || [];
  const legacyAssignments = row.legacyAssignmentsByDate[date] || [];
  const dndInstanceId = boardRowDndInstanceId(row);

  return (
    <div
      data-testid={getScheduleBoardCellTestId(row, date)}
      className={cn(
        'flex min-h-24 flex-col border-l border-border p-1.5',
        active
          ? 'bg-muted/10'
          : 'bg-muted/40 opacity-45'
      )}
    >
      <div className="space-y-1">
        {filterHiddenBoardAssignments(legacyAssignments, row.hiddenAssignment).map((assignment) => (
          <AssignmentChip
            key={`${assignment.resource_type}-${assignment.id}`}
            assignment={assignment}
            onDelete={onDeleteAssignment}
            dragScope="desktop"
            dndInstanceId={dndInstanceId}
          />
        ))}
        {placements.map((placement) => (
          <VisitCard
            key={`${placement.job.id}-${placement.visit.id}`}
            job={placement.job}
            visit={placement.visit}
            assignments={placement.assignments}
            isDropEnabled
            isActiveTarget={activeVisitId === placement.visit.id}
            onActivate={() => onActivateVisit(placement.job, placement.visit)}
            onEdit={() => onEditVisit(placement.job, placement.visit)}
            onReturn={() => onReturnVisit(placement.job, placement.visit)}
            onDeleteAssignment={onDeleteAssignment}
            dndInstanceId={dndInstanceId}
            hiddenAssignment={row.hiddenAssignment}
          />
        ))}
      </div>
      {row.kind === 'job' && job && active && onAddVisit ? (
        <button
          type="button"
          onClick={() => onAddVisit(job)}
          className={cn('ml-auto mt-auto flex h-7 w-7 items-center justify-center rounded transition', schedulingControlStyles.ghost)}
          aria-label={`Add Additional Visit to ${job.job_reference} on ${date}`}
          title="Add Additional Visit"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : row.kind === 'job' && job && !active ? (
        <span className="m-auto px-2 text-center text-[11px] text-muted-foreground">
          Outside job dates
        </span>
      ) : null}
    </div>
  );
}

const DAILY_TIMELINE_DEFAULT_START_HOUR = 5;
const DAILY_TIMELINE_DEFAULT_END_HOUR = 20;
const DAILY_TIMELINE_HOUR_WIDTH = 96;
const DAILY_TIMELINE_MIN_FIT_HOUR_WIDTH = 64;
const DAILY_TIMELINE_JOB_COLUMN_WIDTH = 240;
const DAILY_TIMELINE_PAN_THRESHOLD = 5;
const DAILY_JOB_ROW_MIN_HEIGHT = 144;
const DAILY_TIMELINE_EDGE_PADDING = 8;
const DAILY_TIMELINE_LANE_GAP = 8;
const DAILY_TIMELINE_LEGACY_HEIGHT = 48;
const DAILY_TIMELINE_VISIT_STYLE = {
  backgroundColor: '#334155',
} satisfies CSSProperties;

function dailyTimelineHourGridStyle(hourWidth: number): CSSProperties {
  return {
    backgroundImage:
      'linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px)',
    backgroundSize: `${hourWidth}px 100%`,
  };
}

interface DailyTimelineRange {
  startHour: number;
  endHour: number;
  hourWidth: number;
  width: number;
}

interface DailyTimelineCellProps {
  row: ScheduleBoardRow;
  date: string;
  range: DailyTimelineRange;
  layout: DailyTimelineLayout;
  isPannable: boolean;
  activeVisitId: string | null;
  onActivateVisit: (job: ScheduleJob, visit: ScheduleVisit) => void;
  onAddVisit: ((job: ScheduleJob) => void) | null;
  onEditVisit: (job: ScheduleJob, visit: ScheduleVisit) => void;
  onReturnVisit: (job: ScheduleJob, visit: ScheduleVisit) => void;
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
  onResizeVisit: (
    visit: ScheduleVisit,
    startsAt: string,
    endsAt: string
  ) => Promise<void>;
}

interface DailyTimelinePlacement extends ScheduleBoardVisitPlacement {
  top: number;
  height: number;
}

interface DailyTimelineLayout {
  placements: DailyTimelinePlacement[];
  legacyAssignments: ScheduleAssignment[];
  rowHeight: number;
}

function getDailyTimelineLayout(
  dayPlacements: ScheduleBoardVisitPlacement[],
  legacyAssignments: ScheduleAssignment[]
): DailyTimelineLayout {
  const sortedPlacements = [...dayPlacements].sort((first, second) =>
    first.visit.starts_at.localeCompare(second.visit.starts_at)
  );
  const firstLaneTop =
    DAILY_TIMELINE_EDGE_PADDING
    + (legacyAssignments.length > 0 ? DAILY_TIMELINE_LEGACY_HEIGHT : 0);
  let nextTop = firstLaneTop;
  const placements = sortedPlacements.map((placement, index) => {
    const height = placement.assignments.length > 2 ? 104 : 82;
    const laidOut = { ...placement, top: nextTop, height };
    nextTop += height;
    if (index < sortedPlacements.length - 1) nextTop += DAILY_TIMELINE_LANE_GAP;
    return laidOut;
  });
  const naturalRowHeight =
    placements.length > 0
      ? nextTop + DAILY_TIMELINE_EDGE_PADDING
      : DAILY_JOB_ROW_MIN_HEIGHT;
  const rowHeight = Math.max(DAILY_JOB_ROW_MIN_HEIGHT, naturalRowHeight);

  if (placements.length === 1) {
    placements[0] = {
      ...placements[0],
      height:
        rowHeight
        - placements[0].top
        - DAILY_TIMELINE_EDGE_PADDING,
    };
  }

  return { placements, legacyAssignments, rowHeight };
}

function getScheduleTimeMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = formatScheduleVisitTime(value).split(':');
  return Number(hours) * 60 + Number(minutes);
}

function getDailyTimelineRange(
  visits: ScheduleVisit[],
  date: string
): DailyTimelineRange {
  let startHour = DAILY_TIMELINE_DEFAULT_START_HOUR;
  let endHour = DAILY_TIMELINE_DEFAULT_END_HOUR;

  for (const visit of visits) {
    if (getScheduleVisitDate(visit.starts_at) !== date) continue;
    startHour = Math.min(startHour, Math.floor(getScheduleTimeMinutes(visit.starts_at) / 60));
    endHour = Math.max(endHour, Math.ceil(getScheduleTimeMinutes(visit.ends_at) / 60));
  }

  startHour = Math.max(0, startHour);
  endHour = Math.min(24, Math.max(startHour + 1, endHour));

  return {
    startHour,
    endHour,
    hourWidth: DAILY_TIMELINE_HOUR_WIDTH,
    width: (endHour - startHour) * DAILY_TIMELINE_HOUR_WIDTH,
  };
}

function canFitDailyTimeline(
  viewportWidth: number,
  range: DailyTimelineRange
): boolean {
  const timelineWidth = getDailyTimelineAvailableWidth(viewportWidth);
  const durationHours = range.endHour - range.startHour;
  return timelineWidth / durationHours >= DAILY_TIMELINE_MIN_FIT_HOUR_WIDTH;
}

function getDailyTimelineAvailableWidth(viewportWidth: number): number {
  return Math.max(0, viewportWidth - DAILY_TIMELINE_JOB_COLUMN_WIDTH);
}

const capturedSchedulePointers = new Map<number, Element>();

function rememberSchedulePointerCapture(target: Element, pointerId: number) {
  capturedSchedulePointers.set(pointerId, target);
}

function releaseSchedulePointerCaptures(pointerId?: number) {
  const entries = pointerId == null
    ? Array.from(capturedSchedulePointers.entries())
    : capturedSchedulePointers.has(pointerId)
      ? [[pointerId, capturedSchedulePointers.get(pointerId)!] as const]
      : [];
  for (const [id, element] of entries) {
    if (element.hasPointerCapture?.(id)) {
      element.releasePointerCapture(id);
    }
    capturedSchedulePointers.delete(id);
  }
  return entries.length;
}

function clearScheduleTextSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return;
  selection.removeAllRanges();
}

function isTimelinePanBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, [data-schedule-visit-card], [data-no-timeline-pan], [role="button"]'
    )
  );
}

function DailyTimelineHeader({
  date,
  range,
  isPannable,
  selectedQuote,
  isSchedulingQuote,
  onScheduleQuote,
}: {
  date: string;
  range: DailyTimelineRange;
  isPannable: boolean;
  selectedQuote: SchedulingQueueItem | null;
  isSchedulingQuote: boolean;
  onScheduleQuote: (quote: SchedulingQueueItem, date: string) => void;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `desktop:schedule-date:${date}`,
    type: 'schedule-date',
    accept: ['schedule-queue-item'],
    data: { workDate: date },
  });
  const hours = Array.from(
    { length: range.endHour - range.startHour + 1 },
    (_, index) => range.startHour + index
  );

  return (
    <div
      ref={ref}
      className={cn(
        'relative z-0 h-16 select-none border-l border-border bg-muted/60 transition',
        isPannable && 'cursor-grab',
        isDropTarget && 'bg-scheduling-soft ring-2 ring-inset ring-scheduling'
      )}
      style={{ width: range.width }}
      data-testid="schedule-daily-timeline-header"
      data-hour-width={range.hourWidth}
      data-timeline-pan-surface="true"
    >
      <p className="absolute left-3 top-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {format(parseISO(date), 'EEEE d MMMM')}
      </p>
      {selectedQuote ? (
        <button
          type="button"
          onClick={() => onScheduleQuote(selectedQuote, date)}
          disabled={isSchedulingQuote}
          className={cn('absolute right-3 top-2 rounded px-2 py-1 text-[10px] font-semibold', schedulingControlStyles.primary)}
          aria-label={`Schedule ${selectedQuote.base_quote_reference} from ${date}`}
        >
          Place selected job here
        </button>
      ) : null}
      {hours.map((hour, index) => {
        const isEndMarker = index === hours.length - 1;
        return (
          <div
            key={hour}
            data-testid={`schedule-timeline-hour-${hour}`}
            data-boundary={isEndMarker ? 'end' : undefined}
            className={cn(
              'absolute bottom-0 h-7 border-l border-border px-2 pt-1 text-xs font-medium tabular-nums text-foreground',
              isEndMarker && 'border-r'
            )}
            style={
              isEndMarker
                ? { right: 0, width: 1 }
                : { left: index * range.hourWidth, width: range.hourWidth }
            }
          >
            <span
              className={cn(
                'inline-block',
                isEndMarker && 'absolute right-0 top-1 whitespace-nowrap'
              )}
            >
              {String(hour).padStart(2, '0')}:00
            </span>
          </div>
        );
      })}
    </div>
  );
}

type VisitResizeEdge = 'start' | 'end';

interface VisitResizeTimes {
  startsAt: string;
  endsAt: string;
}

interface VisitResizeOperation extends VisitResizeTimes {
  edge: VisitResizeEdge;
  pointerId: number;
  originClientX: number;
  nextStartsAt: string;
  nextEndsAt: string;
}

interface ResizableDailyVisitProps {
  job: ScheduleJob;
  visit: ScheduleVisit;
  assignments: ScheduleAssignment[];
  range: DailyTimelineRange;
  top: number;
  height: number;
  isActiveTarget: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onReturn: () => void;
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
  onResizeVisit: DailyTimelineCellProps['onResizeVisit'];
  dndInstanceId?: string;
  hiddenAssignment?: ScheduleBoardHiddenAssignment | null;
}

function getResizedVisitTimes(
  visit: VisitResizeTimes,
  edge: VisitResizeEdge,
  deltaMinutes: number,
  range: DailyTimelineRange
): VisitResizeTimes {
  const rangeStartMinutes = range.startHour * 60;
  const rangeEndMinutes = range.endHour * 60;
  const startsAtMinutes = getScheduleTimeMinutes(visit.startsAt);
  const endsAtMinutes = getScheduleTimeMinutes(visit.endsAt);

  if (edge === 'start') {
    const nextStartMinutes = Math.min(
      Math.max(startsAtMinutes + deltaMinutes, rangeStartMinutes),
      endsAtMinutes - 30
    );
    return {
      startsAt: addMinutes(
        parseISO(visit.startsAt),
        nextStartMinutes - startsAtMinutes
      ).toISOString(),
      endsAt: visit.endsAt,
    };
  }

  const nextEndMinutes = Math.max(
    Math.min(endsAtMinutes + deltaMinutes, rangeEndMinutes),
    startsAtMinutes + 30
  );
  return {
    startsAt: visit.startsAt,
    endsAt: addMinutes(
      parseISO(visit.endsAt),
      nextEndMinutes - endsAtMinutes
    ).toISOString(),
  };
}

const VISIT_RESIZE_DRAFT_KEY = 'ffts-schedule-visit-resize-drafts';

function readVisitResizeDrafts(): Record<string, VisitResizeTimes> {
  try {
    return JSON.parse(sessionStorage.getItem(VISIT_RESIZE_DRAFT_KEY) || '{}') as Record<
      string,
      VisitResizeTimes
    >;
  } catch {
    return {};
  }
}

function writeVisitResizeDraft(visitId: string, next: VisitResizeTimes | null) {
  const drafts = readVisitResizeDrafts();
  if (next) drafts[visitId] = next;
  else delete drafts[visitId];
  sessionStorage.setItem(VISIT_RESIZE_DRAFT_KEY, JSON.stringify(drafts));
}

function sameVisitClock(left: string, right: string) {
  return parseISO(left).getTime() === parseISO(right).getTime();
}

function ResizableDailyVisit({
  job,
  visit,
  assignments,
  range,
  top,
  height,
  isActiveTarget,
  onActivate,
  onEdit,
  onReturn,
  onDeleteAssignment,
  onResizeVisit,
  dndInstanceId,
  hiddenAssignment = null,
}: ResizableDailyVisitProps) {
  const [draftTimes, setDraftTimesState] = useState<VisitResizeTimes | null>(
    () => readVisitResizeDrafts()[visit.id] || null
  );
  const resizeOperation = useRef<VisitResizeOperation | null>(null);

  function setDraftTimes(next: VisitResizeTimes | null) {
    writeVisitResizeDraft(visit.id, next);
    setDraftTimesState(next);
  }

  useEffect(() => {
    const stored = readVisitResizeDrafts()[visit.id];
    if (!stored) return;
    if (
      sameVisitClock(visit.starts_at, stored.startsAt)
      && sameVisitClock(visit.ends_at, stored.endsAt)
    ) {
      writeVisitResizeDraft(visit.id, null);
      // Draft store is external; clear the matching local draft after persist.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from session draft
      setDraftTimesState(null);
    }
  }, [visit.id, visit.starts_at, visit.ends_at]);
  const displayedVisit = draftTimes
    ? { ...visit, starts_at: draftTimes.startsAt, ends_at: draftTimes.endsAt }
    : visit;
  const rangeStartMinutes = range.startHour * 60;
  const startsAt = Math.max(
    rangeStartMinutes,
    getScheduleTimeMinutes(displayedVisit.starts_at)
  );
  const endsAt = Math.min(
    range.endHour * 60,
    getScheduleTimeMinutes(displayedVisit.ends_at)
  );
  const left =
    ((startsAt - rangeStartMinutes) / 60) * range.hourWidth + 4;
  const availableWidth = range.width - left - 4;
  const width = Math.min(
    availableWidth,
    Math.max(
      48,
      ((Math.max(endsAt, startsAt + 30) - startsAt) / 60)
        * range.hourWidth
        - 8
    )
  );

  function handleResizePointerDown(
    event: PointerEvent<HTMLButtonElement>,
    edge: VisitResizeEdge
  ) {
    event.preventDefault();
    event.stopPropagation();
    clearScheduleTextSelection();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rememberSchedulePointerCapture(event.currentTarget, event.pointerId);
    resizeOperation.current = {
      edge,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      startsAt: visit.starts_at,
      endsAt: visit.ends_at,
      nextStartsAt: visit.starts_at,
      nextEndsAt: visit.ends_at,
    };
  }

  function handleResizePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const operation = resizeOperation.current;
    if (!operation || operation.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rawDeltaMinutes =
      ((event.clientX - operation.originClientX) / range.hourWidth) * 60;
    const snappedDeltaMinutes = Math.round(rawDeltaMinutes / 30) * 30;
    const nextTimes = getResizedVisitTimes(
      { startsAt: operation.startsAt, endsAt: operation.endsAt },
      operation.edge,
      snappedDeltaMinutes,
      range
    );
    operation.nextStartsAt = nextTimes.startsAt;
    operation.nextEndsAt = nextTimes.endsAt;
    setDraftTimes(nextTimes);
  }

  function finishResize(event: PointerEvent<HTMLButtonElement>) {
    const operation = resizeOperation.current;
    if (!operation || operation.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeOperation.current = null;
    releaseSchedulePointerCaptures(event.pointerId);
    clearScheduleTextSelection();
    if (
      operation.nextStartsAt === operation.startsAt
      && operation.nextEndsAt === operation.endsAt
    ) {
      setDraftTimes(null);
      return;
    }
    setDraftTimes({
      startsAt: operation.nextStartsAt,
      endsAt: operation.nextEndsAt,
    });
    void onResizeVisit(
      visit,
      operation.nextStartsAt,
      operation.nextEndsAt
    ).catch(() => {
      setDraftTimes(null);
    });
  }

  function cancelResize(event: PointerEvent<HTMLButtonElement>) {
    if (resizeOperation.current?.pointerId !== event.pointerId) return;
    resizeOperation.current = null;
    setDraftTimes(null);
  }

  function handleResizeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    edge: VisitResizeEdge
  ) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const deltaMinutes = event.key === 'ArrowLeft' ? -30 : 30;
    const nextTimes = getResizedVisitTimes(
      { startsAt: visit.starts_at, endsAt: visit.ends_at },
      edge,
      deltaMinutes,
      range
    );
    if (
      nextTimes.startsAt === visit.starts_at
      && nextTimes.endsAt === visit.ends_at
    ) return;
    void onResizeVisit(visit, nextTimes.startsAt, nextTimes.endsAt);
  }

  function renderResizeHandle(edge: VisitResizeEdge) {
    const isStart = edge === 'start';
    return (
      <button
        type="button"
        className={cn(
          'group/resize absolute inset-y-0 z-10 w-3 touch-none cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300',
          isStart ? 'left-0' : 'right-0'
        )}
        onPointerDown={(event) => handleResizePointerDown(event, edge)}
        onPointerMove={handleResizePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={cancelResize}
        onLostPointerCapture={finishResize}
        onKeyDown={(event) => handleResizeKeyDown(event, edge)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        aria-label={`${isStart ? 'Adjust start' : 'Adjust end'} of visit ${visit.sequence_number} for ${job.job_reference}`}
      >
        <span
          className={cn(
            'absolute inset-y-2 w-0.5 rounded-full bg-scheduling/70 opacity-70 transition group-hover/resize:opacity-100',
            isStart ? 'left-1' : 'right-1'
          )}
        />
      </button>
    );
  }

  return (
    <div
      className="absolute"
      style={{ left, top, width, height }}
      data-testid={
        dndInstanceId
          ? `schedule-timeline-visit-${dndInstanceId}-${visit.id}`
          : `schedule-timeline-visit-${visit.id}`
      }
    >
      <VisitCard
        job={job}
        visit={displayedVisit}
        assignments={assignments}
        className="h-full cursor-default overflow-hidden border-slate-500 shadow-lg shadow-black/40"
        style={DAILY_TIMELINE_VISIT_STYLE}
        isDropEnabled
        isActiveTarget={isActiveTarget}
        onActivate={onActivate}
        onEdit={onEdit}
        onReturn={onReturn}
        onDeleteAssignment={onDeleteAssignment}
        cardWidth={width}
        dndInstanceId={dndInstanceId}
        hiddenAssignment={hiddenAssignment}
      />
      {visit.status !== 'cancelled' ? (
        <>
          {renderResizeHandle('start')}
          {renderResizeHandle('end')}
        </>
      ) : null}
    </div>
  );
}

function DailyTimelineCell({
  row,
  date,
  range,
  layout,
  isPannable,
  activeVisitId,
  onActivateVisit,
  onAddVisit,
  onEditVisit,
  onReturnVisit,
  onDeleteAssignment,
  onResizeVisit,
}: DailyTimelineCellProps) {
  const dndInstanceId = boardRowDndInstanceId(row);
  const addVisitJob = row.kind === 'job' ? row.job : null;
  const visibleLegacyAssignments = filterHiddenBoardAssignments(
    layout.legacyAssignments,
    row.hiddenAssignment
  );

  return (
    <div
      data-testid={getScheduleBoardCellTestId(row, date)}
      data-timeline-start={`${String(range.startHour).padStart(2, '0')}:00`}
      data-timeline-end={`${String(range.endHour).padStart(2, '0')}:00`}
      className={cn(
        'relative z-0 select-none border-l border-border bg-muted/10',
        isPannable && 'cursor-grab'
      )}
      data-timeline-pan-surface="true"
      style={{
        width: range.width,
        height: layout.rowHeight,
        ...dailyTimelineHourGridStyle(range.hourWidth),
      }}
    >
      {visibleLegacyAssignments.length > 0 ? (
        <div className="absolute inset-x-2 top-2 flex h-10 items-center gap-2 overflow-x-auto rounded-md border border-dashed border-border bg-card/90 px-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
            Untimed
          </span>
          {visibleLegacyAssignments.map((assignment) => (
            <AssignmentChip
              key={`${assignment.resource_type}-${assignment.id}`}
              assignment={assignment}
              onDelete={onDeleteAssignment}
              dragScope="desktop"
              dndInstanceId={dndInstanceId}
            />
          ))}
        </div>
      ) : null}
      {layout.placements.map(({
        job,
        visit,
        assignments: visitAssignments,
        top,
        height,
      }) => (
        <ResizableDailyVisit
          key={`${job.id}-${visit.id}`}
          job={job}
          visit={visit}
          assignments={visitAssignments}
          range={range}
          top={top}
          height={height}
          isActiveTarget={activeVisitId === visit.id}
          onActivate={() => onActivateVisit(job, visit)}
          onEdit={() => onEditVisit(job, visit)}
          onReturn={() => onReturnVisit(job, visit)}
          onDeleteAssignment={onDeleteAssignment}
          onResizeVisit={onResizeVisit}
          dndInstanceId={dndInstanceId}
          hiddenAssignment={row.hiddenAssignment}
        />
      ))}
      {layout.placements.length === 0 && addVisitJob && onAddVisit ? (
        <button
          type="button"
          onClick={() => onAddVisit(addVisitJob)}
          className={cn('absolute left-4 top-4 flex items-center gap-1 rounded-md px-3 py-2 text-xs font-medium', schedulingControlStyles.outline)}
          aria-label={`Add visit to ${addVisitJob.job_reference} on ${date}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add timed visit
        </button>
      ) : null}
    </div>
  );
}

function resourceFromEmployee(employee: ScheduleEmployeeResource): SelectedScheduleResource {
  return { type: 'employee', id: employee.id, label: employee.full_name };
}

function resourceFromPlant(plant: SchedulePlantResource): SelectedScheduleResource {
  return {
    type: 'plant',
    id: plant.id,
    label: plant.nickname ? `${plant.plant_id} — ${plant.nickname}` : plant.plant_id,
  };
}

function BoardRowIdentity({
  row,
  primary,
}: {
  row: ScheduleBoardRow;
  primary: SchedulingBoardPrimary;
}) {
  if (row.kind === 'job' && row.job) {
    return (
      <div className="min-w-0 overflow-hidden">
        <span className="block truncate font-semibold text-foreground">
          {row.job.job_reference}
        </span>
        <p
          className="mt-1 truncate text-sm text-muted-foreground"
          title={`${row.job.customer_name ? `${row.job.customer_name} · ` : ''}${row.job.title}`}
        >
          {row.job.customer_name ? `${row.job.customer_name} · ` : ''}{row.job.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {row.job.site_address || 'No site'}
        </p>
        {row.job.estimated_duration_minutes ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Estimated {Math.round(row.job.estimated_duration_minutes / 60 * 10) / 10} hours
          </p>
        ) : null}
      </div>
    );
  }

  if (row.kind === 'employee' && row.employee) {
    return (
      <div className="min-w-0 overflow-hidden">
        <span className="block truncate font-semibold text-foreground">
          {row.employee.full_name}
        </span>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {row.employee.team_name || 'No team'}
        </p>
      </div>
    );
  }

  if (row.kind === 'plant' && row.plant) {
    return (
      <div className="min-w-0 overflow-hidden">
        <span className="block truncate font-semibold text-foreground">
          {row.plant.nickname || row.plant.plant_id}
        </span>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {[row.plant.plant_id, row.plant.make, row.plant.model].filter(Boolean).join(' · ')}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden">
      <span className="block truncate font-semibold text-foreground">Unassigned</span>
      <p className="mt-1 truncate text-sm text-muted-foreground">
        Visits with no {primary === SCHEDULING_BOARD_PRIMARIES.plant ? 'plant' : 'employees'} yet
      </p>
    </div>
  );
}

interface SchedulingManagerBoardProps {
  userId: string;
}

interface ActiveVisitTarget {
  job: ScheduleJob;
  visit: ScheduleVisit;
}

interface PendingAssignmentConflict {
  input: CreateAssignmentInput;
  conflicts: SchedulingConflict[];
  assignment?: ScheduleAssignment;
}

interface PendingVisitReturn {
  target: ActiveVisitTarget;
  localAssignmentCount: number;
  preview: ScheduleVisitBacklogPreview | null;
  skipConfirmation?: boolean;
}

type DailyTimelineMode = 'fit' | 'scroll';

interface ColdWeekLoadState {
  epoch: number;
  status: 'loading' | 'failed' | 'authoritative';
  error?: string;
}

interface DailyTimelinePanOperation {
  pointerId: number;
  originClientX: number;
  originScrollLeft: number;
  hasDragged: boolean;
}

function flattenConflictMessages(payload: Record<string, unknown>): SchedulingConflict[] {
  const byDate = payload.conflicts_by_date;
  if (!byDate || typeof byDate !== 'object') return [];
  return Object.values(byDate as Record<string, SchedulingConflict[]>).flat();
}

export function SchedulingManagerBoard({ userId }: SchedulingManagerBoardProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canCreateQuotes } = usePermissionCheck('quotes', false);
  const { hasPermission: canViewCustomers } = usePermissionCheck('customers', false);
  const quotesSensitiveAccess = useSensitiveModuleAccess('quotes', {
    enabled: canCreateQuotes,
  });
  const dailyTimelineViewportRef = useRef<HTMLDivElement>(null);
  const dailyTimelinePanOperation = useRef<DailyTimelinePanOperation | null>(null);
  const latestPointerClientX = useRef<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => formatScheduleDate(new Date()));
  const [view, setView] = useState<SchedulingBoardView>(() =>
    readSchedulingViewPreference(userId)
  );
  const [primary, setPrimary] = useState<SchedulingBoardPrimary>(() =>
    readSchedulingPrimaryPreference(userId)
  );
  const [sidebarTab, setSidebarTab] = useState<'jobs' | 'employee' | 'plant'>('jobs');
  const [quoteStage, setQuoteStage] =
    useState<ScheduleQuoteStage | 'projects' | 'all'>('all');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const [jobFilters, setJobFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      tags: parseAsArrayOf(parseAsString).withDefault([]),
      ready: parseAsBoolean.withDefault(false),
    },
    { history: 'replace' }
  );
  const jobSearch = jobFilters.q;
  const [teamFilter, setTeamFilter] = useState('all');
  const [selectedResource, setSelectedResource] = useState<SelectedScheduleResource | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<SchedulingQueueItem | null>(null);
  const [draggedResource, setDraggedResource] = useState<SelectedScheduleResource | null>(null);
  const [draggedAssignment, setDraggedAssignment] = useState<ScheduleAssignment | null>(null);
  const [draggedQuote, setDraggedQuote] = useState<SchedulingQueueItem | null>(null);
  const [draggedVisit, setDraggedVisit] = useState<ActiveVisitTarget | null>(null);
  const [draggedDayTeam, setDraggedDayTeam] = useState<ScheduleDayTeamDragData | null>(null);
  const [activeVisitTarget, setActiveVisitTarget] = useState<ActiveVisitTarget | null>(null);
  const [resourceAvailabilityView, setResourceAvailabilityView] =
    useState<'available' | 'unavailable' | 'all'>('all');
  const [pendingConflict, setPendingConflict] = useState<PendingAssignmentConflict | null>(null);
  const [pendingVisitReturn, setPendingVisitReturn] =
    useState<PendingVisitReturn | null>(null);
  const [returningVisitIds, setReturningVisitIds] = useState<Set<string>>(
    () => new Set()
  );
  const [inFlightMutationKeys, setInFlightMutationKeys] = useState<Set<string>>(
    () => new Set()
  );
  const inFlightMutationKeysRef = useRef<Set<string>>(new Set());
  const mutationEpochByKeyRef = useRef<Map<string, number>>(new Map());
  const [optimisticOperations, setOptimisticOperations] =
    useState<SchedulingOptimisticOperation[]>([]);
  const optimisticOperationsRef = useRef<SchedulingOptimisticOperation[]>([]);
  const optimisticSequenceRef = useRef(0);
  const coordinatorOwnedIdsRef = useRef<Set<string>>(new Set());
  const mutationCoordinatorRef = useRef<SchedulingMutationCoordinator | null>(null);
  const settleCoordinatorCommandRef = useRef<
    (
      operation: SchedulingCoordinatorOperation,
      outcome: SchedulingPersistOutcome | { kind: 'uncertain' }
    ) => void
  >(() => {});
  const runCoalescedReconciliationRef = useRef<(keys: string[]) => Promise<void>>(
    async () => undefined
  );
  const backgroundReconcilerRef = useRef<CoalescedBackgroundReconciler | null>(null);
  if (!backgroundReconcilerRef.current) {
    backgroundReconcilerRef.current = new CoalescedBackgroundReconciler({
      delayMs: 400,
      run: async (keys) => {
        await runCoalescedReconciliationRef.current(keys);
      },
    });
  }
  const reconciliationAttemptsRef = useRef<Map<string, number>>(new Map());
  const deferredReconcileKeysRef = useRef<string[]>([]);
  const boardInteractionBusyRef = useRef(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDraft, setQuickAddDraft] =
    useState<QuickAddScheduleProjectInput | null>(null);
  const [pendingCreationKind, setPendingCreationKind] = useState<
    'quote' | 'project' | 'quick_add' | null
  >(null);
  const [visitTarget, setVisitTarget] = useState<{
    job: ScheduleJob;
    visit: ScheduleVisit | null;
    date: string;
  } | null>(null);
  const [visitDraft, setVisitDraft] = useState<SaveScheduleVisitInput | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);
  const [jobDraft, setJobDraft] = useState<ScheduleJobUpdateInput | null>(null);
  const [schedulingQuoteJob, setSchedulingQuoteJob] = useState<ScheduleJob | null>(null);
  const [quoteScheduleDraft, setQuoteScheduleDraft] =
    useState<ScheduleQuoteInput | null>(null);
  const [projectPlacement, setProjectPlacement] = useState<{
    project: ScheduleProjectCandidate;
    date: string;
    initialVisit?: { starts_at: string; ends_at: string };
  } | null>(null);
  const [projectPlacementDraft, setProjectPlacementDraft] =
    useState<CreateProjectScheduleJobInput | null>(null);
  const [unavailabilityOpen, setUnavailabilityOpen] = useState(false);
  const [plantBlockDraft, setPlantBlockDraft] =
    useState<SavePlantUnavailabilityInput | null>(null);
  const [pendingDeleteAssignment, setPendingDeleteAssignment] = useState<ScheduleAssignment | null>(null);
  const [pendingRemoveJob, setPendingRemoveJob] = useState<ScheduleJob | null>(null);
  const [isRemovingJob, setIsRemovingJob] = useState(false);
  const isSchedulingQuote = false;
  const [pendingCrewOfferJobIds, setPendingCrewOfferJobIds] = useState<Set<string>>(
    () => new Set()
  );
  const [dailyTimelineMode, setDailyTimelineMode] =
    useState<DailyTimelineMode>('fit');
  const [dailyTimelineViewportWidth, setDailyTimelineViewportWidth] =
    useState<number | null>(null);
  const [isDailyTimelinePanning, setIsDailyTimelinePanning] = useState(false);
  const [dndSessionEpoch, setDndSessionEpoch] = useState(0);
  const dragUiRef = useRef({
    resource: false,
    assignment: false,
    quote: false,
    visit: false,
    dayTeam: false,
  });
  const visitReturnPreviewPromisesRef = useRef<
    Map<string, Promise<ScheduleVisitBacklogPreview>>
  >(new Map());
  const [coldWeekStates, setColdWeekStates] =
    useState<Map<string, ColdWeekLoadState>>(() => new Map());
  const coldWeekEpochsRef = useRef<Map<string, number>>(new Map());
  const [quoteCreationOpen, setQuoteCreationOpen] = useState(false);
  const [projectCreationOpen, setProjectCreationOpen] = useState(false);
  const [quoteManagerOptions, setQuoteManagerOptions] = useState<QuoteManagerOption[]>([]);
  const [quoteManagerOptionsError, setQuoteManagerOptionsError] = useState<string | null>(null);
  const shouldAutoPromptQuotes =
    canCreateQuotes
    && quotesSensitiveAccess.state?.required === true
    && quotesSensitiveAccess.state.unlocked === false;
  const shouldShowQuotesGate =
    !quotesSensitiveAccess.canAccess
    && (pendingCreationKind !== null || shouldAutoPromptQuotes);
  const visibleSelectedQuote =
    selectedQuote?.kind === 'project' && !quotesSensitiveAccess.canAccess
      ? null
      : selectedQuote;
  const visibleDraggedQuote =
    draggedQuote?.kind === 'project' && !quotesSensitiveAccess.canAccess
      ? null
      : draggedQuote;

  const weekStart = getSchedulingWeek(selectedDate).start;
  const boardQuery = useQuery({
    queryKey: ['scheduling-board', weekStart],
    queryFn: () => fetchSchedulingBoard(weekStart),
  });
  const quoteCandidatesQuery = useQuery({
    queryKey: ['scheduling-quote-candidates'],
    queryFn: fetchScheduleQuoteCandidates,
  });
  const projectCandidatesQuery = useQuery({
    queryKey: ['scheduling-project-candidates'],
    queryFn: fetchScheduleProjectCandidates,
    enabled: quotesSensitiveAccess.canAccess,
  });
  const visitBacklogQuery = useQuery({
    queryKey: ['scheduling-visit-backlog'],
    queryFn: fetchScheduleVisitBacklog,
  });
  const projectedState = useMemo(
    () => projectSchedulingState(
      {
        board: boardQuery.data,
        quoteCandidates: quoteCandidatesQuery.data,
        projectCandidates: projectCandidatesQuery.data,
        visitBacklog: visitBacklogQuery.data,
      },
      optimisticOperations,
      `board:${weekStart}`
    ),
    [
      boardQuery.data,
      optimisticOperations,
      projectCandidatesQuery.data,
      quoteCandidatesQuery.data,
      visitBacklogQuery.data,
      weekStart,
    ]
  );
  useEffect(() => () => {
    backgroundReconcilerRef.current?.dispose();
    backgroundReconcilerRef.current = null;
    mutationCoordinatorRef.current?.dispose();
    mutationCoordinatorRef.current = null;
  }, []);
  function clearDragUi() {
    const leftover = Object.values(dragUiRef.current).some(Boolean);
    dragUiRef.current = {
      resource: false,
      assignment: false,
      quote: false,
      visit: false,
      dayTeam: false,
    };
    setDraggedResource(null);
    setDraggedAssignment(null);
    setDraggedQuote(null);
    setDraggedVisit(null);
    setDraggedDayTeam(null);
    return leftover;
  }

  function clearStuckBoardInteraction(
    _reason: string,
    options?: { resetDnd?: boolean }
  ) {
    dailyTimelinePanOperation.current = null;
    setIsDailyTimelinePanning(false);
    const hadDrag = clearDragUi();
    clearScheduleTextSelection();
    releaseSchedulePointerCaptures();
    if (hadDrag && options?.resetDnd) {
      setDndSessionEpoch((epoch) => epoch + 1);
    }
  }

  useEffect(() => {
    function resetStuckPointerUi(event: globalThis.PointerEvent) {
      if (event.type === 'pointerup' && event.buttons !== 0) return;
      const leftoverDrag = Object.values(dragUiRef.current).some(Boolean);
      const hadPan = Boolean(dailyTimelinePanOperation.current);
      if (leftoverDrag || hadPan || isDailyTimelinePanning) {
        clearStuckBoardInteraction(`window-${event.type}`, { resetDnd: leftoverDrag });
      }
      if (boardInteractionBusyRef.current) {
        endBoardPointerBusy(`window-${event.type}`);
      }
    }
    function resetStuckPointerUiOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      clearStuckBoardInteraction('escape', { resetDnd: true });
    }
    window.addEventListener('pointerup', resetStuckPointerUi);
    window.addEventListener('pointercancel', resetStuckPointerUi);
    window.addEventListener('keydown', resetStuckPointerUiOnEscape);
    return () => {
      window.removeEventListener('pointerup', resetStuckPointerUi);
      window.removeEventListener('pointercancel', resetStuckPointerUi);
      window.removeEventListener('keydown', resetStuckPointerUiOnEscape);
    };
  }, [isDailyTimelinePanning]);
  useEffect(() => {
    if (!canCreateQuotes || !quotesSensitiveAccess.canAccess) {
      setQuoteManagerOptions([]);
      setQuoteManagerOptionsError(null);
      return;
    }
    let cancelled = false;
    void fetch('/api/quotes/metadata')
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          managerOptions?: QuoteManagerOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setQuoteManagerOptions([]);
          if (response.status === 428) {
            setQuoteManagerOptionsError(
              'Unlock the Quotes sensitive PIN to load quote managers.'
            );
            return;
          }
          setQuoteManagerOptionsError(
            payload.error || 'Unable to load quote managers. Check Quotes access and try again.'
          );
          return;
        }
        setQuoteManagerOptions(payload.managerOptions || []);
        setQuoteManagerOptionsError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setQuoteManagerOptions([]);
        setQuoteManagerOptionsError('Unable to load quote managers. Check Quotes access and try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [canCreateQuotes, quotesSensitiveAccess.canAccess]);
  useEffect(() => {
    if (!pendingCreationKind || !quotesSensitiveAccess.canAccess) return;
    if (pendingCreationKind === 'quote') setQuoteCreationOpen(true);
    else if (pendingCreationKind === 'project') setProjectCreationOpen(true);
    else setQuickAddOpen(true);
    setPendingCreationKind(null);
  }, [pendingCreationKind, quotesSensitiveAccess.canAccess]);
  useEffect(() => {
    if (quotesSensitiveAccess.canAccess) return;
    setSelectedQuote((current) => current?.kind === 'project' ? null : current);
    setDraggedQuote((current) => current?.kind === 'project' ? null : current);
    setProjectPlacement(null);
  }, [quotesSensitiveAccess.canAccess]);

  function requestCreation(kind: 'quote' | 'project' | 'quick_add') {
    if (kind === 'quick_add') setQuickAddDraft(null);
    if (!quotesSensitiveAccess.canAccess) {
      setPendingCreationKind(kind);
      return;
    }
    if (kind === 'quote') setQuoteCreationOpen(true);
    else if (kind === 'project') setProjectCreationOpen(true);
    else setQuickAddOpen(true);
  }

  function beginMutation(key: string): number | null {
    if (inFlightMutationKeysRef.current.has(key)) return null;
    inFlightMutationKeysRef.current = new Set(inFlightMutationKeysRef.current).add(key);
    setInFlightMutationKeys(new Set(inFlightMutationKeysRef.current));
    const nextEpoch = (mutationEpochByKeyRef.current.get(key) || 0) + 1;
    mutationEpochByKeyRef.current.set(key, nextEpoch);
    return nextEpoch;
  }

  function endMutation(key: string) {
    const next = new Set(inFlightMutationKeysRef.current);
    next.delete(key);
    inFlightMutationKeysRef.current = next;
    setInFlightMutationKeys(next);
  }

  function isCurrentMutation(key: string, epoch: number): boolean {
    return mutationEpochByKeyRef.current.get(key) === epoch;
  }

  function syncOptimisticOperations(next: SchedulingOptimisticOperation[]) {
    optimisticOperationsRef.current = next;
    setOptimisticOperations(next);
    mutationCoordinatorRef.current?.replaceOperations(
      next.filter((operation) => coordinatorOwnedIdsRef.current.has(operation.id))
    );
    mutationCoordinatorRef.current?.setPeerOperations(
      next.filter((operation) => !coordinatorOwnedIdsRef.current.has(operation.id))
    );
    for (const attemptKey of reconciliationAttemptsRef.current.keys()) {
      if (!next.some((operation) => attemptKey.startsWith(`${operation.id}:`))) {
        reconciliationAttemptsRef.current.delete(attemptKey);
      }
    }
  }

  function getMutationCoordinator(): SchedulingMutationCoordinator {
    if (!mutationCoordinatorRef.current) {
      mutationCoordinatorRef.current = new SchedulingMutationCoordinator({
        nextSequence: () => ++optimisticSequenceRef.current,
        onChange: (operations) => {
          const ownedIds = new Set(operations.map((operation) => operation.id));
          const previousOwned = coordinatorOwnedIdsRef.current;
          coordinatorOwnedIdsRef.current = ownedIds;
          const others = optimisticOperationsRef.current.filter(
            (operation) => !previousOwned.has(operation.id) && !ownedIds.has(operation.id)
          );
          optimisticOperationsRef.current = [...others, ...operations].sort(
            (left, right) => left.sequence - right.sequence
          );
          setOptimisticOperations(optimisticOperationsRef.current);
        },
        onSettled: (operation, outcome) => {
          settleCoordinatorCommandRef.current(operation, outcome);
        },
      });
    }
    return mutationCoordinatorRef.current;
  }

  function cancelOptimisticQueries(queryKeys: string[]) {
    for (const key of queryKeys) {
      const queryKey = queryKeyFromOptimisticKey(key);
      if (queryKey) {
        void queryClient.cancelQueries({ queryKey, exact: true });
      }
    }
  }

  function registerOptimisticOperation(input: {
    id?: string;
    kind: string;
    lockKeys: string[];
    queryKeys: string[];
    proofs?: SchedulingOptimisticOperation['proofs'];
    apply: SchedulingOptimisticOperation['apply'];
  }): SchedulingOptimisticOperation {
    const operation: SchedulingOptimisticOperation = {
      id: input.id || crypto.randomUUID(),
      sequence: ++optimisticSequenceRef.current,
      kind: input.kind,
      status: 'pending',
      lockKeys: input.lockKeys,
      claims: claimsFromLockKeys(input.lockKeys),
      queryKeys: input.queryKeys,
      reconciledKeys: [],
      proofs: input.proofs || {},
      apply: input.apply,
    };
    syncOptimisticOperations([...optimisticOperationsRef.current, operation]);
    cancelOptimisticQueries(operation.queryKeys);
    return operation;
  }

  function visitIdentityWaitKeys(...ids: Array<string | undefined | null>) {
    return ids.filter((id): id is string => Boolean(id && isOptimisticEntityId(id)));
  }

  function rewriteIdentityInMap(id: string, aliases: Record<string, string>) {
    return aliases[id] || id;
  }

  function publishSchedulingIdentityAliases(aliases: Record<string, string>) {
    const entries = Object.entries(aliases).filter(([from, to]) => Boolean(from && to && from !== to));
    if (entries.length === 0) return;
    const map = Object.fromEntries(entries);
    getMutationCoordinator().publishIdentityAliases(map);
    setActiveVisitTarget((current) => {
      if (!current) return current;
      const nextVisitId = rewriteIdentityInMap(current.visit.id, map);
      const nextJobId = rewriteIdentityInMap(current.job.id, map);
      const nextVisitJobId = rewriteIdentityInMap(current.visit.job_id, map);
      if (
        nextVisitId === current.visit.id
        && nextJobId === current.job.id
        && nextVisitJobId === current.visit.job_id
      ) {
        return current;
      }
      return {
        ...current,
        job: nextJobId === current.job.id ? current.job : { ...current.job, id: nextJobId },
        visit: {
          ...current.visit,
          id: nextVisitId,
          job_id: nextVisitJobId,
        },
      };
    });
    setVisitTarget((current) => {
      if (!current?.visit) return current;
      const nextVisitId = rewriteIdentityInMap(current.visit.id, map);
      const nextJobId = rewriteIdentityInMap(current.job.id, map);
      const nextVisitJobId = rewriteIdentityInMap(current.visit.job_id, map);
      if (
        nextVisitId === current.visit.id
        && nextJobId === current.job.id
        && nextVisitJobId === current.visit.job_id
      ) {
        return current;
      }
      return {
        ...current,
        job: nextJobId === current.job.id ? current.job : { ...current.job, id: nextJobId },
        visit: {
          ...current.visit,
          id: nextVisitId,
          job_id: nextVisitJobId,
        },
      };
    });
  }

  function adoptAuthoritativeVisit(input: {
    optimisticVisitId?: string | null;
    visit: ScheduleVisit | null | undefined;
    optimisticJobId?: string | null;
    job?: ScheduleJob | null;
  }): ScheduleVisit | null | undefined {
    if (!input.visit) return input.visit;
    const aliases: Record<string, string> = {};
    if (input.optimisticVisitId && input.optimisticVisitId !== input.visit.id) {
      aliases[input.optimisticVisitId] = input.visit.id;
    }
    if (input.optimisticJobId && input.job && input.optimisticJobId !== input.job.id) {
      aliases[input.optimisticJobId] = input.job.id;
    }
    publishSchedulingIdentityAliases(aliases);
    return input.visit;
  }

  function isBlockingVisitCommand(operation: SchedulingCoordinatorOperation) {
    return operation.status === 'uncertain' || operation.executionStatus !== 'completed';
  }

  function visitCommandClaimsIdentity(
    operation: SchedulingCoordinatorOperation,
    visitId: string,
    resolved: string
  ) {
    return (
      operation.claims.some((claim) =>
        claim.scope === 'visit-tree' && (claim.id === visitId || claim.id === resolved)
      )
      || operation.lockKeys.some((key) => key.endsWith(':' + visitId) || key.endsWith(':' + resolved))
    );
  }

  function findActiveVisitProducer(visitId: string) {
    const coordinator = getMutationCoordinator();
    const resolved = coordinator.resolveIdentity(visitId);
    return coordinator.getOperations().find((operation) =>
      isBlockingVisitCommand(operation)
      && (
        operation.kind === 'create-visit'
        || operation.kind === 'quick-add'
        || operation.kind === 'schedule-quote'
        || operation.kind === 'schedule-project'
        || operation.kind === 'schedule-backlog-visit'
      )
      && visitCommandClaimsIdentity(operation, visitId, resolved)
    );
  }

  function findActiveVisitReturn(visitId: string) {
    const coordinator = getMutationCoordinator();
    const resolved = coordinator.resolveIdentity(visitId);
    return coordinator.getOperations().find((operation) =>
      operation.kind === 'return-visit-to-backlog'
      && isBlockingVisitCommand(operation)
      && visitCommandClaimsIdentity(operation, visitId, resolved)
    );
  }

  function admitBoardCommand(input: {
    id?: string;
    kind: string;
    claims: SchedulingCoordinatorOperation['claims'];
    lockKeys?: string[];
    duplicateKey?: string;
    coalesceGroup?: string;
    dependsOn?: string[];
    identityWaitKeys?: string[];
    retryPolicy?: SchedulingCoordinatorOperation['retryPolicy'];
    requestId?: string;
    queryKeys: string[];
    proofs?: SchedulingOptimisticOperation['proofs'];
    apply: SchedulingOptimisticOperation['apply'];
    persist: () => Promise<SchedulingPersistOutcome>;
  }) {
    const result = getMutationCoordinator().admit(input);
    coordinatorOwnedIdsRef.current.add(result.operation.id);
    if (!result.duplicate) {
      cancelOptimisticQueries(result.operation.queryKeys);
    }
    return result;
  }

  function queryKeyFromOptimisticKey(key: string): readonly unknown[] | null {
    if (key.startsWith('board:')) return ['scheduling-board', key.slice('board:'.length)];
    if (key === 'quotes') return ['scheduling-quote-candidates'];
    if (key === 'projects') return ['scheduling-project-candidates'];
    if (key === 'backlog') return ['scheduling-visit-backlog'];
    return null;
  }

  function setColdWeekStateIfCurrent(
    targetWeekStart: string,
    epoch: number,
    nextState: Omit<ColdWeekLoadState, 'epoch'>
  ) {
    if (coldWeekEpochsRef.current.get(targetWeekStart) !== epoch) return;
    setColdWeekStates((current) => {
      const next = new Map(current);
      next.set(targetWeekStart, { epoch, ...nextState });
      return next;
    });
  }

  function beginColdWeekEpoch(
    targetWeekStart: string,
    status: ColdWeekLoadState['status'] = 'loading'
  ): number {
    const epoch = (coldWeekEpochsRef.current.get(targetWeekStart) || 0) + 1;
    coldWeekEpochsRef.current.set(targetWeekStart, epoch);
    setColdWeekStates((current) => {
      const next = new Map(current);
      next.set(targetWeekStart, { epoch, status });
      return next;
    });
    return epoch;
  }

  function fetchColdWeekInBackground(targetWeekStart: string) {
    const targetKey = ['scheduling-board', targetWeekStart] as const;
    const epoch = beginColdWeekEpoch(targetWeekStart);
    void queryClient.cancelQueries({ queryKey: targetKey, exact: true })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: targetKey,
          exact: true,
          refetchType: 'none',
        })
      )
      .then(() =>
        queryClient.fetchQuery({
          queryKey: targetKey,
          queryFn: () => fetchSchedulingBoard(targetWeekStart),
          staleTime: 0,
        })
      )
      .then(() => {
        setColdWeekStateIfCurrent(targetWeekStart, epoch, {
          status: 'authoritative',
        });
      })
      .catch(() => {
        setColdWeekStateIfCurrent(targetWeekStart, epoch, {
          status: 'failed',
          error: 'Unable to load the remaining details for this week.',
        });
      });
  }

  function isBoardPointerBusy() {
    return (
      boardInteractionBusyRef.current
      || Boolean(dailyTimelinePanOperation.current)
      || Object.values(dragUiRef.current).some(Boolean)
    );
  }

  function flushDeferredReconciles() {
    const keys = deferredReconcileKeysRef.current;
    deferredReconcileKeysRef.current = [];
    if (keys.length === 0) return;
    reconcileOptimisticKeysInBackground(keys);
  }

  function beginBoardPointerBusy(_reason: string) {
    boardInteractionBusyRef.current = true;
    void queryClient.cancelQueries({
      queryKey: ['scheduling-board', weekStart],
      exact: true,
    });
    void queryClient.cancelQueries({
      queryKey: ['scheduling-visit-backlog'],
      exact: true,
    });
  }

  function endBoardPointerBusy(_reason: string) {
    boardInteractionBusyRef.current = false;
    flushDeferredReconciles();
  }

  function readConfirmedProjection(boardWeek = weekStart): SchedulingProjection {
    return {
      board: queryClient.getQueryData(['scheduling-board', boardWeek]),
      quoteCandidates: queryClient.getQueryData(['scheduling-quote-candidates']),
      projectCandidates: queryClient.getQueryData(['scheduling-project-candidates']),
      visitBacklog: queryClient.getQueryData(['scheduling-visit-backlog']),
    };
  }

  function scheduleBackgroundReconciliation(keys: string[]) {
    backgroundReconcilerRef.current?.schedule(keys);
  }

  async function runCoalescedReconciliation(keys: string[]) {
    if (isBoardPointerBusy()) {
      deferredReconcileKeysRef.current = Array.from(
        new Set([...deferredReconcileKeysRef.current, ...keys])
      );
      return;
    }
    for (const key of new Set(keys)) {
      if (
        optimisticOperationsRef.current.some(
          (operation) =>
            operation.queryKeys.includes(key)
            && operation.status === 'pending'
        )
      ) {
        continue;
      }
      const queryKey = queryKeyFromOptimisticKey(key);
      if (!queryKey) continue;
      const boardWeek = key.startsWith('board:')
        ? key.slice('board:'.length)
        : null;
      const eligibleOperationIds = new Set(
        optimisticOperationsRef.current
          .filter(
            (operation) =>
              operation.status !== 'pending'
              && operation.queryKeys.includes(key)
              && (reconciliationAttemptsRef.current.get(
                `${operation.id}:${key}`
              ) || 0) < 3
          )
          .map((operation) => operation.id)
      );
      const coldEpoch =
        boardWeek && coldWeekEpochsRef.current.has(boardWeek)
          ? beginColdWeekEpoch(boardWeek)
          : null;
      for (const operationId of eligibleOperationIds) {
        const attemptKey = `${operationId}:${key}`;
        reconciliationAttemptsRef.current.set(
          attemptKey,
          (reconciliationAttemptsRef.current.get(attemptKey) || 0) + 1
        );
      }
      try {
        await queryClient.refetchQueries(
          { queryKey, exact: true, type: 'all' },
          { throwOnError: true, cancelRefetch: true }
        );
        const proofBoardWeek = boardWeek || weekStart;
        const base = readConfirmedProjection(proofBoardWeek);
        const updated = eligibleOperationIds.size > 0
          ? reconcileOptimisticOperations(
              optimisticOperationsRef.current,
              key,
              base,
              eligibleOperationIds
            )
          : optimisticOperationsRef.current;
        if (eligibleOperationIds.size > 0) {
          for (const operation of updated) {
            if (
              eligibleOperationIds.has(operation.id)
              && operation.reconciledKeys.includes(key)
            ) {
              reconciliationAttemptsRef.current.delete(`${operation.id}:${key}`);
            }
          }
          syncOptimisticOperations(updated);
        }
        if (boardWeek && coldEpoch !== null) {
          setColdWeekStateIfCurrent(boardWeek, coldEpoch, {
            status: 'authoritative',
          });
        }
        const needsRetry = updated.some(
          (operation) =>
            eligibleOperationIds.has(operation.id)
            && !operation.reconciledKeys.includes(key)
            && (reconciliationAttemptsRef.current.get(
              `${operation.id}:${key}`
            ) || 0) < 3
        );
        if (needsRetry) scheduleBackgroundReconciliation([key]);
      } catch {
        if (boardWeek && coldEpoch !== null) {
          setColdWeekStateIfCurrent(boardWeek, coldEpoch, {
            status: 'failed',
            error: 'Unable to reconcile the latest schedule for this week.',
          });
        }
        const needsRetry = optimisticOperationsRef.current.some(
          (operation) =>
            eligibleOperationIds.has(operation.id)
            && (reconciliationAttemptsRef.current.get(
              `${operation.id}:${key}`
            ) || 0) < 3
        );
        if (needsRetry) scheduleBackgroundReconciliation([key]);
      }
    }
  }
  runCoalescedReconciliationRef.current = runCoalescedReconciliation;

  function reconcileOptimisticKeysInBackground(keys: string[], _delayMs = 0) {
    scheduleBackgroundReconciliation(keys);
  }

  function retireSatisfiedOperation(
    operation: SchedulingOptimisticOperation,
    projection: SchedulingProjection
  ) {
    let next = optimisticOperationsRef.current;
    for (const key of operation.queryKeys) {
      next = reconcileOptimisticOperations(
        next,
        key,
        projection,
        new Set([operation.id])
      );
    }
    syncOptimisticOperations(next);
    if (coordinatorOwnedIdsRef.current.has(operation.id)) {
      getMutationCoordinator().retire(operation.id);
    }
  }

  function settleCoordinatorCommand(
    operation: SchedulingCoordinatorOperation,
    outcome: SchedulingPersistOutcome | { kind: 'uncertain' }
  ) {
    const projection = readConfirmedProjection();
    if (outcome.kind === 'success') {
      const proofsSatisfied = proofsSatisfiedForKeys(
        operation.proofs,
        operation.queryKeys,
        projection
      );
      const plan = planPostMutationReconciliation({
        outcome: 'success',
        proofsSatisfied,
      });
      if (plan.retire) retireSatisfiedOperation(operation, projection);
      scheduleBackgroundReconciliation(operation.queryKeys);
      return;
    }
    scheduleBackgroundReconciliation(operation.queryKeys);
  }
  settleCoordinatorCommandRef.current = settleCoordinatorCommand;

  function settleOptimisticOperation(
    operationId: string,
    outcome: 'success' | 'failure' = 'success',
    error?: unknown,
    acknowledgement?: {
      proofs?: SchedulingOptimisticOperation['proofs'];
      apply?: SchedulingOptimisticOperation['apply'];
    }
  ) {
    const operation = optimisticOperationsRef.current.find(
      (current) => current.id === operationId
    );
    if (!operation) return;
    const isAmbiguous =
      outcome === 'failure'
      && (
        error instanceof TypeError
        || (error instanceof SchedulingApiError && error.status >= 500)
      );
    if (outcome === 'failure' && !isAmbiguous) {
      syncOptimisticOperations(
        removeOptimisticOperation(optimisticOperationsRef.current, operationId)
      );
      scheduleBackgroundReconciliation(operation.queryKeys);
      return;
    }
    const nextOperations = optimisticOperationsRef.current.map((current) =>
      current.id === operationId
        ? {
            ...current,
            status: isAmbiguous ? 'uncertain' as const : 'acknowledged' as const,
            proofs: acknowledgement?.proofs || current.proofs,
            apply: acknowledgement?.apply || current.apply,
          }
        : current
    );
    syncOptimisticOperations(nextOperations);
    const settled = nextOperations.find((current) => current.id === operationId);
    if (!settled) return;
    const projection = readConfirmedProjection();
    const plan = planPostMutationReconciliation({
      outcome: isAmbiguous ? 'ambiguous' : 'success',
      proofsSatisfied: proofsSatisfiedForKeys(
        settled.proofs,
        settled.queryKeys,
        projection
      ),
    });
    if (plan.retire) retireSatisfiedOperation(settled, projection);
    scheduleBackgroundReconciliation(settled.queryKeys);
  }

  const board = projectedState.board;
  const coldWeekState = coldWeekStates.get(weekStart);
  const isTentativeWeek =
    coldWeekState?.status === 'loading' || coldWeekState?.status === 'failed';
  const weekDates = useMemo(
    () => {
      if (!board) return [];
      if (view === SCHEDULING_BOARD_VIEWS.daily) return [selectedDate];
      return enumerateScheduleDates(board.week.start, board.week.end);
    },
    [board, selectedDate, view]
  );
  const dailyTimelineBaseRange = useMemo(
    () => getDailyTimelineRange(board?.visits || [], selectedDate),
    [board?.visits, selectedDate]
  );
  const isDailyTimelineFitEligible =
    dailyTimelineViewportWidth === null
    || canFitDailyTimeline(dailyTimelineViewportWidth, dailyTimelineBaseRange);
  const effectiveDailyTimelineMode =
    dailyTimelineMode === 'fit' && isDailyTimelineFitEligible ? 'fit' : 'scroll';
  const dailyTimelineRange = useMemo(() => {
    if (
      effectiveDailyTimelineMode !== 'fit'
      || dailyTimelineViewportWidth === null
    ) return dailyTimelineBaseRange;

    const availableWidth = getDailyTimelineAvailableWidth(dailyTimelineViewportWidth);
    const durationHours =
      dailyTimelineBaseRange.endHour - dailyTimelineBaseRange.startHour;
    const hourWidth = Math.floor(availableWidth / durationHours);
    const width = hourWidth * durationHours;

    return {
      ...dailyTimelineBaseRange,
      hourWidth,
      width,
    };
  }, [
    dailyTimelineBaseRange,
    dailyTimelineViewportWidth,
    effectiveDailyTimelineMode,
  ]);

  useEffect(() => {
    if (view !== SCHEDULING_BOARD_VIEWS.daily) return;
    const timelineViewport = dailyTimelineViewportRef.current;
    if (!timelineViewport) return;

    function updateViewportWidth(width: number) {
      if (width <= 0) return;
      setDailyTimelineViewportWidth(width);
    }

    updateViewportWidth(timelineViewport.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
      updateViewportWidth(timelineViewport.clientWidth);
    });
    resizeObserver.observe(timelineViewport);
    return () => resizeObserver.disconnect();
  }, [dailyTimelineBaseRange, view]);

  useEffect(() => {
    if (
      view === SCHEDULING_BOARD_VIEWS.daily
      && effectiveDailyTimelineMode === 'fit'
      && dailyTimelineViewportRef.current
    ) {
      dailyTimelineViewportRef.current.scrollLeft = 0;
    }
  }, [dailyTimelineViewportWidth, effectiveDailyTimelineMode, view]);

  useEffect(() => {
    function trackPointer(event: globalThis.PointerEvent | globalThis.MouseEvent) {
      latestPointerClientX.current = event.clientX;
    }
    window.addEventListener('pointermove', trackPointer, { passive: true });
    window.addEventListener('mousemove', trackPointer, { passive: true });
    return () => {
      window.removeEventListener('pointermove', trackPointer);
      window.removeEventListener('mousemove', trackPointer);
    };
  }, []);
  const capacityByDate = useMemo(
    () => new Map(
      (board?.employee_capacity || []).map((capacity) => [capacity.date, capacity])
    ),
    [board?.employee_capacity]
  );

  const teams = useMemo(() => {
    const values = new Map<string, string>();
    for (const employee of board?.resources.employees || []) {
      if (employee.team_id) values.set(employee.team_id, employee.team_name || 'Unnamed team');
    }
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [board]);
  const unscheduledQuotes = useMemo<SchedulingQueueItem[]>(
    () => (projectedState.quoteCandidates || []).filter(
      (quote) =>
        !quote.start_date
        && (quote.optimistic || getScheduleQuoteStage(quote.status) !== null)
    ).map((quote) => ({ ...quote, kind: 'quote' as const })),
    [projectedState.quoteCandidates]
  );
  const unscheduledProjects = useMemo<SchedulingQueueItem[]>(
    () => (quotesSensitiveAccess.canAccess ? projectedState.projectCandidates || [] : []).map((project) => ({
      kind: 'project' as const,
      id: project.id,
      quote_reference: project.project_reference,
      base_quote_reference: project.project_reference,
      title: project.title,
      customer_name: null,
      status: 'Project' as const,
      start_date: null,
      end_date: null,
      estimated_duration_days: 1 as const,
      estimated_duration_minutes: 180 as const,
      project,
    })),
    [projectedState.projectCandidates, quotesSensitiveAccess.canAccess]
  );
  const returnedVisits = useMemo<SchedulingQueueItem[]>(
    () => (projectedState.visitBacklog || []).map((item) => ({
      kind: 'returned_visit' as const,
      id: item.visit_id,
      quote_reference: item.job_reference,
      base_quote_reference: `${item.job_reference} · Visit ${item.sequence_number}`,
      title: item.title || item.job_title,
      customer_name: item.customer_name,
      status: 'Returned visit' as const,
      start_date: null,
      end_date: null,
      estimated_duration_days: 1 as const,
      estimated_duration_minutes: item.duration_minutes,
      returned_visit: item,
    })),
    [projectedState.visitBacklog]
  );
  const quoteStageCounts = useMemo(() => {
    const counts: Record<ScheduleQuoteStage, number> = {
      draft: 0,
      pending: 0,
      accepted: 0,
    };
    for (const quote of unscheduledQuotes) {
      const stage = getScheduleQuoteStage(quote.status);
      if (stage) counts[stage] += 1;
    }
    return counts;
  }, [unscheduledQuotes]);
  const filteredQuoteCandidates = useMemo(() => {
    const search = quoteSearch.trim().toLowerCase();
    const source =
      quoteStage === 'all'
        ? [...returnedVisits, ...unscheduledQuotes, ...unscheduledProjects]
        : quoteStage === 'projects'
          ? unscheduledProjects
          : unscheduledQuotes;
    return source.filter(
      (quote) =>
        (
          quoteStage === 'all'
          || quoteStage === 'projects'
          || getScheduleQuoteStage(quote.status) === quoteStage
        )
        && (
          !search
          || quote.quote_reference.toLowerCase().includes(search)
          || quote.base_quote_reference.toLowerCase().includes(search)
          || quote.title.toLowerCase().includes(search)
          || (quote.customer_name || '').toLowerCase().includes(search)
        )
    );
  }, [quoteSearch, quoteStage, returnedVisits, unscheduledProjects, unscheduledQuotes]);

  const matchingEmployees = useMemo(() => {
    const search = resourceSearch.trim().toLowerCase();
    return (board?.resources.employees || []).filter(
      (employee) =>
        (teamFilter === 'all' || employee.team_id === teamFilter) &&
        (!search ||
          employee.full_name.toLowerCase().includes(search) ||
          (employee.employee_id || '').toLowerCase().includes(search))
    );
  }, [board, resourceSearch, teamFilter]);
  const matchingPlant = useMemo(() => {
    const search = resourceSearch.trim().toLowerCase();
    return (board?.resources.plant || []).filter(
      (plant) =>
        !search ||
        plant.plant_id.toLowerCase().includes(search) ||
        (plant.nickname || '').toLowerCase().includes(search)
    );
  }, [board, resourceSearch]);
  const availableEmployees = useMemo(() => {
    if (!activeVisitTarget) return matchingEmployees;
    return matchingEmployees.filter(
      (employee) =>
        !isResourceUnavailableForVisit(
          { type: 'employee', id: employee.id },
          board?.assignments || [],
          activeVisitTarget.visit
        )
    );
  }, [activeVisitTarget, board?.assignments, matchingEmployees]);
  const availablePlant = useMemo(() => {
    if (!activeVisitTarget) return matchingPlant;
    return matchingPlant.filter(
      (plant) =>
        !isResourceUnavailableForVisit(
          { type: 'plant', id: plant.id },
          board?.assignments || [],
          activeVisitTarget.visit
        )
    );
  }, [activeVisitTarget, board?.assignments, matchingPlant]);
  const unavailableEmployees = matchingEmployees.filter(
    (employee) => !availableEmployees.some((available) => available.id === employee.id)
  );
  const unavailablePlant = matchingPlant.filter(
    (plant) => !availablePlant.some((available) => available.id === plant.id)
  );
  const filteredEmployees =
    resourceAvailabilityView === 'available'
      ? availableEmployees
      : resourceAvailabilityView === 'unavailable'
        ? unavailableEmployees
        : matchingEmployees;
  const filteredPlant =
    resourceAvailabilityView === 'available'
      ? availablePlant
      : resourceAvailabilityView === 'unavailable'
        ? unavailablePlant
        : matchingPlant;
  const filteredJobs = useMemo(() => {
    const search = jobSearch.trim().toLowerCase();
    const rangeStart = weekDates[0];
    const rangeEnd = weekDates[weekDates.length - 1];
    return (board?.jobs || []).filter(
      (job) =>
        (!rangeStart || !rangeEnd || (job.start_date <= rangeEnd && job.end_date >= rangeStart))
        && (!jobFilters.ready || job.is_drop_on_ready)
        && (
          jobFilters.tags.length === 0
          || (job.tags || []).some((tag) => jobFilters.tags.includes(tag.id))
        )
        && (
          !search
          || job.job_reference.toLowerCase().includes(search)
          || job.title.toLowerCase().includes(search)
          || (job.site_address || '').toLowerCase().includes(search)
        )
    );
  }, [board, jobFilters.ready, jobFilters.tags, jobSearch, weekDates]);
  const boardRows = useMemo(
    () =>
      buildScheduleBoardRows({
        primary,
        jobs: filteredJobs,
        visits: board?.visits || [],
        assignments: board?.assignments || [],
        employees: board?.resources.employees || [],
        plant: board?.resources.plant || [],
        dates: weekDates,
      }),
    [board, filteredJobs, primary, weekDates]
  );
  const hasActiveJobFilters =
    Boolean(jobSearch.trim()) || jobFilters.ready || jobFilters.tags.length > 0;

  function applyCapacity(
    boardData: SchedulingBoardPayload,
    capacity?: ScheduleDayCapacity[]
  ): SchedulingBoardPayload {
    return capacity?.length
      ? replaceEmployeeCapacity(boardData, capacity)
      : boardData;
  }

  function assignmentFromMutationRow(
    row: AssignmentMutationRow,
    resource: SelectedScheduleResource | null,
    visit: ScheduleVisit | null
  ): ScheduleAssignment {
    const resourceType = (row.resource_type as 'employee' | 'plant' | undefined)
      || (resource?.type)
      || (typeof row.profile_id === 'string' ? 'employee' : 'plant');
    const base = {
      id: String(row.id),
      job_id: String(row.job_id),
      work_date: String(row.work_date),
      visit_id: typeof row.visit_id === 'string' ? row.visit_id : visit?.id || null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      conflict_override: row.conflict_override === true,
      conflict_codes: Array.isArray(row.conflict_codes) ? row.conflict_codes : [],
      conflict_override_by:
        typeof row.conflict_override_by === 'string' ? row.conflict_override_by : null,
      conflict_override_at:
        typeof row.conflict_override_at === 'string' ? row.conflict_override_at : null,
      assigned_by: typeof row.assigned_by === 'string' ? row.assigned_by : null,
      created_at: String(row.created_at || new Date().toISOString()),
      updated_at: String(row.updated_at || new Date().toISOString()),
      conflicts: [],
      visit,
    };
    if (resourceType === 'employee') {
      const profileId = String(row.profile_id || resource?.id || '');
      return {
        ...base,
        resource_type: 'employee',
        profile_id: profileId,
        employee:
          board?.resources.employees.find((employee) => employee.id === profileId) || null,
      };
    }
    const plantId = String(row.plant_id || resource?.id || '');
    return {
      ...base,
      resource_type: 'plant',
      plant_id: plantId,
      plant: board?.resources.plant.find((plant) => plant.id === plantId) || null,
    };
  }

  async function toggleCrewOffer(job: ScheduleJob) {
    if (isOptimisticEntityId(job.id)) {
      toast.info('Wait for this new job to finish saving.');
      return;
    }
    if (pendingCrewOfferJobIds.has(job.id)) return;
    const nextValue = !job.is_drop_on_ready;
    const operation = registerOptimisticOperation({
      kind: 'toggle-crew-offer',
      lockKeys: [`job:${job.id}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.jobs.some(
            (item) => item.id === job.id && item.is_drop_on_ready === nextValue
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardWithJob(state.board, { ...job, is_drop_on_ready: nextValue })
          : state.board,
      }),
    });
    if (!operation) return;
    setPendingCrewOfferJobIds((current) => new Set(current).add(job.id));
    try {
      const authoritative = await saveScheduleJob({ is_drop_on_ready: nextValue }, job.id);
      setBoardBaseData((current) => patchBoardWithJob(current, authoritative));
      settleOptimisticOperation(operation.id, 'success', undefined, {
        proofs: { [`board:${weekStart}`]: provesJob(authoritative) },
        apply: (state) => ({
          ...state,
          board: state.board
            ? patchBoardWithJob(state.board, authoritative)
            : state.board,
        }),
      });
      toast.success(nextValue ? 'Crew offer enabled' : 'Crew offer disabled');
    } catch (error) {
      settleOptimisticOperation(operation.id, 'failure', error);
      toast.error(error instanceof Error ? error.message : 'Unable to update crew offer');
    } finally {
      setPendingCrewOfferJobIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }

  async function scheduleQuoteFromDate(
    quote: SchedulingQueueItem,
    startDate: string,
    initialVisit?: { starts_at: string; ends_at: string }
  ) {
    if (quote.kind === 'returned_visit') {
      const startsAt =
        initialVisit?.starts_at
        || toScheduleLondonDateTimeIso(
          startDate,
          formatScheduleVisitTime(quote.returned_visit.original_starts_at)
        );
      const endsAt = new Date(
        parseISO(startsAt).getTime()
        + quote.returned_visit.duration_milliseconds
      ).toISOString();
      if (getScheduleVisitDate(endsAt) !== startDate) {
        toast.error('This visit does not fit within the selected day.');
        return;
      }

      const operationId = crypto.randomUUID();
      const now = new Date().toISOString();
      const fallbackJob: ScheduleJob = {
        id: quote.returned_visit.job_id,
        job_reference: quote.returned_visit.job_reference,
        title: quote.returned_visit.job_title,
        description: null,
        site_address: null,
        status: 'scheduled',
        source_type: quote.returned_visit.source_type,
        start_date: startDate,
        end_date: startDate,
        estimated_duration_minutes: quote.returned_visit.duration_minutes,
        quote_id: null,
        quote_project_number_id: null,
        customer_id: null,
        customer_site_id: null,
        customer_name: quote.returned_visit.customer_name,
        is_drop_on_ready: false,
        tags: [],
        created_by: null,
        updated_by: userId,
        created_at: now,
        updated_at: now,
      };
      const optimisticJob: ScheduleJob = quote.returned_visit.job
        ? {
            ...quote.returned_visit.job,
            start_date: startDate,
            end_date: startDate,
            updated_by: userId,
            updated_at: now,
          }
        : fallbackJob;
      const fallbackVisit: ScheduleVisit = {
        id: quote.returned_visit.visit_id,
        job_id: optimisticJob.id,
        sequence_number: quote.returned_visit.sequence_number,
        title: quote.returned_visit.title,
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'planned',
        notes: quote.returned_visit.notes,
        created_by: null,
        updated_by: userId,
        created_at: now,
        updated_at: now,
      };
      const optimisticVisit: ScheduleVisit = quote.returned_visit.visit
        ? {
            ...quote.returned_visit.visit,
            job_id: optimisticJob.id,
            starts_at: startsAt,
            ends_at: endsAt,
            updated_by: userId,
            updated_at: now,
          }
        : fallbackVisit;
      const requestId = crypto.randomUUID();
      const returnCommand = findActiveVisitReturn(quote.returned_visit.visit_id);
      const admitted = admitBoardCommand({
        id: operationId,
        kind: 'schedule-backlog-visit',
        requestId,
        dependsOn: returnCommand ? [returnCommand.id] : undefined,
        claims: visitReturnPlaceClaims(optimisticJob.id, optimisticVisit.id),
        queryKeys: [`board:${weekStart}`, 'backlog'],
        proofs: {
          [`board:${weekStart}`]: (state) =>
            state.board?.visits.some(
              (visit) =>
                visit.id === optimisticVisit.id
                && visit.starts_at === startsAt
            ) === true,
          backlog: (state) =>
            state.visitBacklog?.every(
              (item) => item.visit_id !== optimisticVisit.id
            ) === true,
        },
        apply: (state) => ({
          ...state,
          board: state.board
            ? patchBoardWithVisit(
                patchBoardWithJob(state.board, optimisticJob),
                optimisticVisit
              )
            : state.board,
          visitBacklog: removeVisitBacklogItem(state.visitBacklog, optimisticVisit.id),
        }),
        persist: async () => {
          const liveRequestId =
            mutationCoordinatorRef.current?.getOperations().find((operation) =>
              operation.id === operationId
            )?.requestId ?? requestId;
          try {
            const result = await scheduleQueuedVisit({
              request_id: liveRequestId,
              visit_id: quote.returned_visit.visit_id,
              starts_at: startsAt,
            });
            const scheduledVisit = adoptAuthoritativeVisit({
              optimisticVisitId: quote.returned_visit.visit_id,
              visit: result.visit,
              job: result.job,
            }) || result.visit;
            setBoardBaseData((current) =>
              patchBoardWithVisit(
                patchBoardWithJob(current, result.job),
                scheduledVisit
              )
            );
            queryClient.setQueryData(
              ['scheduling-visit-backlog'],
              (current: ScheduleVisitBacklogItem[] | undefined) =>
                removeVisitBacklogItem(current, scheduledVisit.id)
            );
            toast.success(`${quote.base_quote_reference} returned to the schedule`);
            return {
              kind: 'success' as const,
              proofs: {
                [`board:${weekStart}`]: (state: SchedulingProjection) =>
                  provesJob(result.job)(state) && provesVisit(scheduledVisit)(state),
                backlog: (state: SchedulingProjection) =>
                  state.visitBacklog?.every(
                    (item) => item.visit_id !== scheduledVisit.id
                  ) === true,
              },
              apply: (state: SchedulingProjection) => ({
                ...state,
                board: state.board
                  ? patchBoardWithVisit(
                      patchBoardWithJob(state.board, result.job),
                      scheduledVisit
                    )
                  : state.board,
                visitBacklog: removeVisitBacklogItem(
                  state.visitBacklog,
                  scheduledVisit.id
                ),
              }),
            };
          } catch (error) {
            setSelectedQuote(quote);
            if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
              toast.error(
                error instanceof Error ? error.message : 'Unable to schedule this returned visit'
              );
              return toPersistOutcome(error);
            }
            throw error;
          }
        },
      });
      if (admitted.duplicate) return;
      setSelectedQuote(null);
      return;
    }
    if (quote.kind === 'project') {
      if (!quotesSensitiveAccess.canAccess) return;
      setProjectPlacementDraft(null);
      setProjectPlacement({ project: quote.project, date: startDate, initialVisit });
      return;
    }
    const endDate = getScheduleQuoteEndDate(
      startDate,
      quote.estimated_duration_days
    );
    const operationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const optimisticJob: ScheduleJob = {
      id: createOptimisticEntityId(operationId, 'job'),
      job_reference: quote.base_quote_reference,
      title: quote.title,
      description: null,
      site_address: null,
      status: 'scheduled',
      source_type: 'quote',
      start_date: startDate,
      end_date: endDate,
      estimated_duration_minutes: quote.estimated_duration_minutes || null,
      quote_id: quote.id,
      quote_project_number_id: null,
      customer_id: null,
      customer_site_id: null,
      customer_name: quote.customer_name,
      is_drop_on_ready: false,
      tags: [],
      created_by: null,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    };
    const optimisticVisit = initialVisit
      ? {
          id: createOptimisticEntityId(operationId, 'visit'),
          job_id: optimisticJob.id,
          sequence_number: 1,
          title: null,
          starts_at: initialVisit.starts_at,
          ends_at: initialVisit.ends_at,
          status: 'planned' as const,
          notes: null,
          created_by: null,
          updated_by: userId,
          created_at: now,
          updated_at: now,
        }
      : null;
    const operation = registerOptimisticOperation({
      id: operationId,
      kind: 'schedule-quote',
      lockKeys: [`quote:${quote.id}`],
      queryKeys: [`board:${weekStart}`, 'quotes'],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.jobs.some(
            (job) =>
              job.quote_id === quote.id
              && job.start_date === startDate
              && job.end_date === endDate
          ) === true,
        quotes: (state) =>
          state.quoteCandidates?.every((candidate) => candidate.id !== quote.id) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? optimisticVisit
            ? patchBoardWithVisit(
                patchBoardWithJob(state.board, optimisticJob),
                optimisticVisit
              )
            : patchBoardWithJob(state.board, optimisticJob)
          : state.board,
        quoteCandidates: removeQuoteCandidate(state.quoteCandidates, quote.id),
      }),
    });
    if (!operation) return;
    setSelectedQuote(null);
    try {
      const result = await saveQuoteSchedule({
        quote_id: quote.id,
        start_date: startDate,
        end_date: endDate,
        ...(initialVisit ? { initial_visit: initialVisit } : {}),
      });
      const scheduledVisit = adoptAuthoritativeVisit({
        optimisticVisitId: optimisticVisit?.id,
        visit: result.visit,
        optimisticJobId: optimisticJob.id,
        job: result.job,
      });
      setBoardBaseData((current) => {
        const withJob = patchBoardWithJob(current, result.job, optimisticJob.id);
        return scheduledVisit
          ? patchBoardWithVisit(withJob, scheduledVisit, optimisticVisit?.id)
          : withJob;
      });
      queryClient.setQueryData(
        ['scheduling-quote-candidates'],
        (current: ScheduleQuoteCandidate[] | undefined) =>
          removeQuoteCandidate(current, quote.id)
      );
      settleOptimisticOperation(operation.id, 'success', undefined, {
        proofs: {
          [`board:${weekStart}`]: (state) =>
            provesJob(result.job)(state)
            && (!scheduledVisit || provesVisit(scheduledVisit)(state)),
          quotes: (state) =>
            state.quoteCandidates?.every(
              (candidate) => candidate.id !== quote.id
            ) === true,
        },
        apply: (state) => ({
          ...state,
          board: state.board
            ? scheduledVisit
              ? patchBoardWithVisit(
                  patchBoardWithJob(state.board, result.job),
                  scheduledVisit
                )
              : patchBoardWithJob(state.board, result.job)
            : state.board,
          quoteCandidates: removeQuoteCandidate(state.quoteCandidates, quote.id),
        }),
      });
      toast.success(
        `${quote.base_quote_reference} scheduled ${startDate === endDate ? `for ${startDate}` : `from ${startDate} to ${endDate}`}`
      );
    } catch (error) {
      if (optimisticVisit) getMutationCoordinator().cancelWaiters(optimisticVisit.id);
      if (optimisticJob) getMutationCoordinator().cancelWaiters(optimisticJob.id);
      settleOptimisticOperation(operation.id, 'failure', error);
      setSelectedQuote(quote);
      toast.error(error instanceof Error ? error.message : 'Unable to schedule this Quote');
    }
  }

  function handleProjectPlacementSubmit(input: CreateProjectScheduleJobInput) {
    if (!projectPlacement) return;
    setProjectPlacementDraft(input);
    const project = projectPlacement.project;
    const operationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const optimisticJob: ScheduleJob = {
      id: createOptimisticEntityId(operationId, 'job'),
      job_reference: project.project_reference,
      title: project.title,
      description: project.description,
      site_address: input.site_address || null,
      status: input.status,
      source_type: 'manual',
      start_date: input.start_date,
      end_date: input.end_date,
      estimated_duration_minutes: input.estimated_duration_minutes || null,
      quote_id: null,
      quote_project_number_id: project.id,
      customer_id: input.customer_id,
      customer_site_id: input.customer_site_id || null,
      is_drop_on_ready: input.is_drop_on_ready,
      tags: [],
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    };
    const optimisticVisit = input.initial_visit
      ? {
          id: createOptimisticEntityId(operationId, 'visit'),
          job_id: optimisticJob.id,
          sequence_number: 1,
          title: null,
          starts_at: input.initial_visit.starts_at,
          ends_at: input.initial_visit.ends_at,
          status: 'planned' as const,
          notes: null,
          created_by: userId,
          updated_by: userId,
          created_at: now,
          updated_at: now,
        }
      : null;
    const operation = registerOptimisticOperation({
      id: operationId,
      kind: 'schedule-project',
      lockKeys: [`project:${project.id}`],
      queryKeys: [`board:${weekStart}`, 'projects'],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.jobs.some(
            (job) =>
              job.quote_project_number_id === project.id
              && job.start_date === input.start_date
          ) === true,
        projects: (state) =>
          state.projectCandidates?.every(
            (candidate) => candidate.id !== project.id
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? optimisticVisit
            ? patchBoardWithVisit(
                patchBoardWithJob(state.board, optimisticJob),
                optimisticVisit
              )
            : patchBoardWithJob(state.board, optimisticJob)
          : state.board,
        projectCandidates: removeProjectCandidateFromQueue(
          state.projectCandidates,
          project.id
        ),
      }),
    });
    if (!operation) return;
    setSelectedQuote(null);
    if (optimisticVisit) activateVisit(optimisticJob, optimisticVisit);
    void createProjectScheduleJob(input)
      .then((result) => {
        const scheduledVisit = adoptAuthoritativeVisit({
          optimisticVisitId: optimisticVisit?.id,
          visit: result.visit,
          optimisticJobId: optimisticJob.id,
          job: result.job,
        });
        setBoardBaseData((current) => {
          const withJob = patchBoardWithJob(current, result.job, optimisticJob.id);
          return scheduledVisit
            ? patchBoardWithVisit(withJob, scheduledVisit, optimisticVisit?.id)
            : withJob;
        });
        queryClient.setQueryData(
          ['scheduling-project-candidates'],
          (current: ScheduleProjectCandidate[] | undefined) =>
            removeProjectCandidateFromQueue(current, project.id)
        );
        settleOptimisticOperation(operation.id, 'success', undefined, {
          proofs: {
            [`board:${weekStart}`]: (state) =>
              provesJob(result.job)(state)
              && (!scheduledVisit || provesVisit(scheduledVisit)(state)),
            projects: (state) =>
              state.projectCandidates?.every(
                (candidate) => candidate.id !== project.id
              ) === true,
          },
          apply: (state) => ({
            ...state,
            board: state.board
              ? scheduledVisit
                ? patchBoardWithVisit(
                    patchBoardWithJob(state.board, result.job),
                    scheduledVisit
                  )
                : patchBoardWithJob(state.board, result.job)
              : state.board,
            projectCandidates: removeProjectCandidateFromQueue(
              state.projectCandidates,
              project.id
            ),
          }),
        });
        setProjectPlacementDraft(null);
        if (scheduledVisit) {
          setActiveVisitTarget((current) =>
            current
            && (
              current.visit.id === optimisticVisit?.id
              || current.visit.id === scheduledVisit.id
            )
              ? { job: result.job, visit: scheduledVisit }
              : current
          );
        }
        toast.success(`${project.project_reference} scheduled`);
      })
      .catch((error) => {
        if (optimisticVisit) getMutationCoordinator().cancelWaiters(optimisticVisit.id);
        getMutationCoordinator().cancelWaiters(optimisticJob.id);
        settleOptimisticOperation(operation.id, 'failure', error);
        setProjectPlacement({
          project,
          date: input.start_date,
          initialVisit: input.initial_visit,
        });
        toast.error(error instanceof Error ? error.message : 'Unable to schedule Project.');
      });
  }

  function handleQuoteReschedule(input: ScheduleQuoteInput) {
    const job = schedulingQuoteJob;
    if (!job) return;
    if (isOptimisticEntityId(job.id)) {
      toast.info('Wait for this new job to finish saving.');
      return;
    }
    setQuoteScheduleDraft(input);
    const optimisticJob: ScheduleJob = {
      ...job,
      start_date: input.start_date,
      end_date: input.end_date,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    const operation = registerOptimisticOperation({
      kind: 'reschedule-quote',
      lockKeys: [`job:${job.id}`, `quote:${input.quote_id}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.jobs.some(
            (item) =>
              item.id === job.id
              && item.start_date === input.start_date
              && item.end_date === input.end_date
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardWithJob(state.board, optimisticJob)
          : state.board,
      }),
    });
    if (!operation) {
      setSchedulingQuoteJob(job);
      return;
    }
    void saveQuoteSchedule(input)
      .then((result) => {
        setBoardBaseData((current) => {
          const withJob = patchBoardWithJob(current, result.job);
          return result.visit ? patchBoardWithVisit(withJob, result.visit) : withJob;
        });
        settleOptimisticOperation(operation.id, 'success', undefined, {
          proofs: { [`board:${weekStart}`]: provesJob(result.job) },
          apply: (state) => ({
            ...state,
            board: state.board
              ? result.visit
                ? patchBoardWithVisit(
                    patchBoardWithJob(state.board, result.job),
                    result.visit
                  )
                : patchBoardWithJob(state.board, result.job)
              : state.board,
          }),
        });
        setQuoteScheduleDraft(null);
        toast.success('Quote schedule updated');
      })
      .catch((error) => {
        settleOptimisticOperation(operation.id, 'failure', error);
        setSchedulingQuoteJob(job);
        toast.error(error instanceof Error ? error.message : 'Unable to schedule Quote');
      });
  }

  function handleJobUpdate(input: ScheduleJobUpdateInput, job: ScheduleJob) {
    if (isOptimisticEntityId(job.id)) {
      toast.info('Wait for this new job to finish saving.');
      return;
    }
    if (input.tag_ids?.some(isOptimisticEntityId)) {
      toast.info('Wait for new tags to finish saving.');
      return;
    }
    setJobDraft(input);
    const { tag_ids: tagIds, ...jobFields } = input;
    const optimisticJob: ScheduleJob = {
      ...job,
      ...jobFields,
      ...(tagIds
        ? {
            tags: (board?.tags || []).filter((tag) => tagIds.includes(tag.id)),
          }
        : {}),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    const operation = registerOptimisticOperation({
      kind: 'update-job',
      lockKeys: [`job:${job.id}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.jobs.some((item) =>
            item.id === job.id
            && Object.entries(jobFields).every(
              ([key, value]) =>
                item[key as keyof ScheduleJob] === value
            )
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardWithJob(state.board, optimisticJob)
          : state.board,
      }),
    });
    if (!operation) {
      setEditingJob(job);
      setJobDialogOpen(true);
      return;
    }
    void saveScheduleJob(input, job.id)
      .then((authoritative) => {
        setBoardBaseData((current) => patchBoardWithJob(current, authoritative));
        settleOptimisticOperation(operation.id, 'success', undefined, {
          proofs: { [`board:${weekStart}`]: provesJob(authoritative) },
          apply: (state) => ({
            ...state,
            board: state.board
              ? patchBoardWithJob(state.board, authoritative)
              : state.board,
          }),
        });
        setJobDraft(null);
        toast.success(
          job.source_type === 'quote' ? 'Job metadata updated' : 'Job updated'
        );
      })
      .catch((error) => {
        settleOptimisticOperation(operation.id, 'failure', error);
        setEditingJob(job);
        setJobDialogOpen(true);
        toast.error(error instanceof Error ? error.message : 'Unable to save job');
      });
  }

  function handlePlantBlockSave(input: SavePlantUnavailabilityInput) {
    setPlantBlockDraft(input);
    const operationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const optimisticBlock: SchedulePlantUnavailability = {
      id: createOptimisticEntityId(operationId, 'plant-block'),
      plant_id: input.plant_id,
      start_date: input.start_date,
      end_date: input.end_date,
      reason: input.reason,
      notes: input.notes || null,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
      plant: board?.resources.plant.find((plant) => plant.id === input.plant_id) || null,
    };
    const operation = registerOptimisticOperation({
      id: operationId,
      kind: 'create-plant-block',
      lockKeys: [`plant-block-range:${input.plant_id}:${input.start_date}:${input.end_date}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.plant_unavailability.some(
            (block) =>
              block.plant_id === input.plant_id
              && block.start_date === input.start_date
              && block.end_date === input.end_date
              && block.reason === input.reason
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardWithPlantBlock(state.board, optimisticBlock)
          : state.board,
      }),
    });
    if (!operation) return;
    setUnavailabilityOpen(false);
    void savePlantUnavailability(input)
      .then((authoritative) => {
        setBoardBaseData((current) =>
          patchBoardWithPlantBlock(current, {
            ...authoritative,
            plant: optimisticBlock.plant,
          })
        );
        settleOptimisticOperation(operation.id, 'success', undefined, {
          proofs: { [`board:${weekStart}`]: provesPlantBlock(authoritative) },
          apply: (state) => ({
            ...state,
            board: state.board
              ? patchBoardWithPlantBlock(state.board, {
                  ...authoritative,
                  plant: optimisticBlock.plant,
                })
              : state.board,
          }),
        });
        setPlantBlockDraft(null);
        toast.success('Plant availability updated');
      })
      .catch((error) => {
        settleOptimisticOperation(operation.id, 'failure', error);
        setUnavailabilityOpen(true);
        toast.error(error instanceof Error ? error.message : 'Unable to save unavailability');
      });
  }

  function handlePlantBlockDelete(block: SchedulePlantUnavailability) {
    if (isOptimisticEntityId(block.id)) {
      toast.info('Wait for this availability change to finish saving.');
      return;
    }
    const operation = registerOptimisticOperation({
      kind: 'delete-plant-block',
      lockKeys: [`plant-block:${block.id}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: provesBoardEntityAbsent('plant-block', block.id),
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardRemovePlantBlock(state.board, block.id)
          : state.board,
      }),
    });
    if (!operation) return;
    void deletePlantUnavailability(block.id)
      .then(() => {
        setBoardBaseData((current) =>
          patchBoardRemovePlantBlock(current, block.id)
        );
        settleOptimisticOperation(operation.id, 'success', undefined, {
          proofs: {
            [`board:${weekStart}`]: provesBoardEntityAbsent('plant-block', block.id),
          },
          apply: (state) => ({
            ...state,
            board: state.board
              ? patchBoardRemovePlantBlock(state.board, block.id)
              : state.board,
          }),
        });
        toast.success('Unavailability removed');
      })
      .catch((error) => {
        settleOptimisticOperation(operation.id, 'failure', error);
        toast.error(error instanceof Error ? error.message : 'Unable to remove unavailability');
      });
  }

  async function prepareVisitReturn(
    target: ActiveVisitTarget,
    options: { skipConfirmation?: boolean } = {}
  ) {
    if (isOptimisticEntityId(target.job.id) || isOptimisticEntityId(target.visit.id)) {
      toast.info('Wait for this new visit to finish saving.');
      return;
    }
    clearStuckBoardInteraction('prepare-return', { resetDnd: true });
    const localAssignmentCount = (projectedState.board?.assignments || []).filter(
      (assignment) => assignment.visit_id === target.visit.id
    ).length;
    if (
      (projectedState.visitBacklog || []).some(
        (item) => item.visit_id === target.visit.id
      )
    ) {
      toast.info('This visit is already in the Jobs queue.');
      reconcileOptimisticKeysInBackground([`board:${weekStart}`, 'backlog']);
      return;
    }
    if (options.skipConfirmation) {
      void confirmVisitReturn({
        target,
        localAssignmentCount,
        preview: null,
        skipConfirmation: true,
      });
      return;
    }
    setPendingVisitReturn({
      target,
      localAssignmentCount,
      preview: null,
    });
    const previewRequest = previewScheduleVisitBacklog(target.visit.id);
    visitReturnPreviewPromisesRef.current.set(target.visit.id, previewRequest);
    try {
      const preview = await previewRequest;
      if (preview.already_queued) {
        toast.info('This visit is already in the Jobs queue.');
        setPendingVisitReturn(null);
        reconcileOptimisticKeysInBackground([`board:${weekStart}`, 'backlog']);
        return;
      }
      setPendingVisitReturn((current) =>
        current?.target.visit.id === target.visit.id
          ? { target, localAssignmentCount, preview }
          : current
      );
    } catch (error) {
      setPendingVisitReturn(null);
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to review this visit before returning it to Jobs'
      );
    } finally {
      if (visitReturnPreviewPromisesRef.current.get(target.visit.id) === previewRequest) {
        visitReturnPreviewPromisesRef.current.delete(target.visit.id);
      }
    }
  }

  async function confirmVisitReturn(
    pending: PendingVisitReturn | null = pendingVisitReturn
  ) {
    if (
      !pending
      || returningVisitIds.has(pending.target.visit.id)
    ) return;
    const { target, preview: preparedPreview } = pending;
    const queuedAt = new Date().toISOString();
    const requestId = crypto.randomUUID();
    const backlogItem: ScheduleVisitBacklogItem = {
      visit_id: target.visit.id,
      job_id: target.job.id,
      job_reference: target.job.job_reference,
      job_title: target.job.title,
      source_type: target.job.source_type,
      customer_name: target.job.customer_name || null,
      sequence_number: target.visit.sequence_number,
      title: target.visit.title,
      notes: target.visit.notes,
      original_starts_at: target.visit.starts_at,
      original_ends_at: target.visit.ends_at,
      duration_milliseconds:
        parseISO(target.visit.ends_at).getTime() - parseISO(target.visit.starts_at).getTime(),
      duration_minutes: Math.round(
        (parseISO(target.visit.ends_at).getTime() - parseISO(target.visit.starts_at).getTime())
        / 60_000
      ),
      queued_at: queuedAt,
    };
    const applyReturn = (
      state: SchedulingProjection,
      item: ScheduleVisitBacklogItem
    ): SchedulingProjection => {
      if (!state.board) {
        return {
          ...state,
          visitBacklog: upsertVisitBacklogItem(state.visitBacklog, item),
        };
      }
      const otherVisits = state.board.visits.filter(
        (visit) => visit.job_id === target.job.id && visit.id !== target.visit.id
      );
      return {
        ...state,
        board: otherVisits.length > 0
          ? patchBoardRemoveVisit(state.board, target.visit.id)
          : patchBoardRemoveJob(state.board, target.job.id),
        visitBacklog: upsertVisitBacklogItem(state.visitBacklog, item),
      };
    };
    const admitted = admitBoardCommand({
      kind: 'return-visit-to-backlog',
      requestId,
      claims: visitReturnPlaceClaims(target.job.id, target.visit.id),
      queryKeys: [`board:${weekStart}`, 'backlog'],
      proofs: {
        [`board:${weekStart}`]: provesBoardEntityAbsent('visit', target.visit.id),
        backlog: (state) =>
          state.visitBacklog?.some((item) => item.visit_id === target.visit.id) === true,
      },
      apply: (state) => applyReturn(state, backlogItem),
      persist: async () => {
        const liveRequestId =
          mutationCoordinatorRef.current?.getOperations().find((operation) =>
            operation.requestId === requestId
          )?.requestId ?? requestId;
        try {
          let preview = preparedPreview;
          if (!preview?.fingerprint) {
            preview = await (
              visitReturnPreviewPromisesRef.current.get(target.visit.id)
              ?? previewScheduleVisitBacklog(target.visit.id)
            );
          }
          if (preview.already_queued) {
            setBoardBaseData((current) => {
              const otherVisits = current.visits.filter(
                (visit) => visit.job_id === target.job.id && visit.id !== target.visit.id
              );
              return otherVisits.length > 0
                ? patchBoardRemoveVisit(current, target.visit.id)
                : patchBoardRemoveJob(current, target.job.id);
            });
            queryClient.setQueryData(
              ['scheduling-visit-backlog'],
              (current: ScheduleVisitBacklogItem[] | undefined) =>
                upsertVisitBacklogItem(current, backlogItem)
            );
            toast.info('This visit is already in the Jobs queue.');
            return {
              kind: 'success' as const,
              proofs: {
                [`board:${weekStart}`]: provesBoardEntityAbsent('visit', target.visit.id),
                backlog: (state: SchedulingProjection) =>
                  state.visitBacklog?.some((item) => item.visit_id === target.visit.id) === true,
              },
              apply: (state: SchedulingProjection) => applyReturn(state, backlogItem),
            };
          }
          const result = await enqueueScheduleVisit({
            request_id: liveRequestId,
            visit_id: target.visit.id,
            expected_fingerprint: preview.fingerprint,
          });
          const authoritativeBacklogItem = result.backlog_item || {
            ...backlogItem,
            queued_at: result.queued_at,
          };
          setBoardBaseData((current) => {
            const otherVisits = current.visits.filter(
              (visit) => visit.job_id === target.job.id && visit.id !== target.visit.id
            );
            return otherVisits.length > 0
              ? patchBoardRemoveVisit(current, target.visit.id)
              : patchBoardRemoveJob(current, target.job.id);
          });
          queryClient.setQueryData(
            ['scheduling-visit-backlog'],
            (current: ScheduleVisitBacklogItem[] | undefined) =>
              upsertVisitBacklogItem(current, authoritativeBacklogItem)
          );
          toast.success(
            `${target.job.job_reference} · Visit ${target.visit.sequence_number} returned to Jobs`
          );
          return {
            kind: 'success' as const,
            proofs: {
              [`board:${weekStart}`]: provesBoardEntityAbsent('visit', target.visit.id),
              backlog: (state: SchedulingProjection) =>
                state.visitBacklog?.some(
                  (item) =>
                    item.visit_id === target.visit.id
                    && item.queued_at === authoritativeBacklogItem.queued_at
                ) === true,
            },
            apply: (state: SchedulingProjection) => applyReturn(state, authoritativeBacklogItem),
          };
        } catch (error) {
          if (
            error instanceof SchedulingApiError
            && error.payload.code === 'stale_visit_preview'
            && !pending.skipConfirmation
          ) {
            setPendingVisitReturn({
              target,
              localAssignmentCount: pending.localAssignmentCount,
              preview: null,
            });
            void prepareVisitReturn(target);
          }
          if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
            toast.error(error instanceof Error ? error.message : 'Unable to return this visit to Jobs');
            return { kind: 'failed' as const, error };
          }
          throw error;
        } finally {
          setReturningVisitIds((current) => {
            const next = new Set(current);
            next.delete(target.visit.id);
            return next;
          });
        }
      },
    });
    if (admitted.duplicate) return;
    setReturningVisitIds((current) => {
      const next = new Set(current);
      next.add(target.visit.id);
      return next;
    });
    setPendingVisitReturn(null);
    setActiveVisitTarget((current) =>
      current?.visit.id === target.visit.id ? null : current
    );
    setVisitTarget((current) =>
      current?.visit?.id === target.visit.id ? null : current
    );
    setSelectedResource(null);
    setSelectedQuote(null);
    setSidebarTab('jobs');
    setQuoteStage('all');
  }

  function setBoardBaseData(
    updater: (current: SchedulingBoardPayload) => SchedulingBoardPayload
  ) {
    queryClient.setQueryData<SchedulingBoardPayload>(
      ['scheduling-board', weekStart],
      (current) => current ? updater(current) : current
    );
  }

  function provesJob(expected: ScheduleJob) {
    return (state: SchedulingProjection) =>
      state.board?.jobs.some(
        (job) => job.id === expected.id && job.updated_at === expected.updated_at
      ) === true;
  }

  function provesVisit(expected: ScheduleVisit) {
    return (state: SchedulingProjection) =>
      state.board?.visits.some(
        (visit) =>
          visit.id === expected.id
          && visit.updated_at === expected.updated_at
          && visit.starts_at === expected.starts_at
          && visit.ends_at === expected.ends_at
      ) === true;
  }

  function provesPlantBlock(expected: SchedulePlantUnavailability) {
    return (state: SchedulingProjection) =>
      state.board?.plant_unavailability.some(
        (block) => block.id === expected.id && block.updated_at === expected.updated_at
      ) === true;
  }

  function provesBoardEntityAbsent(
    kind: 'job' | 'visit' | 'assignment' | 'plant-block',
    id: string
  ) {
    return (state: SchedulingProjection) => {
      if (!state.board) return false;
      if (kind === 'job') return state.board.jobs.every((job) => job.id !== id);
      if (kind === 'visit') return state.board.visits.every((visit) => visit.id !== id);
      if (kind === 'assignment') {
        return state.board.assignments.every((assignment) => assignment.id !== id);
      }
      return state.board.plant_unavailability.every((block) => block.id !== id);
    };
  }

  function handleVisitSave(
    input: SaveScheduleVisitInput,
    existingVisit: ScheduleVisit | null
  ) {
    if (!existingVisit && isOptimisticEntityId(input.job_id)) {
      toast.info('Wait for this new schedule item to finish saving.');
      return;
    }
    const operationId = crypto.randomUUID();
    setVisitDraft(input);
    const now = new Date().toISOString();
    const job = board?.jobs.find((item) => item.id === input.job_id)
      || (existingVisit
        ? board?.jobs.find((item) => item.id === existingVisit.job_id)
        : undefined);
    if (!job && !existingVisit) return;
    const targetJob = job || existingVisit && board?.jobs.find((item) => item.id === existingVisit.job_id);
    if (!targetJob) return;
    const optimisticVisit: ScheduleVisit = existingVisit
      ? { ...existingVisit, ...input, updated_by: userId, updated_at: now }
      : {
          id: createOptimisticEntityId(operationId, 'visit'),
          job_id: input.job_id,
          sequence_number:
            Math.max(
              0,
              ...(board?.visits
                .filter((visit) => visit.job_id === input.job_id)
                .map((visit) => visit.sequence_number) || [])
            ) + 1,
          title: input.title || null,
          starts_at: input.starts_at,
          ends_at: input.ends_at,
          status: input.status || 'planned',
          notes: input.notes || null,
          created_by: userId,
          updated_by: userId,
          created_at: now,
          updated_at: now,
        };
    const coordinator = getMutationCoordinator();
    const resolvedVisitId = coordinator.resolveIdentity(optimisticVisit.id);
    const resolvedJobId = coordinator.resolveIdentity(optimisticVisit.job_id);
    const producer = findActiveVisitProducer(optimisticVisit.id);
    const admitted = admitBoardCommand({
      id: operationId,
      kind: existingVisit ? 'update-visit' : 'create-visit',
      retryPolicy: existingVisit ? 'ambiguous' : 'none',
      coalesceGroup: existingVisit ? visitTimesCoalesceGroup(resolvedVisitId) : undefined,
      dependsOn: producer ? [producer.id] : undefined,
      identityWaitKeys: existingVisit
        ? visitIdentityWaitKeys(optimisticVisit.id, optimisticVisit.job_id)
        : visitIdentityWaitKeys(optimisticVisit.job_id),
      claims: existingVisit
        ? visitTimesClaims(resolvedJobId, resolvedVisitId)
        : visitCreateClaims(resolvedJobId, optimisticVisit.id),
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.visits.some(
            (visit) =>
              visit.job_id === resolvedJobId
              && (!existingVisit || visit.id === resolvedVisitId)
              && visit.starts_at === input.starts_at
              && visit.ends_at === input.ends_at
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardWithVisit(
              state.board,
              {
                ...optimisticVisit,
                id: coordinator.resolveIdentity(optimisticVisit.id),
                job_id: coordinator.resolveIdentity(optimisticVisit.job_id),
              },
              optimisticVisit.id
            )
          : state.board,
      }),
      persist: async () => {
        try {
          const visitId = existingVisit
            ? coordinator.resolveIdentity(optimisticVisit.id)
            : undefined;
          const jobId = coordinator.resolveIdentity(optimisticVisit.job_id);
          const authoritative = await saveScheduleVisit(
            { ...input, job_id: jobId },
            visitId
          );
          const savedVisit = adoptAuthoritativeVisit({
            optimisticVisitId: existingVisit ? undefined : optimisticVisit.id,
            visit: authoritative,
            optimisticJobId: isOptimisticEntityId(optimisticVisit.job_id)
              ? optimisticVisit.job_id
              : undefined,
          }) || authoritative;
          setBoardBaseData((current) =>
            patchBoardWithVisit(current, savedVisit, existingVisit ? undefined : optimisticVisit.id)
          );
          setVisitDraft(null);
          toast.success(existingVisit ? 'Visit updated' : 'Visit added');
          return {
            kind: 'success' as const,
            identityAliases: existingVisit
              ? undefined
              : { [optimisticVisit.id]: savedVisit.id },
            proofs: { [`board:${weekStart}`]: provesVisit(savedVisit) },
            apply: (state: SchedulingProjection) => ({
              ...state,
              board: state.board
                ? patchBoardWithVisit(state.board, savedVisit, optimisticVisit.id)
                : state.board,
            }),
          };
        } catch (error) {
          setVisitTarget({
            job: targetJob,
            visit: existingVisit,
            date: getScheduleVisitDate(input.starts_at),
          });
          if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
            toast.error(error instanceof Error ? error.message : 'Unable to save visit');
            return toPersistOutcome(error);
          }
          throw error;
        }
      },
    });
    if (admitted.duplicate || admitted.coalesced) return;
  }

  function handleVisitDelete(visit: ScheduleVisit) {
    if (isOptimisticEntityId(visit.id) || isOptimisticEntityId(visit.job_id)) {
      toast.info('Wait for this new visit to finish saving.');
      return;
    }
    const job = board?.jobs.find((item) => item.id === visit.job_id);
    if (!job) return;
    const operation = registerOptimisticOperation({
      kind: 'delete-visit',
      lockKeys: [`job-tree:${visit.job_id}`, `visit-tree:${visit.id}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: provesBoardEntityAbsent('visit', visit.id),
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardRemoveVisit(state.board, visit.id)
          : state.board,
      }),
    });
    if (!operation) return;
    void deleteScheduleVisit(visit.id)
      .then(() => {
        setBoardBaseData((current) => patchBoardRemoveVisit(current, visit.id));
        settleOptimisticOperation(operation.id, 'success', undefined, {
          proofs: {
            [`board:${weekStart}`]: provesBoardEntityAbsent('visit', visit.id),
          },
          apply: (state) => ({
            ...state,
            board: state.board
              ? patchBoardRemoveVisit(state.board, visit.id)
              : state.board,
          }),
        });
        toast.success('Visit deleted');
      })
      .catch((error) => {
        settleOptimisticOperation(operation.id, 'failure', error);
        setVisitTarget({
          job,
          visit,
          date: getScheduleVisitDate(visit.starts_at),
        });
        toast.error(error instanceof Error ? error.message : 'Unable to delete visit');
      });
  }

  async function resizeVisit(
    visit: ScheduleVisit,
    startsAt: string,
    endsAt: string
  ) {
    const coordinator = getMutationCoordinator();
    const resolvedVisitId = coordinator.resolveIdentity(visit.id);
    const resolvedJobId = coordinator.resolveIdentity(visit.job_id);
    const resizedVisit = {
      ...visit,
      id: resolvedVisitId,
      job_id: resolvedJobId,
      starts_at: startsAt,
      ends_at: endsAt,
    };
    const producer = findActiveVisitProducer(visit.id);
    const admitted = admitBoardCommand({
      kind: 'resize-visit',
      coalesceGroup: visitTimesCoalesceGroup(resolvedVisitId),
      dependsOn: producer ? [producer.id] : undefined,
      identityWaitKeys: visitIdentityWaitKeys(visit.id, visit.job_id),
      claims: visitTimesClaims(resolvedJobId, resolvedVisitId),
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.visits.some(
            (item) =>
              (item.id === resolvedVisitId || item.id === visit.id)
              && item.starts_at === startsAt
              && item.ends_at === endsAt
          ) === true,
      },
      apply: (state) => {
        const liveVisitId = coordinator.resolveIdentity(visit.id);
        const liveJobId = coordinator.resolveIdentity(visit.job_id);
        const nextVisit = {
          ...resizedVisit,
          id: liveVisitId,
          job_id: liveJobId,
        };
        return {
          ...state,
          board: state.board
            ? patchBoardWithVisit(state.board, nextVisit, visit.id)
            : state.board,
        };
      },
      persist: async () => {
        const visitId = coordinator.resolveIdentity(visit.id);
        const jobId = coordinator.resolveIdentity(visit.job_id);
        try {
          const authoritative = await saveScheduleVisit({
            job_id: jobId,
            title: visit.title,
            starts_at: startsAt,
            ends_at: endsAt,
            status: visit.status,
            notes: visit.notes,
          }, visitId);
          setBoardBaseData((current) => patchBoardWithVisit(current, authoritative, visit.id));
          toast.success('Visit times updated');
          return {
            kind: 'success' as const,
            proofs: { [`board:${weekStart}`]: provesVisit(authoritative) },
            apply: (state: SchedulingProjection) => ({
              ...state,
              board: state.board
                ? patchBoardWithVisit(state.board, authoritative, visit.id)
                : state.board,
            }),
          };
        } catch (error) {
          const queued =
            error instanceof SchedulingApiError
            && (
              error.payload.code === 'visit_queued'
              || error.payload.code === 'visit_already_queued'
            );
          if (queued) {
            return { kind: 'failed' as const, error };
          }
          if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
            toast.error(error instanceof Error ? error.message : 'Unable to resize this visit');
            return toPersistOutcome(error);
          }
          throw error;
        }
      },
    });
    if (admitted.duplicate) return;
    setActiveVisitTarget((current) =>
      current?.visit.id === visit.id || current?.visit.id === resolvedVisitId
        ? { ...current, visit: { ...current.visit, ...resizedVisit } }
        : current
    );
  }

  function createOptimisticAssignment(
    target: ActiveVisitTarget,
    resource: SelectedScheduleResource,
    operationId: string
  ): ScheduleAssignment {
    const now = new Date().toISOString();
    const base = {
      id: createOptimisticEntityId(operationId, 'assignment'),
      job_id: target.job.id,
      work_date: getScheduleVisitDate(target.visit.starts_at),
      visit_id: target.visit.id,
      notes: null,
      conflict_override: false,
      conflict_codes: [],
      conflict_override_by: null,
      conflict_override_at: null,
      assigned_by: userId,
      created_at: now,
      updated_at: now,
      conflicts: [],
      visit: target.visit,
    };

    if (resource.type === 'employee') {
      return {
        ...base,
        resource_type: 'employee',
        profile_id: resource.id,
        employee:
          board?.resources.employees.find((employee) => employee.id === resource.id) || null,
      };
    }

    return {
      ...base,
      resource_type: 'plant',
      plant_id: resource.id,
      plant: board?.resources.plant.find((plant) => plant.id === resource.id) || null,
    };
  }

  async function assignResource(
    target: ActiveVisitTarget,
    resource: SelectedScheduleResource
  ) {
    if (
      isOptimisticEntityId(target.job.id)
      || isOptimisticEntityId(target.visit.id)
    ) {
      toast.info('Wait for this new visit to finish saving before assigning resources.');
      return;
    }
    const input: CreateAssignmentInput = {
      job_id: target.job.id,
      visit_id: target.visit.id,
      resource_type: resource.type,
      resource_id: resource.id,
    };
    const operationId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const optimisticAssignment = createOptimisticAssignment(
      target,
      resource,
      operationId
    );
    const admitted = admitBoardCommand({
      id: operationId,
      kind: 'create-assignment',
      requestId,
      duplicateKey: assignmentDuplicateKey(resource.type, resource.id, target.visit.id),
      claims: assignmentCreateClaims({
        resourceType: resource.type,
        resourceId: resource.id,
        workDate: getScheduleVisitDate(target.visit.starts_at),
        jobId: target.job.id,
        visitId: target.visit.id,
      }),
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.assignments.some(
            (assignment) =>
              assignment.visit_id === target.visit.id
              && (
                resource.type === 'employee'
                  ? 'profile_id' in assignment && assignment.profile_id === resource.id
                  : 'plant_id' in assignment && assignment.plant_id === resource.id
              )
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardWithAssignment(state.board, optimisticAssignment)
          : state.board,
      }),
      persist: async () => {
        const liveRequestId =
          mutationCoordinatorRef.current?.getOperations().find((op) => op.id === operationId)
            ?.requestId ?? requestId;
        try {
          const result = await createScheduleAssignment({
            ...input,
            request_id: liveRequestId,
          });
          const createdRow = result.assignments?.[0];
          if (createdRow) {
            const authoritative = assignmentFromMutationRow(
              createdRow,
              resource,
              target.visit
            );
            setBoardBaseData((current) =>
              applyCapacity(
                patchBoardWithAssignment(current, authoritative),
                result.employee_capacity
              )
            );
          }
          toast.success(`${resource.label} assigned`);
          return { kind: 'success' };
        } catch (error) {
          if (error instanceof SchedulingApiError && error.status === 409 && error.payload.conflicts_by_date) {
            setPendingConflict({
              input: { ...input, request_id: liveRequestId },
              conflicts: flattenConflictMessages(error.payload),
            });
            toast.error(error instanceof Error ? error.message : 'Assignment conflict');
            return { kind: 'conflict' };
          }
          if (error instanceof SchedulingApiError && error.status === 400) {
            toast.error(error.message);
            return { kind: 'failed', error };
          }
          throw error;
        }
      },
    });
    if (admitted.duplicate) return;
    setSelectedResource(null);
    activateVisit(target.job, target.visit);
  }

  async function addEmployeeToDayTeam(
    workDate: string,
    slotIndex: ScheduleDayTeamSlotIndex,
    resource: SelectedScheduleResource
  ) {
    if (resource.type !== 'employee') {
      toast.info('Day teams only accept employees.');
      return;
    }
    const employee = board?.resources.employees.find((item) => item.id === resource.id);
    if (!employee) {
      toast.error('That employee is no longer available.');
      return;
    }
    const mutationKey = `day-team:${workDate}`;
    const mutationEpoch = beginMutation(mutationKey);
    if (mutationEpoch == null) return;
    const member = {
      work_date: workDate,
      slot_index: slotIndex,
      profile_id: resource.id,
      employee,
      added_by: userId,
      created_at: new Date().toISOString(),
    };
    const operation = registerOptimisticOperation({
      kind: 'day-team-add',
      lockKeys: [`day-team:${workDate}`, `day-team-profile:${workDate}:${resource.id}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.day_teams.some((entry) =>
            entry.date === workDate
            && entry.slots.some(
              (slot) =>
                slot.slot_index === slotIndex
                && slot.members.some((item) => item.profile_id === resource.id)
            )
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardWithDayTeamMember(state.board, member)
          : state.board,
      }),
    });
    if (!operation) {
      endMutation(mutationKey);
      return;
    }
    try {
      const result = await addScheduleDayTeamMember({
        work_date: workDate,
        slot_index: slotIndex,
        profile_id: resource.id,
      });
      if (!isCurrentMutation(mutationKey, mutationEpoch)) return;
      const createdAt = typeof result.member?.created_at === 'string'
        ? result.member.created_at
        : member.created_at;
      const addedBy = typeof result.member?.added_by === 'string'
        ? result.member.added_by
        : member.added_by;
      settleOptimisticOperation(operation.id, 'success', undefined, {
        proofs: {
          [`board:${weekStart}`]: (state) =>
            state.board?.day_teams.some((entry) =>
              entry.date === workDate
              && entry.slots.some(
                (slot) =>
                  slot.slot_index === slotIndex
                  && slot.members.some((item) => item.profile_id === resource.id)
              )
            ) === true,
        },
        apply: (state) => ({
          ...state,
          board: state.board
            ? patchBoardWithDayTeamMember(state.board, {
                ...member,
                added_by: addedBy,
                created_at: createdAt,
              })
            : state.board,
        }),
      });
    } catch (error) {
      settleOptimisticOperation(operation.id, 'failure', error);
      toast.error(error instanceof Error ? error.message : 'Unable to update this team');
    } finally {
      endMutation(mutationKey);
    }
  }

  async function removeEmployeeFromDayTeam(
    slotIndex: ScheduleDayTeamSlotIndex,
    profileId: string
  ) {
    const workDate = selectedDate;
    const mutationKey = `day-team:${workDate}`;
    const mutationEpoch = beginMutation(mutationKey);
    if (mutationEpoch == null) return;
    const operation = registerOptimisticOperation({
      kind: 'day-team-remove',
      lockKeys: [`day-team:${workDate}`, `day-team-profile:${workDate}:${profileId}`],
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.day_teams.some((entry) =>
            entry.date === workDate
            && entry.slots.some(
              (slot) =>
                slot.slot_index === slotIndex
                && slot.members.some((item) => item.profile_id === profileId)
            )
          ) !== true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardRemoveDayTeamMember(state.board, workDate, slotIndex, profileId)
          : state.board,
      }),
    });
    if (!operation) {
      endMutation(mutationKey);
      return;
    }
    try {
      await removeScheduleDayTeamMember({
        work_date: workDate,
        slot_index: slotIndex,
        profile_id: profileId,
      });
      if (!isCurrentMutation(mutationKey, mutationEpoch)) return;
      settleOptimisticOperation(operation.id);
    } catch (error) {
      settleOptimisticOperation(operation.id, 'failure', error);
      toast.error(error instanceof Error ? error.message : 'Unable to update this team');
    } finally {
      endMutation(mutationKey);
    }
  }

  async function assignDayTeamToBoardVisit(
    target: ActiveVisitTarget,
    slotIndex: ScheduleDayTeamSlotIndex
  ) {
    if (
      isOptimisticEntityId(target.job.id)
      || isOptimisticEntityId(target.visit.id)
    ) {
      toast.info('Wait for this new visit to finish saving before assigning a team.');
      return;
    }
    const members = slotsForScheduleDate(board?.day_teams, selectedDate)
      .find((slot) => slot.slot_index === slotIndex)
      ?.members || [];
    if (members.length === 0) {
      toast.info('Add employees to this team first.');
      return;
    }
    const memberIds = members.map((member) => member.profile_id);
    const memberRequestIds = Object.fromEntries(
      memberIds.map((profileId) => [profileId, crypto.randomUUID()])
    );
    const operationId = crypto.randomUUID();
    const optimisticAssignments = members
      .filter((member) =>
        !board?.assignments.some(
          (assignment) =>
            assignment.visit_id === target.visit.id
            && 'profile_id' in assignment
            && assignment.profile_id === member.profile_id
        )
      )
      .map((member) =>
        createOptimisticAssignment(
          target,
          { type: 'employee', id: member.profile_id, label: member.employee?.full_name || 'Employee' },
          `${operationId}:${member.profile_id}`
        )
      );
    function reportDayTeamResult(result: Awaited<ReturnType<typeof assignScheduleDayTeam>>) {
      const skipSummary = result.skipped
        .map((item) => `${item.full_name} (${item.conflicts[0]?.message || item.reason})`)
        .join('; ');
      if (result.partial) {
        toast.error(result.error || 'Some team members were assigned before this request failed.');
      } else if (result.assignments.length > 0 && result.skipped.length > 0) {
        toast.success(`Assigned ${result.assignments.length}. Skipped: ${skipSummary}`);
      } else if (result.assignments.length > 0) {
        toast.success(
          result.assignments.length === 1
            ? 'Team member assigned'
            : `${result.assignments.length} team members assigned`
        );
      } else if (result.skipped.length > 0) {
        toast.info(`Nobody was assigned. ${skipSummary}`);
      } else if (result.already_assigned_count > 0) {
        toast.info('Those employees are already on this visit.');
      } else {
        toast.info('Add employees to this team first.');
      }
    }
    admitBoardCommand({
      id: operationId,
      kind: 'assign-day-team',
      claims: dayTeamAssignClaims({
        workDate: getScheduleVisitDate(target.visit.starts_at),
        jobId: target.job.id,
        visitId: target.visit.id,
        memberIds,
      }),
      queryKeys: [`board:${weekStart}`],
      apply: (state) => ({
        ...state,
        board: state.board
          ? optimisticAssignments.reduce(
              (next, assignment) => patchBoardWithAssignment(next, assignment),
              state.board
            )
          : state.board,
      }),
      persist: async () => {
        try {
          const result = await assignScheduleDayTeam({
            visit_id: target.visit.id,
            slot_index: slotIndex,
            member_ids: memberIds,
            member_request_ids: memberRequestIds,
          });
          if (result.assignments.length > 0) {
            setBoardBaseData((current) => {
              let next = applyCapacity(current, result.employee_capacity);
              for (const row of result.assignments) {
                next = patchBoardWithAssignment(
                  next,
                  assignmentFromMutationRow(row, null, target.visit)
                );
              }
              return next;
            });
          } else if (result.employee_capacity) {
            setBoardBaseData((current) => applyCapacity(current, result.employee_capacity));
          }
          reportDayTeamResult(result);
          const createdProfileIds = new Set(
            result.assignments
              .map((row) => ('profile_id' in row ? row.profile_id : null))
              .filter((id): id is string => Boolean(id))
          );
          return {
            kind: 'success',
            apply: (state) => ({
              ...state,
              board: state.board
                ? result.assignments.reduce(
                    (next, row) =>
                      patchBoardWithAssignment(
                        next,
                        assignmentFromMutationRow(row, null, target.visit)
                      ),
                    state.board
                  )
                : state.board,
            }),
            proofs: {
              [`board:${weekStart}`]: (state) =>
                createdProfileIds.size === 0
                || [...createdProfileIds].every((profileId) =>
                  state.board?.assignments.some(
                    (assignment) =>
                      assignment.visit_id === target.visit.id
                      && 'profile_id' in assignment
                      && assignment.profile_id === profileId
                  ) === true
                ),
            },
          };
        } catch (error) {
          if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
            toast.error(error instanceof Error ? error.message : 'Unable to assign this team');
            return { kind: 'failed', error };
          }
          throw error;
        }
      },
    });
  }

  async function moveAssignmentToVisit(
    assignment: ScheduleAssignment,
    target: ActiveVisitTarget
  ) {
    if (
      isOptimisticEntityId(assignment.id)
      || isOptimisticEntityId(target.visit.id)
    ) {
      toast.info('Wait for pending schedule changes to finish saving.');
      return;
    }
    if (assignment.visit_id === target.visit.id) return;
    const operationId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const resourceId =
      assignment.resource_type === 'employee'
        ? assignment.profile_id
        : assignment.plant_id;
    const admitted = admitBoardCommand({
      id: operationId,
      kind: 'move-assignment',
      requestId,
      coalesceGroup: assignmentMoveCoalesceGroup(assignment.id),
      claims: assignmentMoveClaims({
        assignmentId: assignment.id,
        resourceType: assignment.resource_type,
        resourceId,
        sourceWorkDate: assignment.work_date,
        targetWorkDate: getScheduleVisitDate(target.visit.starts_at),
        sourceJobId: assignment.job_id,
        targetJobId: target.job.id,
        sourceVisitId: assignment.visit_id,
        targetVisitId: target.visit.id,
      }),
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.assignments.some(
            (item) =>
              item.id === assignment.id
              && item.visit_id === target.visit.id
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardMoveAssignment(state.board, assignment.id, (item) => ({
              ...item,
              job_id: target.job.id,
              work_date: getScheduleVisitDate(target.visit.starts_at),
              visit_id: target.visit.id,
              visit: target.visit,
            }))
          : state.board,
      }),
      persist: async () => {
        const live = findCoordinatorPersistTarget(
          mutationCoordinatorRef.current?.getOperations() || [],
          operationId,
          assignmentMoveCoalesceGroup(assignment.id)
        );
        const liveRequestId = live?.requestId ?? requestId;
        try {
          const result = await moveScheduleAssignment(
            assignment,
            target.visit.id,
            false,
            liveRequestId
          );
          if (result.assignment) {
            const authoritative = assignmentFromMutationRow(
              result.assignment,
              null,
              target.visit
            );
            setBoardBaseData((current) =>
              applyCapacity(
                patchBoardWithAssignment(current, authoritative),
                result.employee_capacity
              )
            );
          } else if (result.employee_capacity) {
            setBoardBaseData((current) => applyCapacity(current, result.employee_capacity));
          }
          toast.success('Assignment moved');
          return { kind: 'success' };
        } catch (error) {
          if (error instanceof SchedulingApiError && error.status === 409 && error.payload.conflicts_by_date) {
            setPendingConflict({
              assignment,
              input: {
                job_id: target.job.id,
                visit_id: target.visit.id,
                resource_type: assignment.resource_type,
                resource_id: resourceId,
              },
              conflicts: flattenConflictMessages(error.payload),
            });
            toast.error(error instanceof Error ? error.message : 'Assignment conflict');
            return { kind: 'conflict' };
          }
          if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
            toast.error(error instanceof Error ? error.message : 'Unable to move assignment');
            return { kind: 'failed', error };
          }
          throw error;
        }
      },
    });
    if (admitted.duplicate) return;
    activateVisit(target.job, target.visit);
  }

  async function overridePendingConflict() {
    if (!pendingConflict) return;
    const conflict = pendingConflict;
    const targetVisit = conflict.input.visit_id
      ? board?.visits.find((visit) => visit.id === conflict.input.visit_id) || null
      : null;
    const targetJob = conflict.input.job_id
      ? board?.jobs.find((job) => job.id === conflict.input.job_id) || null
      : null;
    if (!targetVisit) return;
    const operationId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const overrideResource: SelectedScheduleResource = {
      type: conflict.input.resource_type,
      id: conflict.input.resource_id,
      label: conflict.input.resource_type,
    };
    const optimisticOverride = conflict.assignment
      ? null
      : createOptimisticAssignment(targetJob
        ? { job: targetJob, visit: targetVisit }
        : { job: { id: conflict.input.job_id } as ScheduleJob, visit: targetVisit },
      overrideResource,
      operationId);
    admitBoardCommand({
      id: operationId,
      kind: 'override-assignment-conflict',
      requestId,
      claims: conflict.assignment
        ? assignmentMoveClaims({
            assignmentId: conflict.assignment.id,
            resourceType: conflict.assignment.resource_type,
            resourceId: conflict.input.resource_id,
            sourceWorkDate: conflict.assignment.work_date,
            targetWorkDate: getScheduleVisitDate(targetVisit.starts_at),
            sourceJobId: conflict.assignment.job_id,
            targetJobId: conflict.input.job_id,
            sourceVisitId: conflict.assignment.visit_id,
            targetVisitId: targetVisit.id,
          })
        : assignmentCreateClaims({
            resourceType: conflict.input.resource_type,
            resourceId: conflict.input.resource_id,
            workDate: getScheduleVisitDate(targetVisit.starts_at),
            jobId: conflict.input.job_id,
            visitId: targetVisit.id,
          }),
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: (state) =>
          state.board?.assignments.some(
            (assignment) =>
              (conflict.assignment
                ? assignment.id === conflict.assignment.id
                  && assignment.visit_id === targetVisit.id
                : assignment.visit_id === targetVisit.id
                  && (
                    conflict.input.resource_type === 'employee'
                      ? 'profile_id' in assignment
                        && assignment.profile_id === conflict.input.resource_id
                      : 'plant_id' in assignment
                        && assignment.plant_id === conflict.input.resource_id
                  ))
              && assignment.conflict_override
          ) === true,
      },
      apply: (state) => ({
        ...state,
        board: !state.board
          ? state.board
          : conflict.assignment
            ? patchBoardMoveAssignment(
                state.board,
                conflict.assignment.id,
                (item) => ({
                  ...item,
                  job_id: conflict.input.job_id,
                  visit_id: targetVisit.id,
                  work_date: getScheduleVisitDate(targetVisit.starts_at),
                  visit: targetVisit,
                  conflict_override: true,
                })
              )
            : optimisticOverride
              ? patchBoardWithAssignment(state.board, {
                  ...optimisticOverride,
                  conflict_override: true,
                })
              : state.board,
      }),
      persist: async () => {
        try {
          let result: AssignmentMutationResult;
          if (conflict.assignment && conflict.input.visit_id) {
            result = await moveScheduleAssignment(
              conflict.assignment,
              conflict.input.visit_id,
              true,
              requestId
            );
            if (result.assignment) {
              const authoritative = assignmentFromMutationRow(
                result.assignment,
                null,
                targetVisit
              );
              setBoardBaseData((current) =>
                applyCapacity(
                  patchBoardWithAssignment(current, authoritative),
                  result.employee_capacity
                )
              );
            } else if (result.employee_capacity) {
              setBoardBaseData((current) => applyCapacity(current, result.employee_capacity));
            }
            if (targetJob) activateVisit(targetJob, targetVisit);
            toast.success('Assignment moved with conflict override');
          } else {
            result = await createScheduleAssignment({
              ...conflict.input,
              override_conflicts: true,
              request_id: requestId,
            });
            const createdRow = result.assignments?.[0];
            if (createdRow) {
              const authoritative = assignmentFromMutationRow(
                createdRow,
                overrideResource,
                targetVisit
              );
              setBoardBaseData((current) =>
                applyCapacity(
                  patchBoardWithAssignment(current, authoritative),
                  result.employee_capacity
                )
              );
            } else if (result.employee_capacity) {
              setBoardBaseData((current) => applyCapacity(current, result.employee_capacity));
            }
            if (targetJob) activateVisit(targetJob, targetVisit);
            toast.success('Resource assigned with conflict override');
          }
          setPendingConflict(null);
          setSelectedResource(null);
          return { kind: 'success' };
        } catch (error) {
          if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
            toast.error(error instanceof Error ? error.message : 'Unable to override conflict');
            return { kind: 'failed', error };
          }
          throw error;
        }
      },
    });
  }

  async function handleDeleteAssignment(assignment: ScheduleAssignment) {
    if (isOptimisticEntityId(assignment.id) || isOptimisticEntityId(assignment.job_id)) {
      toast.info('Wait for this assignment to finish saving.');
      return;
    }
    const operationId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const resourceId =
      assignment.resource_type === 'employee'
        ? assignment.profile_id
        : assignment.plant_id;
    admitBoardCommand({
      id: operationId,
      kind: 'delete-assignment',
      requestId,
      claims: assignmentDeleteClaims({
        assignmentId: assignment.id,
        resourceType: assignment.resource_type,
        resourceId,
        workDate: assignment.work_date,
        jobId: assignment.job_id,
        visitId: assignment.visit_id,
      }),
      queryKeys: [`board:${weekStart}`],
      proofs: {
        [`board:${weekStart}`]: provesBoardEntityAbsent('assignment', assignment.id),
      },
      apply: (state) => ({
        ...state,
        board: state.board
          ? patchBoardRemoveAssignment(state.board, assignment.id)
          : state.board,
      }),
      persist: async () => {
        try {
          const result = await deleteScheduleAssignment(
            assignment.id,
            assignment.resource_type,
            requestId
          );
          if (result.employee_capacity) {
            setBoardBaseData((current) =>
              applyCapacity(
                patchBoardRemoveAssignment(current, assignment.id),
                result.employee_capacity
              )
            );
          } else {
            setBoardBaseData((current) =>
              patchBoardRemoveAssignment(current, assignment.id)
            );
          }
          toast.success('Assignment removed', {
            action: {
              label: 'Undo',
              onClick: () => {
                const restoreOperationId = crypto.randomUUID();
                const restoreRequestId = crypto.randomUUID();
                const optimisticRestore: ScheduleAssignment = {
                  ...assignment,
                  id: createOptimisticEntityId(restoreOperationId, 'assignment'),
                };
                admitBoardCommand({
                  id: restoreOperationId,
                  kind: 'restore-assignment',
                  requestId: restoreRequestId,
                  claims: assignmentCreateClaims({
                    resourceType: assignment.resource_type,
                    resourceId,
                    workDate: assignment.work_date,
                    jobId: assignment.job_id,
                    visitId: assignment.visit_id,
                  }),
                  queryKeys: [`board:${weekStart}`],
                  proofs: {
                    [`board:${weekStart}`]: (state) =>
                      state.board?.assignments.some(
                        (item) =>
                          item.job_id === assignment.job_id
                          && item.visit_id === assignment.visit_id
                          && (
                            assignment.resource_type === 'employee'
                              ? 'profile_id' in item
                                && 'profile_id' in assignment
                                && item.profile_id === assignment.profile_id
                              : 'plant_id' in item
                                && 'plant_id' in assignment
                                && item.plant_id === assignment.plant_id
                          )
                      ) === true,
                  },
                  apply: (state) => ({
                    ...state,
                    board: state.board
                      ? patchBoardWithAssignment(state.board, optimisticRestore)
                      : state.board,
                  }),
                  persist: async () => {
                    try {
                      const restoreResult = await createScheduleAssignment({
                        job_id: assignment.job_id,
                        visit_id: assignment.visit_id || undefined,
                        resource_type: assignment.resource_type,
                        resource_id: resourceId,
                        work_dates: assignment.visit_id ? undefined : [assignment.work_date],
                        notes: assignment.notes,
                        override_conflicts: assignment.conflict_override,
                        request_id: restoreRequestId,
                      });
                      const restored = restoreResult.assignments?.[0];
                      if (restored) {
                        setBoardBaseData((current) =>
                          applyCapacity(
                            patchBoardWithAssignment(
                              current,
                              assignmentFromMutationRow(restored, null, assignment.visit)
                            ),
                            restoreResult.employee_capacity
                          )
                        );
                      } else if (restoreResult.employee_capacity) {
                        setBoardBaseData((current) =>
                          applyCapacity(current, restoreResult.employee_capacity)
                        );
                      }
                      toast.success('Assignment restored');
                      return { kind: 'success' };
                    } catch (error) {
                      if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
                        toast.error(error instanceof Error ? error.message : 'Unable to restore assignment');
                        return { kind: 'failed', error };
                      }
                      throw error;
                    }
                  },
                });
              },
            },
          });
          return { kind: 'success' };
        } catch (error) {
          if (error instanceof SchedulingApiError && error.status >= 400 && error.status < 500) {
            toast.error(error instanceof Error ? error.message : 'Unable to remove assignment');
            return { kind: 'failed', error };
          }
          throw error;
        }
      },
    });
  }

  function handleQuickAddSubmit(input: QuickAddScheduleProjectInput) {
    setQuickAddDraft(input);
    const visitDate = getScheduleVisitDate(input.initial_visit.starts_at);
    const targetWeekStart = getSchedulingWeek(visitDate).start;
    const operationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const optimisticJob: ScheduleJob = {
      id: createOptimisticEntityId(operationId, 'job'),
      job_reference: 'Creating project…',
      title: input.project_title,
      description: input.project_description || null,
      site_address: input.site_address || null,
      status: 'scheduled',
      source_type: 'manual',
      start_date: input.start_date,
      end_date: input.end_date || input.start_date,
      estimated_duration_minutes: input.estimated_duration_minutes || null,
      quote_id: null,
      quote_project_number_id: null,
      customer_id: input.customer_id,
      customer_site_id: input.customer_site_id || null,
      is_drop_on_ready: input.is_drop_on_ready || false,
      tags: [],
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    };
    const optimisticVisit: ScheduleVisit = {
      id: createOptimisticEntityId(operationId, 'visit'),
      job_id: optimisticJob.id,
      sequence_number: 1,
      title: null,
      starts_at: input.initial_visit.starts_at,
      ends_at: input.initial_visit.ends_at,
      status: 'planned',
      notes: null,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    };
    const applyQuickAdd = (current: SchedulingBoardPayload) =>
      patchBoardWithQuickAdd({
        board: current,
        job: optimisticJob,
        visit: optimisticVisit,
      });
    const targetKey = ['scheduling-board', targetWeekStart] as const;
    const cached = queryClient.getQueryData<SchedulingBoardPayload>(targetKey);
    if (!cached && board) {
      const targetWeek = getSchedulingWeek(visitDate);
      queryClient.setQueryData<SchedulingBoardPayload>(targetKey, {
        week: targetWeek,
        jobs: [],
        tags: board.tags,
        visits: [],
        assignments: [],
        resources: board.resources,
        employee_capacity: [],
        plant_unavailability: [],
        day_teams: [],
      });
      fetchColdWeekInBackground(targetWeekStart);
    }
    const operation = registerOptimisticOperation({
      id: operationId,
      kind: 'quick-add',
      lockKeys: [`quick-add:${input.request_id}`],
      queryKeys: [`board:${targetWeekStart}`, 'projects'],
      proofs: {
        [`board:${targetWeekStart}`]: (state) =>
          state.board?.jobs.some(
            (job) =>
              job.title === input.project_title
              && job.customer_id === input.customer_id
              && job.start_date === input.start_date
          ) === true,
        projects: () => true,
      },
      apply: (state) => ({
        ...state,
        board:
          state.board?.week.start === targetWeekStart
            ? applyQuickAdd(state.board)
            : state.board,
      }),
    });
    if (!operation) {
      setQuickAddOpen(true);
      return;
    }
    setSelectedDate(visitDate);
    activateVisit(optimisticJob, optimisticVisit);
    void quickAddScheduleProject(input)
      .then((result) => {
        const scheduledVisit = adoptAuthoritativeVisit({
          optimisticVisitId: optimisticVisit.id,
          visit: result.visit,
          optimisticJobId: optimisticJob.id,
          job: result.job,
        }) || result.visit;
        queryClient.setQueryData<SchedulingBoardPayload>(
          targetKey,
          (current) => current
            ? patchBoardWithQuickAdd({
                board: current,
                job: result.job,
                visit: scheduledVisit,
              })
            : current
        );
        settleOptimisticOperation(operation.id, 'success', undefined, {
          proofs: {
            [`board:${targetWeekStart}`]: (state) =>
              provesJob(result.job)(state) && provesVisit(scheduledVisit)(state),
            projects: () => true,
          },
          apply: (state) => ({
            ...state,
            board:
              state.board?.week.start === targetWeekStart
                ? patchBoardWithQuickAdd({
                    board: state.board,
                    job: result.job,
                    visit: scheduledVisit,
                  })
                : state.board,
          }),
        });
        setQuickAddDraft(null);
        setActiveVisitTarget((current) =>
          current
          && (
            current.visit.id === optimisticVisit.id
            || current.visit.id === scheduledVisit.id
          )
            ? { job: result.job, visit: scheduledVisit }
            : current
        );
        toast.success(`${result.project_reference} added to the schedule`);
      })
      .catch((error) => {
        getMutationCoordinator().cancelWaiters(optimisticVisit.id);
        getMutationCoordinator().cancelWaiters(optimisticJob.id);
        settleOptimisticOperation(operation.id, 'failure', error);
        setQuickAddOpen(true);
        toast.error(error instanceof Error ? error.message : 'Unable to quick add this job.');
      });
  }

  async function handleRemoveJob() {
    if (!pendingRemoveJob || isRemovingJob) return;
    const job = pendingRemoveJob;
    if (isOptimisticEntityId(job.id)) {
      setPendingRemoveJob(null);
      toast.info('Wait for this new job to finish saving.');
      return;
    }
    const quoteCandidate: ScheduleQuoteCandidate | null =
      job.source_type === 'quote' && job.quote_id
        ? {
            id: job.quote_id,
            quote_reference: job.job_reference,
            base_quote_reference: job.job_reference,
            title: job.title,
            customer_name: job.customer_name || null,
            status: null,
            start_date: null,
            end_date: null,
            estimated_duration_days: Math.max(
              1,
              enumerateScheduleDates(job.start_date, job.end_date).length
            ),
            estimated_duration_minutes: job.estimated_duration_minutes,
            optimistic: true,
          }
        : null;
    const projectCandidate: ScheduleProjectCandidate | null =
      job.source_type === 'manual' && job.quote_project_number_id
        ? {
            id: job.quote_project_number_id,
            project_reference: job.job_reference,
            manager_profile_id: '',
            requester_initials: '',
            title: job.title,
            description: job.description,
            status: 'open',
            optimistic: true,
          }
        : null;
    const queryKeys = [
      `board:${weekStart}`,
      ...(quoteCandidate ? ['quotes'] : []),
      ...(projectCandidate ? ['projects'] : []),
    ];
    const operation = registerOptimisticOperation({
      kind: 'remove-job',
      lockKeys: [`job-tree:${job.id}`],
      queryKeys,
      proofs: {
        [`board:${weekStart}`]: provesBoardEntityAbsent('job', job.id),
        ...(quoteCandidate
          ? {
              quotes: (state: SchedulingProjection) =>
                state.quoteCandidates?.some(
                  (candidate) => candidate.id === quoteCandidate.id
                ) === true,
            }
          : {}),
        ...(projectCandidate
          ? {
              projects: (state: SchedulingProjection) =>
                state.projectCandidates?.some(
                  (candidate) => candidate.id === projectCandidate.id
                ) === true,
            }
          : {}),
      },
      apply: (state) => ({
        ...state,
        board: state.board ? patchBoardRemoveJob(state.board, job.id) : state.board,
        quoteCandidates: quoteCandidate
          ? upsertQuoteCandidate(state.quoteCandidates, quoteCandidate)
          : state.quoteCandidates,
        projectCandidates: projectCandidate
          ? upsertProjectCandidate(state.projectCandidates, projectCandidate)
          : state.projectCandidates,
      }),
    });
    if (!operation) return;
    setIsRemovingJob(true);
    setPendingRemoveJob(null);
    setActiveVisitTarget((current) => current?.job.id === job.id ? null : current);
    setVisitTarget((current) => current?.job.id === job.id ? null : current);
    try {
      await deleteScheduleJob(job.id);
      setBoardBaseData((current) => patchBoardRemoveJob(current, job.id));
      settleOptimisticOperation(operation.id, 'success', undefined, {
        proofs: {
          [`board:${weekStart}`]: provesBoardEntityAbsent('job', job.id),
          ...(quoteCandidate
            ? {
                quotes: (state: SchedulingProjection) =>
                  state.quoteCandidates?.some(
                    (candidate) => candidate.id === quoteCandidate.id
                  ) === true,
              }
            : {}),
          ...(projectCandidate
            ? {
                projects: (state: SchedulingProjection) =>
                  state.projectCandidates?.some(
                    (candidate) => candidate.id === projectCandidate.id
                  ) === true,
              }
            : {}),
        },
        apply: (state) => ({
          ...state,
          board: state.board ? patchBoardRemoveJob(state.board, job.id) : state.board,
          quoteCandidates: quoteCandidate
            ? upsertQuoteCandidate(state.quoteCandidates, quoteCandidate)
            : state.quoteCandidates,
          projectCandidates: projectCandidate
            ? upsertProjectCandidate(state.projectCandidates, projectCandidate)
            : state.projectCandidates,
        }),
      });
      toast.success(
        job.source_type === 'quote'
          ? `${job.job_reference} returned to the Jobs queue`
          : `${job.job_reference} schedule removed`
      );
    } catch (error) {
      settleOptimisticOperation(operation.id, 'failure', error);
      setPendingRemoveJob(job);
      toast.error(error instanceof Error ? error.message : 'Unable to remove job');
    } finally {
      setIsRemovingJob(false);
    }
  }

  function activateVisit(job: ScheduleJob, visit: ScheduleVisit) {
    setActiveVisitTarget({ job, visit });
    setSidebarTab('employee');
  }

  function handleResourceSelect(resource: SelectedScheduleResource) {
    if (activeVisitTarget) {
      if (
        isOptimisticEntityId(activeVisitTarget.job.id)
        || isOptimisticEntityId(activeVisitTarget.visit.id)
      ) {
        toast.info('Wait for this new visit to finish saving before assigning resources.');
        return;
      }
      void assignResource(activeVisitTarget, resource);
      return;
    }
    setSelectedResource(resource);
  }

  function handleBoardClick(event: MouseEvent<HTMLDivElement>) {
    if (
      event.target instanceof Element
      && event.target.closest('[data-schedule-visit-card]')
    ) return;
    setActiveVisitTarget(null);
  }

  function handleTimelinePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      effectiveDailyTimelineMode !== 'scroll'
      || event.pointerType === 'touch'
      || event.button !== 0
    ) return;

    const panSurface =
      event.target instanceof Element
        ? event.target.closest('[data-timeline-pan-surface="true"]')
        : null;
    if (!panSurface || isTimelinePanBlockedTarget(event.target)) return;

    event.preventDefault();
    clearScheduleTextSelection();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rememberSchedulePointerCapture(event.currentTarget, event.pointerId);
    beginBoardPointerBusy('pan-start');
    dailyTimelinePanOperation.current = {
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originScrollLeft: event.currentTarget.scrollLeft,
      hasDragged: false,
    };
  }

  function handleTimelinePointerMove(event: PointerEvent<HTMLDivElement>) {
    const operation = dailyTimelinePanOperation.current;
    if (!operation || operation.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - operation.originClientX;
    if (!operation.hasDragged && Math.abs(deltaX) < DAILY_TIMELINE_PAN_THRESHOLD) {
      return;
    }

    operation.hasDragged = true;
    event.preventDefault();
    setIsDailyTimelinePanning(true);
    event.currentTarget.scrollLeft = operation.originScrollLeft - deltaX;
  }

  function finishTimelinePan(event: PointerEvent<HTMLDivElement>) {
    const operation = dailyTimelinePanOperation.current;
    if (!operation || operation.pointerId !== event.pointerId) return;
    if (operation.hasDragged) event.preventDefault();
    dailyTimelinePanOperation.current = null;
    setIsDailyTimelinePanning(false);
    releaseSchedulePointerCaptures(event.pointerId);
    clearScheduleTextSelection();
    endBoardPointerBusy('pan-finish');
  }

  function cancelTimelinePan(event: PointerEvent<HTMLDivElement>) {
    if (dailyTimelinePanOperation.current?.pointerId !== event.pointerId) return;
    dailyTimelinePanOperation.current = null;
    setIsDailyTimelinePanning(false);
    clearScheduleTextSelection();
    endBoardPointerBusy('pan-cancel');
  }

  function openVisitEditor(job: ScheduleJob, date: string, visit: ScheduleVisit | null = null) {
    setVisitDraft(null);
    setVisitTarget({ job, visit, date });
  }

  function handleViewChange(nextView: SchedulingBoardView) {
    setView(nextView);
    writeSchedulingViewPreference(userId, nextView);
  }

  function handlePrimaryChange(nextPrimary: SchedulingBoardPrimary) {
    setPrimary(nextPrimary);
    writeSchedulingPrimaryPreference(userId, nextPrimary);
  }

  function openDailyForDate(date: string) {
    setSelectedDate(date);
    setActiveVisitTarget(null);
    handleViewChange(SCHEDULING_BOARD_VIEWS.daily);
  }

  function openQuoteScheduler(job: ScheduleJob) {
    setQuoteScheduleDraft(null);
    setSchedulingQuoteJob(job);
  }

  if (boardQuery.isLoading) return <PageLoader message="Loading scheduling board..." />;
  if (!board) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="py-10 text-center">
          <p className="text-red-300">
            {boardQuery.error instanceof Error ? boardQuery.error.message : 'Unable to load the board.'}
          </p>
          <Button
            className={cn('mt-4', schedulingControlStyles.outline)}
            variant="outline"
            onClick={() => void boardQuery.refetch()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <DragDropProvider
      key={dndSessionEpoch}
      sensors={[
        PointerSensor.configure({
          activationConstraints() {
            // Touch-first: short movement threshold on the dedicated drag handle.
            return [new PointerActivationConstraints.Distance({ value: 4 })];
          },
        }),
        KeyboardSensor,
      ]}
      plugins={(defaults) => [
        ...defaults,
        Accessibility.configure({
          announcements: {
            dragstart({ operation: { source } }: DndAnnouncementEvent) {
              const resource = source?.data?.resource as SelectedScheduleResource | undefined;
              const assignment = source?.data?.assignment as ScheduleAssignment | undefined;
              const quote = source?.data?.quote as SchedulingQueueItem | undefined;
              const visit = source?.data?.visit as ScheduleVisit | undefined;
              const job = source?.data?.job as ScheduleJob | undefined;
              if (quote) return `Picked up ${quote.base_quote_reference}.`;
              if (visit && job) {
                return `Picked up visit ${visit.sequence_number} for ${job.job_reference}.`;
              }
              if (resource) return `Picked up ${resource.label}.`;
              if (assignment) return 'Picked up an existing assignment.';
              return 'Started dragging.';
            },
            dragover({ operation: { source, target } }: DndAnnouncementEvent) {
              const resource = source?.data?.resource as SelectedScheduleResource | undefined;
              const assignment = source?.data?.assignment as ScheduleAssignment | undefined;
              const quote = source?.data?.quote as SchedulingQueueItem | undefined;
              const visit = source?.data?.visit as ScheduleVisit | undefined;
              const job = source?.data?.job as ScheduleJob | undefined;
              const data = target?.data as {
                jobReference?: string;
                returnToResources?: boolean;
                visitSequenceNumber?: number;
                workDate?: string;
              } | undefined;
              if (visit && job && data?.returnToResources) {
                return `Visit ${visit.sequence_number} for ${job.job_reference} is over Resources.`;
              }
              if (quote && data?.workDate) {
                return `${quote.base_quote_reference} is over ${format(parseISO(data.workDate), 'EEEE d MMMM')}.`;
              }
              const visitTarget =
                data?.jobReference && data.visitSequenceNumber
                  ? `visit ${data.visitSequenceNumber} for ${data.jobReference}`
                  : null;
              if (resource && visitTarget) {
                return `${resource.label} is over ${visitTarget}.`;
              }
              return assignment && visitTarget
                ? `The assignment is over ${visitTarget}.`
                : undefined;
            },
            dragend({ operation: { source, target }, canceled }: DndAnnouncementEvent) {
              if (canceled) return 'Drag cancelled.';
              const resource = source?.data?.resource as SelectedScheduleResource | undefined;
              const assignment = source?.data?.assignment as ScheduleAssignment | undefined;
              const quote = source?.data?.quote as SchedulingQueueItem | undefined;
              const visit = source?.data?.visit as ScheduleVisit | undefined;
              const job = source?.data?.job as ScheduleJob | undefined;
              if (visit && job && target) {
                return `Visit ${visit.sequence_number} for ${job.job_reference} is ready for confirmation.`;
              }
              if (quote && target) return `${quote.base_quote_reference} was scheduled.`;
              if (resource && target) return `${resource.label} was dropped on a visit.`;
              if (assignment && target) return 'Assignment was dropped on a visit.';
              return quote ? 'The job was not scheduled.' : 'Nothing was assigned.';
            },
          },
        }),
      ]}
      onDragStart={(event) => {
        const resource = event.operation.source?.data?.resource as SelectedScheduleResource | undefined;
        const assignment = event.operation.source?.data?.assignment as ScheduleAssignment | undefined;
        const quote = event.operation.source?.data?.quote as SchedulingQueueItem | undefined;
        const visit = event.operation.source?.data?.visit as ScheduleVisit | undefined;
        const job = event.operation.source?.data?.job as ScheduleJob | undefined;
        const dayTeam = event.operation.source?.data?.dayTeam as ScheduleDayTeamDragData | undefined;
        dragUiRef.current = {
          resource: Boolean(resource),
          assignment: Boolean(assignment),
          quote: Boolean(quote),
          visit: Boolean(visit && job),
          dayTeam: Boolean(dayTeam),
        };
        setDraggedResource(resource || null);
        setDraggedAssignment(assignment || null);
        setDraggedQuote(quote || null);
        setDraggedVisit(visit && job ? { visit, job } : null);
        setDraggedDayTeam(dayTeam || null);
        beginBoardPointerBusy('drag-start');
      }}
      onDragEnd={(event) => {
        const sourceResource = event.operation.source?.data?.resource as SelectedScheduleResource | undefined;
        const sourceAssignment = event.operation.source?.data?.assignment as ScheduleAssignment | undefined;
        const sourceQuote = event.operation.source?.data?.quote as SchedulingQueueItem | undefined;
        const sourceVisit = event.operation.source?.data?.visit as ScheduleVisit | undefined;
        const sourceVisitJob = event.operation.source?.data?.job as ScheduleJob | undefined;
        const sourceDayTeam = event.operation.source?.data?.dayTeam as ScheduleDayTeamDragData | undefined;
        const targetData = event.operation.target?.data as {
          jobId?: string;
          returnToResources?: boolean;
          visitId?: string;
          workDate?: string;
          dayTeamSlotIndex?: ScheduleDayTeamSlotIndex;
        } | undefined;
        const operationPosition = (
          event.operation as unknown as {
            position?: { current?: { x?: number } };
          }
        ).position?.current;
        const dropClientX =
          typeof operationPosition?.x === 'number'
            ? operationPosition.x
            : latestPointerClientX.current;
        dragUiRef.current = {
          resource: false,
          assignment: false,
          quote: false,
          visit: false,
          dayTeam: false,
        };
        setDraggedResource(null);
        setDraggedAssignment(null);
        setDraggedQuote(null);
        setDraggedVisit(null);
        setDraggedDayTeam(null);
        endBoardPointerBusy('drag-end');        if (event.canceled) return;
        if (sourceVisit && sourceVisitJob) {
          if (!targetData?.returnToResources) {
            toast.info('Drop this visit anywhere in Resources to return it to Jobs.');
            return;
          }
          void prepareVisitReturn({ visit: sourceVisit, job: sourceVisitJob });
          return;
        }
        if (sourceQuote) {
          if (
            view === SCHEDULING_BOARD_VIEWS.daily
            && dropClientX !== null
          ) {
            const header = dailyTimelineViewportRef.current?.querySelector<HTMLElement>(
              '[data-testid="schedule-daily-timeline-header"]'
            );
            if (header) {
              const startMinutes = mapDailyScheduleClientXToMinutes({
                clientX: dropClientX,
                rangeLeft: header.getBoundingClientRect().left,
                hourWidth: dailyTimelineRange.hourWidth,
                startHour: dailyTimelineRange.startHour,
                endHour: dailyTimelineRange.endHour,
              });
              if (
                sourceQuote.kind === 'returned_visit'
                && startMinutes
                  + Math.ceil(
                    sourceQuote.returned_visit.duration_milliseconds / 60_000
                  )
                  > dailyTimelineRange.endHour * 60
              ) {
                toast.error('This visit does not fit within the visible scheduling day.');
                return;
              }
              const window = getDailyInitialVisitWindow(
                startMinutes,
                sourceQuote.estimated_duration_minutes || null,
                dailyTimelineRange.endHour
              );
              const toIso = (minutes: number) => {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return toScheduleLondonDateTimeIso(
                  selectedDate,
                  `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
                );
              };
              void scheduleQuoteFromDate(sourceQuote, selectedDate, {
                starts_at: toIso(window.startMinutes),
                ends_at: toIso(window.endMinutes),
              });
              return;
            }
          }
          if (!targetData?.workDate) {
            toast.info('Drop onto a calendar date.');
            return;
          }
          void scheduleQuoteFromDate(sourceQuote, targetData.workDate);
          return;
        }
        if (sourceDayTeam) {
          if (!targetData?.jobId || !targetData.visitId) {
            toast.info('Drop onto a timed visit.');
            return;
          }
          const job = board.jobs.find((item) => item.id === targetData.jobId);
          const visit = board.visits.find((item) => item.id === targetData.visitId);
          if (job && visit) {
            activateVisit(job, visit);
            void assignDayTeamToBoardVisit({ job, visit }, sourceDayTeam.slotIndex);
          } else {
            toast.error('That job is no longer available. Refresh the board and try again.');
          }
          return;
        }
        if (sourceResource && targetData?.dayTeamSlotIndex) {
          void addEmployeeToDayTeam(
            targetData.workDate || selectedDate,
            targetData.dayTeamSlotIndex,
            sourceResource
          );
          return;
        }
        if (!sourceResource && !sourceAssignment) return;
        if (!targetData?.jobId || !targetData.visitId) {
          toast.info('Drop onto a timed visit.');
          return;
        }
        const job = board.jobs.find((item) => item.id === targetData.jobId);
        const visit = board.visits.find((item) => item.id === targetData.visitId);
        if (job && visit) {
          const target = { job, visit };
          activateVisit(job, visit);
          if (sourceResource) void assignResource(target, sourceResource);
          else if (sourceAssignment) void moveAssignmentToVisit(sourceAssignment, target);
        } else {
          toast.error('That job is no longer available. Refresh the board and try again.');
        }
      }}
    >
      <div
        className="flex min-h-0 flex-col gap-4 xl:flex-1 xl:overflow-hidden"
        onClick={handleBoardClick}
        onPointerMoveCapture={(event) => {
          latestPointerClientX.current = event.clientX;
        }}
      >
        <div className="flex shrink-0 flex-col gap-3 rounded-xl border border-border bg-card/70 p-4 xl:flex-row xl:items-center xl:justify-between">
          <SchedulingDateRangeControls
            selectedDate={selectedDate}
            view={view}
            onDateChange={setSelectedDate}
            onViewChange={handleViewChange}
            primary={primary}
            onPrimaryChange={handlePrimaryChange}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              className={schedulingControlStyles.outline}
              variant="outline"
              onClick={() => {
                setPlantBlockDraft(null);
                setUnavailabilityOpen(true);
              }}
            >
              <CalendarOff className="mr-2 h-4 w-4" />
              Plant availability
            </Button>
            <Button
              variant="outline"
              className={schedulingControlStyles.outline}
              disabled={!canCreateQuotes || !canViewCustomers}
              title={!canCreateQuotes || !canViewCustomers ? 'Quotes and Customers access required' : 'New Quote'}
              onClick={() => requestCreation('quote')}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Quote
            </Button>
            <Button
              variant="outline"
              className={schedulingControlStyles.outline}
              disabled={!canCreateQuotes}
              title={!canCreateQuotes ? 'Quotes access required' : 'New Project Number'}
              onClick={() => requestCreation('project')}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Project Number
            </Button>
            <Button
              className={schedulingControlStyles.primary}
              disabled={!canCreateQuotes || !canViewCustomers}
              title={
                !canCreateQuotes || !canViewCustomers
                  ? 'Quotes and Customers access required'
                  : 'Quick add a Project job with a timed visit'
              }
              onClick={() => requestCreation('quick_add')}
              data-testid="schedule-quick-add-button"
            >
              <CalendarPlus className="mr-2 h-4 w-4" />
              Quick add
            </Button>
          </div>
        </div>

        <div
          className="grid min-h-0 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[350px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]"
          data-testid="schedule-manager-layout"
        >
          <ResourcesReturnDropCard>
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="text-base">Resources</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <Tabs
                value={sidebarTab}
                className="shrink-0"
                onValueChange={(value) => {
                  setSidebarTab(value as 'jobs' | 'employee' | 'plant');
                  setSelectedQuote(null);
                  setSelectedResource(null);
                }}
              >
                <TabsList
                  className="grid w-full grid-cols-3"
                  data-testid="schedule-resource-tabs"
                >
                  <TabsTrigger value="jobs">Jobs</TabsTrigger>
                  <TabsTrigger value="employee">Employees</TabsTrigger>
                  <TabsTrigger value="plant">Plant</TabsTrigger>
                </TabsList>
              </Tabs>
              {sidebarTab === 'jobs' ? (
                <>
                  <div className="shrink-0 space-y-3">
                  <p className={RESOURCE_GUIDANCE_CLASS}>
                    Drag a queued job onto a date. Drag a scheduled visit back anywhere into Resources to return it here.
                  </p>
                  {quoteStage === SCHEDULE_QUOTE_STAGES.draft ? (
                    <p className={RESOURCE_GUIDANCE_CLASS}>
                      Draft quotes with a Start Date already appear on the calendar, not in this queue. Leave Start Date blank when creating a quote to keep it selectable here.
                    </p>
                  ) : null}
                  <Tabs
                    value={quoteStage}
                    onValueChange={(value) =>
                      setQuoteStage(value as ScheduleQuoteStage | 'projects' | 'all')
                    }
                  >
                    <TabsList className="grid w-full grid-cols-5">
                      <TabsTrigger value="all" className="px-1 text-[10px]">
                        All ({returnedVisits.length + unscheduledQuotes.length + unscheduledProjects.length})
                      </TabsTrigger>
                      <TabsTrigger value={SCHEDULE_QUOTE_STAGES.draft} className="px-1 text-[10px]">
                        Draft ({quoteStageCounts.draft})
                      </TabsTrigger>
                      <TabsTrigger value={SCHEDULE_QUOTE_STAGES.pending} className="px-1 text-[10px]">
                        Pending ({quoteStageCounts.pending})
                      </TabsTrigger>
                      <TabsTrigger value={SCHEDULE_QUOTE_STAGES.accepted} className="px-1 text-[10px]">
                        Accepted ({quoteStageCounts.accepted})
                      </TabsTrigger>
                      <TabsTrigger value="projects" className="px-1 text-[10px]">
                        Projects ({unscheduledProjects.length})
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={quoteSearch}
                      onChange={(event) => setQuoteSearch(event.target.value)}
                      placeholder="Search unscheduled jobs"
                      className="pl-9"
                    />
                  </div>
                  {visibleSelectedQuote ? (
                    <div className="flex items-center justify-between rounded-md border border-scheduling/40 bg-scheduling-soft p-2 text-xs">
                      <span className="truncate text-foreground">
                        Selected: {visibleSelectedQuote.base_quote_reference}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedQuote(null)}
                        className={cn('h-6 px-1', schedulingControlStyles.ghost)}
                        aria-label="Clear selected job"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                  {quoteCandidatesQuery.isError
                    || (
                      quotesSensitiveAccess.canAccess
                      && projectCandidatesQuery.isError
                    )
                    || visitBacklogQuery.isError ? (
                    <div className="rounded-lg border border-red-500/30 p-3 text-sm text-red-300">
                      <p>Some queued jobs could not be loaded. Available results are still shown.</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn('mt-1', schedulingControlStyles.ghost)}
                        onClick={() => void Promise.all([
                          quoteCandidatesQuery.refetch(),
                          ...(quotesSensitiveAccess.canAccess
                            ? [projectCandidatesQuery.refetch()]
                            : []),
                          visitBacklogQuery.refetch(),
                        ])}
                      >
                        Try again
                      </Button>
                    </div>
                  ) : null}
                  </div>
                  <ScrollArea
                    className="h-[420px] min-h-0 pr-3 xl:h-0 xl:flex-1"
                    data-mobile-scroll-lock="true"
                    data-testid="schedule-jobs-scroll-area"
                  >
                    <div className="space-y-2">
                        {quoteCandidatesQuery.isLoading
                          && projectCandidatesQuery.isLoading
                          && visitBacklogQuery.isLoading ? (
                          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                            Loading unscheduled jobs…
                          </p>
                        ) : filteredQuoteCandidates.length > 0 ? (
                          filteredQuoteCandidates.map((quote) => (
                            <DraggableQuoteCard
                              key={quote.id}
                              quote={quote}
                              selected={visibleSelectedQuote?.id === quote.id}
                              onSelect={() =>
                                setSelectedQuote((current) =>
                                  current?.id === quote.id ? null : quote
                                )
                              }
                            />
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                            No {quoteStage === 'all' ? 'queued jobs' : quoteStage === 'projects' ? 'Projects' : quoteStage} match this search.
                          </div>
                        )}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <>
                  <div className="shrink-0 space-y-3">
                  {activeVisitTarget ? (
                    <div className="rounded-md border border-scheduling/40 bg-scheduling-soft p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground">
                            {activeVisitTarget.job.job_reference} · Visit {activeVisitTarget.visit.sequence_number}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {format(parseISO(activeVisitTarget.visit.starts_at), 'EEE d MMM')}
                            {' · '}
                            {formatScheduleVisitTime(activeVisitTarget.visit.starts_at)}–
                            {formatScheduleVisitTime(activeVisitTarget.visit.ends_at)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveVisitTarget(null)}
                          className={cn('h-7 px-2', schedulingControlStyles.ghost)}
                          aria-label="Clear selected visit"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="mt-2 text-muted-foreground">
                        Tap a resource or drag its card onto this or another visit.
                      </p>
                    </div>
                  ) : (
                    <p className={RESOURCE_GUIDANCE_CLASS}>
                      Select a visit to show resources available for its exact time.
                    </p>
                  )}
                  <Tabs
                    value={resourceAvailabilityView}
                    onValueChange={(value) =>
                      setResourceAvailabilityView(value as 'available' | 'unavailable' | 'all')
                    }
                  >
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="all" className="whitespace-nowrap px-0.5 text-[10px] leading-none tracking-tight">
                        All ({sidebarTab === 'employee' ? matchingEmployees.length : matchingPlant.length})
                      </TabsTrigger>
                      <TabsTrigger value="available" className="whitespace-nowrap px-0.5 text-[10px] leading-none tracking-tight">
                        Available ({sidebarTab === 'employee' ? availableEmployees.length : availablePlant.length})
                      </TabsTrigger>
                      <TabsTrigger value="unavailable" className="whitespace-nowrap px-0.5 text-[10px] leading-none tracking-tight">
                        Unavailable ({sidebarTab === 'employee' ? unavailableEmployees.length : unavailablePlant.length})
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {sidebarTab === 'employee' ? (
                    <Select value={teamFilter} onValueChange={setTeamFilter}>
                      <SelectTrigger><SelectValue placeholder="All teams" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All teams</SelectItem>
                        {teams.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={resourceSearch}
                      onChange={(event) => setResourceSearch(event.target.value)}
                      placeholder="Search resources"
                      className="pl-9"
                    />
                  </div>
                  {view === SCHEDULING_BOARD_VIEWS.daily && sidebarTab === 'employee' ? (
                    <ResourceOccupancyLegend />
                  ) : null}
                  {selectedResource ? (
                    <div className="flex items-center justify-between rounded-md border border-scheduling/40 bg-scheduling-soft p-2 text-xs">
                      <span className="truncate text-foreground">
                        Selected: {selectedResource.label}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedResource(null)}
                        className={cn('h-6 px-1', schedulingControlStyles.ghost)}
                        aria-label="Clear selected resource"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                  </div>
                  <ScrollArea
                    className="h-[420px] min-h-0 pr-3 xl:h-0 xl:flex-1"
                    data-mobile-scroll-lock="true"
                    data-testid="schedule-resource-scroll-area"
                  >
                    <div className="space-y-2">
                      {sidebarTab === 'employee'
                        ? filteredEmployees.map((employee) => {
                            const resource = resourceFromEmployee(employee);
                            const isUnavailable = Boolean(
                              activeVisitTarget
                              && isResourceUnavailableForVisit(
                                { type: 'employee', id: employee.id },
                                board.assignments,
                                activeVisitTarget.visit
                              )
                            );
                            return (
                              <ResourceCard
                                key={employee.id}
                                resource={resource}
                                subtitle={employee.team_name || 'No team assigned'}
                                metadata={[
                                  activeVisitTarget
                                    ? isUnavailable ? 'Unavailable' : 'Available'
                                    : 'Employee',
                                  employee.employee_id,
                                ].filter(Boolean).join(' · ')}
                                warning={isUnavailable ? 'Already assigned during this visit' : undefined}
                                occupancySegments={
                                  view === SCHEDULING_BOARD_VIEWS.daily
                                    ? buildEmployeeOccupancySegments({
                                        profileId: employee.id,
                                        workDate: selectedDate,
                                        assignments: board.assignments,
                                        sessions: board.employee_day_sessions,
                                      })
                                    : undefined
                                }
                                selected={selectedResource?.type === 'employee' && selectedResource.id === employee.id}
                                dragEnabled
                                onSelect={() => handleResourceSelect(resource)}
                              />
                            );
                          })
                        : filteredPlant.map((plant) => {
                            const resource = resourceFromPlant(plant);
                            const isUnavailable = Boolean(
                              activeVisitTarget
                              && isResourceUnavailableForVisit(
                                { type: 'plant', id: plant.id },
                                board.assignments,
                                activeVisitTarget.visit
                              )
                            );
                            return (
                              <ResourceCard
                                key={plant.id}
                                resource={resource}
                                subtitle={[plant.make, plant.model].filter(Boolean).join(' · ') || 'Plant asset'}
                                metadata={[
                                  activeVisitTarget
                                    ? isUnavailable ? 'Unavailable' : 'Available'
                                    : 'Plant',
                                  plant.status,
                                ].filter(Boolean).join(' · ')}
                                warning={
                                  isUnavailable
                                    ? 'Already assigned during this visit'
                                    : plant.status !== 'active'
                                      ? `Status: ${plant.status}`
                                      : undefined
                                }
                                selected={selectedResource?.type === 'plant' && selectedResource.id === plant.id}
                                dragEnabled
                                onSelect={() => handleResourceSelect(resource)}
                              />
                            );
                          })}
                      {(sidebarTab === 'employee' ? filteredEmployees : filteredPlant).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                          No {sidebarTab === 'employee' ? 'employees' : 'plant'} match these filters.
                        </div>
                      ) : null}
                    </div>
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </ResourcesReturnDropCard>

          <Card
            className="flex min-h-0 min-w-0 flex-col border-border xl:h-full xl:overflow-hidden"
            data-testid="schedule-board-panel"
          >
            <CardHeader className="shrink-0 gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>
                  {getScheduleBoardTitle(
                    view === SCHEDULING_BOARD_VIEWS.daily ? 'Daily' : 'Weekly',
                    primary
                  )}
                </CardTitle>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={jobSearch}
                    onChange={(event) => void setJobFilters({ q: event.target.value })}
                    placeholder="Search jobs"
                    className="pl-9"
                  />
                </div>
              </div>
              {view === SCHEDULING_BOARD_VIEWS.daily ? (
                <div className="hidden md:block">
                  <ScheduleDayTeamBuckets
                    workDate={selectedDate}
                    slots={slotsForScheduleDate(board.day_teams, selectedDate)}
                    dndScope="desktop"
                    onRemoveMember={removeEmployeeFromDayTeam}
                  />
                </div>
              ) : null}
              <div
                className="flex min-h-7 items-center justify-between gap-3"
                data-testid={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? 'schedule-daily-instruction-row'
                    : undefined
                }
              >
                <div>
                  <p className="text-sm text-muted-foreground xl:hidden">
                    Drag from the grip handle onto a visit, or select a visit and tap a resource.
                  </p>
                  <p className="hidden text-sm text-muted-foreground xl:block">
                    Drag from the grip handle onto a timed visit, or select the visit and tap a resource.
                  </p>
                </div>
                {view === SCHEDULING_BOARD_VIEWS.daily ? (
                  <TooltipProvider delayDuration={200}>
                    <div
                      className="hidden shrink-0 items-center gap-1 md:flex"
                      role="group"
                      aria-label="Daily timeline display mode"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn(
                              'h-7 w-7 p-0',
                              effectiveDailyTimelineMode === 'fit'
                                ? schedulingControlStyles.primary
                                : schedulingControlStyles.ghost
                            )}
                            aria-label="Shrink to fit width"
                            aria-pressed={effectiveDailyTimelineMode === 'fit'}
                            disabled={!isDailyTimelineFitEligible}
                            title="Shrink to fit width"
                            onClick={() => setDailyTimelineMode('fit')}
                          >
                            <Minimize2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Shrink to fit width
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn(
                              'h-7 w-7 p-0',
                              effectiveDailyTimelineMode === 'scroll'
                                ? schedulingControlStyles.primary
                                : schedulingControlStyles.ghost
                            )}
                            aria-label="Scroll"
                            aria-pressed={effectiveDailyTimelineMode === 'scroll'}
                            title="Scroll"
                            onClick={() => setDailyTimelineMode('scroll')}
                          >
                            <MoveHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Scroll</TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2" aria-label="Job classification filters">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={
                    jobFilters.ready
                      ? schedulingControlStyles.primary
                      : schedulingControlStyles.outline
                  }
                  aria-pressed={jobFilters.ready}
                  onClick={() => void setJobFilters({ ready: !jobFilters.ready })}
                >
                  Offer if crew free
                </Button>
                {(board.tags || []).map((tag) => {
                  const isSelected = jobFilters.tags.includes(tag.id);
                  return (
                    <Button
                      key={tag.id}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={
                        isSelected
                          ? schedulingControlStyles.primary
                          : schedulingControlStyles.outline
                      }
                      aria-pressed={isSelected}
                      onClick={() =>
                        void setJobFilters({
                          tags: isSelected
                            ? jobFilters.tags.filter((id) => id !== tag.id)
                            : [...jobFilters.tags, tag.id],
                        })
                      }
                    >
                      {isSelected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      {tag.name}
                    </Button>
                  );
                })}
                {(jobFilters.ready || jobFilters.tags.length > 0 || jobSearch) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={schedulingControlStyles.ghost}
                    onClick={() => void setJobFilters({ q: '', tags: [], ready: false })}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                ref={dailyTimelineViewportRef}
                className={cn(
                  'hidden overflow-y-hidden rounded-lg border border-border overscroll-x-contain select-none md:flex md:min-h-0 md:flex-col xl:h-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto',
                  view === SCHEDULING_BOARD_VIEWS.weekly
                    && 'scrollbar-hidden overflow-x-auto',
                  view === SCHEDULING_BOARD_VIEWS.daily
                    && effectiveDailyTimelineMode === 'fit'
                    && 'overflow-x-hidden',
                  view === SCHEDULING_BOARD_VIEWS.daily
                    && effectiveDailyTimelineMode === 'scroll'
                    && 'overflow-x-auto [scrollbar-color:hsl(var(--muted-foreground)/0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent',
                  view === SCHEDULING_BOARD_VIEWS.daily
                    && visibleDraggedQuote
                    && 'ring-2 ring-inset ring-emerald-400',
                  isDailyTimelinePanning && 'cursor-grabbing'
                )}
                data-testid={view === SCHEDULING_BOARD_VIEWS.daily ? 'schedule-daily-timeline' : undefined}
                aria-label={view === SCHEDULING_BOARD_VIEWS.daily ? 'Daily schedule timeline' : undefined}
                data-timeline-mode={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? effectiveDailyTimelineMode
                    : undefined
                }
                data-fit-eligible={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? String(isDailyTimelineFitEligible)
                    : undefined
                }
                data-timeline-panning={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? String(isDailyTimelinePanning)
                    : undefined
                }
                onPointerDown={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? handleTimelinePointerDown
                    : undefined
                }
                onPointerMove={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? handleTimelinePointerMove
                    : undefined
                }
                onPointerUp={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? finishTimelinePan
                    : undefined
                }
                onPointerCancel={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? cancelTimelinePan
                    : undefined
                }
                onLostPointerCapture={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? finishTimelinePan
                    : undefined
                }
                onDragStart={
                  view === SCHEDULING_BOARD_VIEWS.daily
                    ? (event) => event.preventDefault()
                    : undefined
                }
              >
                <div
                  className={cn(
                    'flex min-h-full flex-col',
                    view !== SCHEDULING_BOARD_VIEWS.daily && 'min-w-[1260px]'
                  )}
                  style={
                    view === SCHEDULING_BOARD_VIEWS.daily
                      ? {
                          minWidth:
                            DAILY_TIMELINE_JOB_COLUMN_WIDTH + dailyTimelineRange.width,
                          width:
                            DAILY_TIMELINE_JOB_COLUMN_WIDTH + dailyTimelineRange.width,
                        }
                      : undefined
                  }
                  data-testid={
                    view === SCHEDULING_BOARD_VIEWS.daily
                      ? 'schedule-daily-timeline-content'
                      : undefined
                  }
                >
                  <div
                    className={cn(
                      'grid shrink-0 bg-muted/60',
                      view !== SCHEDULING_BOARD_VIEWS.daily
                        && 'grid-cols-[240px_repeat(7,minmax(140px,1fr))]'
                    )}
                    style={
                      view === SCHEDULING_BOARD_VIEWS.daily
                        ? {
                            gridTemplateColumns:
                              `${DAILY_TIMELINE_JOB_COLUMN_WIDTH}px ${dailyTimelineRange.width}px`,
                          }
                        : undefined
                    }
                  >
                    <div
                      className={cn(
                        'border-r border-border p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                        view === SCHEDULING_BOARD_VIEWS.daily
                          ? 'sticky left-0 z-30 bg-[hsl(var(--background)/0.5)]'
                          : 'sticky left-0 z-20 bg-slate-800/95'
                      )}
                      data-testid={
                        view === SCHEDULING_BOARD_VIEWS.daily
                          ? 'schedule-daily-job-header'
                          : undefined
                      }
                    >
                      <span>{getScheduleBoardAxisLabel(primary)}</span>
                      {view === SCHEDULING_BOARD_VIEWS.daily ? (
                        <span className="mt-1 block normal-case tracking-normal text-foreground">
                          {format(parseISO(selectedDate), 'EEE d MMM')}
                        </span>
                      ) : null}
                    </div>
                    {view === SCHEDULING_BOARD_VIEWS.daily ? (
                      <DailyTimelineHeader
                        date={selectedDate}
                        range={dailyTimelineRange}
                        isPannable={effectiveDailyTimelineMode === 'scroll'}
                        selectedQuote={visibleSelectedQuote}
                        isSchedulingQuote={isSchedulingQuote}
                        onScheduleQuote={(quote, date) => void scheduleQuoteFromDate(quote, date)}
                      />
                    ) : (
                      weekDates.map((date) => (
                        <WeeklyDayHeader
                          key={date}
                          date={date}
                          capacity={capacityByDate.get(date) || null}
                          dropScope="desktop"
                          selectedQuote={visibleSelectedQuote}
                          isSchedulingQuote={isSchedulingQuote}
                          onOpenDaily={openDailyForDate}
                          onScheduleQuote={(quote, workDate) =>
                            void scheduleQuoteFromDate(quote, workDate)
                          }
                        />
                      ))
                    )}
                  </div>
                  {boardRows.map((row) => {
                    const dailyLayout = getDailyTimelineLayout(
                      row.visitsByDate[selectedDate] || [],
                      row.legacyAssignmentsByDate[selectedDate] || []
                    );
                    const job = row.job;

                    return (
                      <div
                      key={row.id}
                      className={cn(
                        'grid shrink-0 border-t border-border',
                        view !== SCHEDULING_BOARD_VIEWS.daily
                          && 'grid-cols-[240px_repeat(7,minmax(140px,1fr))]'
                      )}
                      data-testid={getScheduleBoardRowTestId(row)}
                      style={
                        view === SCHEDULING_BOARD_VIEWS.daily
                          ? {
                              gridTemplateColumns:
                                `${DAILY_TIMELINE_JOB_COLUMN_WIDTH}px ${dailyTimelineRange.width}px`,
                            height: dailyLayout.rowHeight,
                            }
                          : undefined
                      }
                    >
                      <div
                        className={cn(
                          'flex h-full min-h-0 flex-col overflow-hidden border-r border-border p-3',
                          view === SCHEDULING_BOARD_VIEWS.daily
                            ? 'sticky left-0 z-30 bg-[hsl(var(--background)/0.5)]'
                            : 'sticky left-0 z-10 bg-slate-900'
                        )}
                        data-testid={
                          view === SCHEDULING_BOARD_VIEWS.daily
                            ? getScheduleBoardDailyRailTestId(row)
                            : undefined
                        }
                        style={
                          view === SCHEDULING_BOARD_VIEWS.daily
                            ? { height: dailyLayout.rowHeight }
                            : undefined
                        }
                      >
                        <BoardRowIdentity row={row} primary={primary} />
                        {job ? (
                        <div
                          className="mt-auto flex min-w-0 items-end justify-between gap-1 pt-2"
                          data-testid={`schedule-job-footer-desktop-${job.id}`}
                        >
                          <div className="flex max-h-10 min-w-0 flex-wrap items-center gap-1 overflow-hidden">
                            {job.source_type === 'sample' ? <Badge variant="outline" className={schedulingControlStyles.sourceBadge}>Sample</Badge> : null}
                            {job.source_type === 'quote' ? <Badge variant="outline" className={schedulingControlStyles.sourceBadge}>Quote</Badge> : null}
                            {job.source_type === 'manual' && job.quote_project_number_id ? (
                              <Badge variant="outline" className={schedulingControlStyles.sourceBadge}>Project</Badge>
                            ) : null}
                            {(job.tags || []).map((tag) => (
                              <Badge key={tag.id} variant="secondary">{tag.name}</Badge>
                            ))}
                          </div>
                          <ScheduledJobActions
                            job={job}
                            isCrewOfferPending={pendingCrewOfferJobIds.has(job.id)}
                            visitDate={
                              view === SCHEDULING_BOARD_VIEWS.daily
                                ? selectedDate
                                : undefined
                            }
                            onAddVisit={() => openVisitEditor(job, selectedDate)}
                            onEdit={() => {
                              setJobDraft(null);
                              setEditingJob(job);
                              setJobDialogOpen(true);
                            }}
                            onRemove={() => setPendingRemoveJob(job)}
                            onReschedule={() => openQuoteScheduler(job)}
                            onToggleCrewOffer={() => void toggleCrewOffer(job)}
                          />
                        </div>
                        ) : null}
                      </div>
                      {view === SCHEDULING_BOARD_VIEWS.daily ? (
                        <DailyTimelineCell
                          key={`${row.id}-${selectedDate}`}
                          row={row}
                          date={selectedDate}
                          range={dailyTimelineRange}
                          layout={dailyLayout}
                          isPannable={effectiveDailyTimelineMode === 'scroll'}
                          activeVisitId={activeVisitTarget?.visit.id || null}
                          onActivateVisit={(placementJob, visit) => activateVisit(placementJob, visit)}
                          onAddVisit={
                            job
                              ? () => openVisitEditor(job, selectedDate)
                              : null
                          }
                          onEditVisit={(placementJob, visit) => openVisitEditor(placementJob, selectedDate, visit)}
                          onReturnVisit={(placementJob, visit) => void prepareVisitReturn({ job: placementJob, visit }, { skipConfirmation: true })}
                          onDeleteAssignment={setPendingDeleteAssignment}
                          onResizeVisit={resizeVisit}
                        />
                      ) : (
                        weekDates.map((date) => (
                          <DayCell
                            key={`${row.id}-${date}`}
                            row={row}
                            date={date}
                            activeVisitId={activeVisitTarget?.visit.id || null}
                            onActivateVisit={(placementJob, visit) => activateVisit(placementJob, visit)}
                            onAddVisit={
                              job
                                ? (addJob) => openVisitEditor(addJob, date)
                                : null
                            }
                            onEditVisit={(placementJob, visit) => openVisitEditor(placementJob, date, visit)}
                            onReturnVisit={(placementJob, visit) => void prepareVisitReturn({ job: placementJob, visit }, { skipConfirmation: true })}
                            onDeleteAssignment={setPendingDeleteAssignment}
                          />
                        ))
                      )}
                      </div>
                    );
                  })}
                  <div
                    className={cn(
                      'grid min-h-0 flex-1',
                      view !== SCHEDULING_BOARD_VIEWS.daily
                        && 'grid-cols-[240px_repeat(7,minmax(140px,1fr))]'
                    )}
                    data-testid="schedule-board-grid-fill"
                    aria-hidden="true"
                    style={
                      view === SCHEDULING_BOARD_VIEWS.daily
                        ? {
                            gridTemplateColumns:
                              `${DAILY_TIMELINE_JOB_COLUMN_WIDTH}px ${dailyTimelineRange.width}px`,
                          }
                        : undefined
                    }
                  >
                    <div
                      className={cn(
                        'border-r border-t border-border',
                        view === SCHEDULING_BOARD_VIEWS.daily
                          ? 'sticky left-0 z-30 bg-[hsl(var(--background)/0.5)]'
                          : 'sticky left-0 z-10 bg-slate-900'
                      )}
                    />
                    {view === SCHEDULING_BOARD_VIEWS.daily ? (
                      <div
                        className="min-h-0 border-l border-t border-border bg-muted/10"
                        data-testid="schedule-board-hour-grid-fill"
                        data-timeline-pan-surface="true"
                        style={dailyTimelineHourGridStyle(dailyTimelineRange.hourWidth)}
                      />
                    ) : (
                      weekDates.map((date) => (
                        <div
                          key={`grid-fill-${date}`}
                          className="min-h-0 border-l border-t border-border"
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3 md:hidden" data-mobile-scroll-lock="true">
                {view === SCHEDULING_BOARD_VIEWS.daily ? (
                  <ScheduleDayTeamBuckets
                    workDate={selectedDate}
                    slots={slotsForScheduleDate(board.day_teams, selectedDate)}
                    dndScope="mobile"
                    onRemoveMember={removeEmployeeFromDayTeam}
                  />
                ) : null}
                <div
                  className={cn(
                    'grid overflow-hidden rounded-lg border border-border',
                    view === SCHEDULING_BOARD_VIEWS.weekly
                      ? 'grid-cols-2 sm:grid-cols-4'
                      : 'grid-cols-1'
                  )}
                >
                    {(view === SCHEDULING_BOARD_VIEWS.weekly ? weekDates : [selectedDate]).map((date) => (
                      <WeeklyDayHeader
                        key={date}
                        date={date}
                        capacity={capacityByDate.get(date) || null}
                        compact
                        dropScope="mobile"
                        selectedQuote={visibleSelectedQuote}
                        isSchedulingQuote={isSchedulingQuote}
                        onOpenDaily={openDailyForDate}
                        onScheduleQuote={(quote, workDate) =>
                          void scheduleQuoteFromDate(quote, workDate)
                        }
                      />
                    ))}
                  </div>
                {boardRows.map((row) => {
                  const job = row.job;
                  const dndInstanceId = boardRowDndInstanceId(row);
                  const mobileDates = job
                    ? weekDates.filter((date) => date >= job.start_date && date <= job.end_date)
                    : weekDates;
                  return (
                  <div
                    key={row.id}
                    className="rounded-lg border border-border bg-muted/20 p-3"
                    data-testid={`${getScheduleBoardRowTestId(row)}-mobile`}
                  >
                    <div className="mb-3 min-w-0">
                      <BoardRowIdentity row={row} primary={primary} />
                      {job ? (
                      <div
                        className="mt-2 flex min-w-0 items-end justify-between gap-2"
                        data-testid={`schedule-job-footer-mobile-${job.id}`}
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
                          {job.source_type === 'sample' ? <Badge variant="outline" className={schedulingControlStyles.sourceBadge}>Sample</Badge> : null}
                          {job.source_type === 'quote' ? <Badge variant="outline" className={schedulingControlStyles.sourceBadge}>Quote</Badge> : null}
                          {job.source_type === 'manual' && job.quote_project_number_id ? (
                            <Badge variant="outline" className={schedulingControlStyles.sourceBadge}>Project</Badge>
                          ) : null}
                          {(job.tags || []).map((tag) => (
                            <Badge key={tag.id} variant="secondary">{tag.name}</Badge>
                          ))}
                        </div>
                        <ScheduledJobActions
                          job={job}
                          visitDate={
                            view === SCHEDULING_BOARD_VIEWS.daily
                              ? selectedDate
                              : undefined
                          }
                          isMobile
                          isCrewOfferPending={pendingCrewOfferJobIds.has(job.id)}
                          onAddVisit={() => openVisitEditor(job, selectedDate)}
                          onEdit={() => {
                            setJobDraft(null);
                            setEditingJob(job);
                            setJobDialogOpen(true);
                          }}
                          onRemove={() => setPendingRemoveJob(job)}
                          onReschedule={() => openQuoteScheduler(job)}
                          onToggleCrewOffer={() => void toggleCrewOffer(job)}
                        />
                      </div>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      {mobileDates.map((date) => {
                        const placements = row.visitsByDate[date] || [];
                        const legacyAssignments = row.legacyAssignmentsByDate[date] || [];
                        return (
                          <div
                            key={date}
                            className="rounded-md border border-border p-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              {view === SCHEDULING_BOARD_VIEWS.weekly ? (
                                <button
                                  type="button"
                                  onClick={() => openDailyForDate(date)}
                                  className="rounded-sm text-xs font-semibold uppercase text-muted-foreground hover:text-scheduling focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scheduling"
                                  aria-label={`Open daily schedule for ${format(parseISO(date), 'EEEE d MMMM')}`}
                                >
                                  {format(parseISO(date), 'EEEE d MMM')}
                                </button>
                              ) : (
                                <span className="text-xs font-semibold uppercase text-muted-foreground">
                                  {format(parseISO(date), 'EEEE d MMM')}
                                </span>
                              )}
                              {view === SCHEDULING_BOARD_VIEWS.weekly && job ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className={cn('h-11 w-11 p-0', schedulingControlStyles.ghost)}
                                  onClick={() => openVisitEditor(job, date)}
                                  aria-label={`Add Additional Visit to ${job.job_reference} on ${date}`}
                                  title="Add Additional Visit"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                            <div className="space-y-1">
                              {filterHiddenBoardAssignments(
                                legacyAssignments,
                                row.hiddenAssignment
                              ).map((assignment) => (
                                <AssignmentChip
                                  key={`${assignment.resource_type}-${assignment.id}`}
                                  assignment={assignment}
                                  onDelete={setPendingDeleteAssignment}
                                  dragScope="mobile"
                                  dndInstanceId={dndInstanceId}
                                />
                              ))}
                              {placements.map((placement) => (
                                  <VisitCard
                                    key={`${placement.job.id}-${placement.visit.id}`}
                                    job={placement.job}
                                    visit={placement.visit}
                                    assignments={placement.assignments}
                                    isDropEnabled
                                    isActiveTarget={activeVisitTarget?.visit.id === placement.visit.id}
                                    onActivate={() => activateVisit(placement.job, placement.visit)}
                                    onEdit={() => openVisitEditor(placement.job, date, placement.visit)}
                                    onReturn={() => void prepareVisitReturn({ job: placement.job, visit: placement.visit }, { skipConfirmation: true })}
                                    onDeleteAssignment={setPendingDeleteAssignment}
                                    dndScope="mobile"
                                    dndInstanceId={dndInstanceId}
                                    hiddenAssignment={row.hiddenAssignment}
                                  />
                              ))}
                              {legacyAssignments.length === 0 && placements.length === 0 ? (
                                <span className="text-xs text-muted-foreground">No visits yet</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
              </div>

              {isTentativeWeek ? (
                <div
                  className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100"
                  role="status"
                >
                  {coldWeekState?.status === 'failed' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {coldWeekState.error || 'Unable to load the remaining week details.'}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        className={schedulingControlStyles.outline}
                        onClick={() => fetchColdWeekInBackground(weekStart)}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : (
                    'Loading the remaining schedule, capacity and plant availability for this week…'
                  )}
                </div>
              ) : null}
              {boardRows.length === 0 && !isTentativeWeek ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">
                      {primary === SCHEDULING_BOARD_PRIMARIES.job
                        ? (
                          !hasActiveJobFilters
                            ? `No jobs scheduled for this ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}`
                            : 'No jobs match these filters'
                        )
                        : `No ${primary === SCHEDULING_BOARD_PRIMARIES.plant ? 'plant' : 'employee'} rows for this ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}`}
                    </p>
                    <p className="mt-1 text-sm">
                      {primary === SCHEDULING_BOARD_PRIMARIES.job
                        ? (
                          !hasActiveJobFilters
                            ? `Use Resources > Jobs for queued Quotes, add a Project job, or choose another ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}.`
                            : 'Clear or change the job filters to see more results.'
                        )
                        : 'Place a job on a date, then assign this resource to a timed visit. Unstaffed visits appear in Unassigned.'}
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <DragOverlay>
        {draggedVisit ? (
          <div className="max-w-72 rounded-lg border border-scheduling bg-popover px-3 py-2 shadow-2xl">
            <p className="text-sm font-semibold text-foreground">
              {draggedVisit.job.job_reference} · Visit {draggedVisit.visit.sequence_number}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatScheduleVisitTime(draggedVisit.visit.starts_at)}–
              {formatScheduleVisitTime(draggedVisit.visit.ends_at)}
            </p>
          </div>
        ) : visibleDraggedQuote ? (
          <div className="max-w-72 rounded-lg border border-scheduling bg-popover px-3 py-2 shadow-2xl">
            <p className="text-sm font-semibold text-foreground">
              {visibleDraggedQuote.base_quote_reference}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {visibleDraggedQuote.title}
            </p>
          </div>
        ) : draggedDayTeam ? (
          <div className="rounded-lg border border-scheduling bg-popover px-3 py-2 text-sm font-semibold text-foreground shadow-2xl">
            Team {draggedDayTeam.slotIndex}
          </div>
        ) : draggedResource ? (
          <div className="rounded-lg border border-scheduling bg-popover px-3 py-2 text-sm font-semibold text-foreground shadow-2xl">
            {draggedResource.label}
          </div>
        ) : draggedAssignment ? (
          <div className="rounded-lg border border-scheduling bg-popover px-3 py-2 text-sm font-semibold text-foreground shadow-2xl">
            {draggedAssignment.resource_type === 'employee'
              ? draggedAssignment.employee?.full_name || 'Employee assignment'
              : draggedAssignment.plant?.nickname
                || draggedAssignment.plant?.plant_id
                || 'Plant assignment'}
          </div>
        ) : null}
      </DragOverlay>

      {visitTarget ? (
        <ScheduleVisitDialog
          open
          onOpenChange={(open) => !open && setVisitTarget(null)}
          job={visitTarget.job}
          visit={visitTarget.visit}
          defaultDate={visitTarget.date}
          initialInput={visitDraft}
          onSave={handleVisitSave}
          onDelete={handleVisitDelete}
        />
      ) : null}
      {jobDialogOpen && editingJob ? (
        <ScheduleJobDialog
          open
          onOpenChange={setJobDialogOpen}
          job={editingJob}
          defaultDate={weekDates[0] || board.week.start}
          initialInput={jobDraft}
          onSubmit={handleJobUpdate}
        />
      ) : null}
      {schedulingQuoteJob ? (
        <ScheduleQuoteDialog
          open
          onOpenChange={(open) => {
            if (!open) setSchedulingQuoteJob(null);
          }}
          job={schedulingQuoteJob}
          initialInput={quoteScheduleDraft}
          onSubmit={handleQuoteReschedule}
        />
      ) : null}
      {quotesSensitiveAccess.canAccess ? (
        <>
          <ScheduleProjectPlacementDialog
            project={projectPlacement?.project || null}
            date={projectPlacement?.date || selectedDate}
            initialVisit={projectPlacement?.initialVisit}
            initialInput={projectPlacementDraft}
            onClose={() => setProjectPlacement(null)}
            onSubmit={handleProjectPlacementSubmit}
          />
          <QuoteCreationHost
            open={quoteCreationOpen}
            onClose={() => setQuoteCreationOpen(false)}
            onCreated={(quote) => {
              const candidate: ScheduleQuoteCandidate = {
                id: quote.id,
                quote_reference: quote.quote_reference,
                base_quote_reference: quote.base_quote_reference || quote.quote_reference,
                title: quote.subject_line || quote.project_description || 'Quoted work',
                customer_name: quote.customer?.company_name || null,
                status: 'draft',
                start_date: null,
                end_date: null,
                estimated_duration_days: quote.estimated_duration_days || null,
                estimated_duration_minutes: null,
              };
              queryClient.setQueryData(
                ['scheduling-quote-candidates'],
                (current: ScheduleQuoteCandidate[] | undefined) =>
                  upsertQuoteCandidate(current, candidate)
              );
              reconcileOptimisticKeysInBackground(['quotes']);
              setQuoteStage(SCHEDULE_QUOTE_STAGES.draft);
              setSelectedQuote({
                kind: 'quote',
                ...candidate,
              });
            }}
          />
        </>
      ) : null}
      {quotesSensitiveAccess.canAccess ? (
        <SensitiveModuleSessionManager moduleLabel="Quotes" access={quotesSensitiveAccess} />
      ) : null}
      {shouldShowQuotesGate ? (
        <div className="fixed inset-0 z-[190] overflow-y-auto bg-slate-950/95">
          <SensitiveModuleGate moduleLabel="Quotes" access={quotesSensitiveAccess} />
        </div>
      ) : null}
      {quotesSensitiveAccess.canAccess ? (
        <>
          <ProjectNumberFormDialog
            open={projectCreationOpen}
            managerOptions={quoteManagerOptions}
            managerLoadError={quoteManagerOptionsError}
            onClose={() => setProjectCreationOpen(false)}
            onCreated={(project: QuoteProjectNumber) => {
              const candidate: ScheduleProjectCandidate = {
                id: project.id,
                project_reference: project.project_reference,
                manager_profile_id: project.manager_profile_id,
                requester_initials: project.requester_initials,
                title: project.title,
                description: project.description,
                status: 'open',
              };
              queryClient.setQueryData(
                ['scheduling-project-candidates'],
                (current: ScheduleProjectCandidate[] | undefined) =>
                  upsertProjectCandidate(current, candidate)
              );
              reconcileOptimisticKeysInBackground(['projects']);
              setQuoteStage('projects');
              setSelectedQuote({
                kind: 'project',
                id: project.id,
                quote_reference: project.project_reference,
                base_quote_reference: project.project_reference,
                title: project.title,
                customer_name: null,
                status: 'Project',
                start_date: null,
                end_date: null,
                estimated_duration_days: 1,
                estimated_duration_minutes: 180,
                project: candidate,
              });
            }}
          />
          {quickAddOpen ? (
            <ScheduleBoardQuickAddDialog
              open
              defaultDate={selectedDate}
              managerOptions={quoteManagerOptions}
              managerLoadError={quoteManagerOptionsError}
              initialInput={quickAddDraft}
              onClose={() => setQuickAddOpen(false)}
              onSubmit={handleQuickAddSubmit}
            />
          ) : null}
        </>
      ) : null}
      {unavailabilityOpen ? (
        <PlantUnavailabilityDialog
          open
          onOpenChange={setUnavailabilityOpen}
          plant={board.resources.plant}
          blocks={board.plant_unavailability}
          defaultDate={weekDates[0] || board.week.start}
          initialInput={plantBlockDraft}
          onSave={handlePlantBlockSave}
          onDelete={handlePlantBlockDelete}
        />
      ) : null}
      <AlertDialog
        open={pendingConflict !== null}
        onOpenChange={(open) => !open && setPendingConflict(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Review scheduling conflict</AlertDialogTitle>
            <AlertDialogDescription>
              This resource is unavailable for the selected visit. A manager can still make
              the assignment and the override will be audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {pendingConflict?.conflicts.map((conflict, index) => (
              <div
                key={`${conflict.code}-${index}`}
                className="rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-sm text-amber-100"
              >
                {conflict.message}
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className={schedulingControlStyles.outline}>Keep current schedule</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void overridePendingConflict()}
              disabled={inFlightMutationKeys.size > 0}
              className={schedulingControlStyles.warning}
            >
              Assign anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingVisitReturn !== null}
        onOpenChange={(open) => {
          if (!open) setPendingVisitReturn(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return this visit to Jobs?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingVisitReturn
                ? `${pendingVisitReturn.target.job.job_reference} · Visit ${pendingVisitReturn.target.visit.sequence_number} will leave the schedule board. ${(pendingVisitReturn.preview?.assignment_count ?? pendingVisitReturn.localAssignmentCount) === 0
                  ? 'It has no resource assignments.'
                  : `${pendingVisitReturn.preview?.assignment_count ?? pendingVisitReturn.localAssignmentCount} ${(pendingVisitReturn.preview?.assignment_count ?? pendingVisitReturn.localAssignmentCount) === 1 ? 'assignment' : 'assignments'} will be permanently removed.`} Other visits for this job will stay scheduled.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className={schedulingControlStyles.outline}
            >
              Keep scheduled
            </AlertDialogCancel>
            <AlertDialogAction
              className={schedulingControlStyles.warning}
              onClick={() => void confirmVisitReturn()}
              disabled={
                pendingVisitReturn != null
                && returningVisitIds.has(pendingVisitReturn.target.visit.id)
              }
            >
              {pendingVisitReturn
                && returningVisitIds.has(pendingVisitReturn.target.visit.id)
                ? 'Returning...'
                : 'Return visit to Jobs'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingRemoveJob !== null}
        onOpenChange={(open) => {
          if (!open && !isRemovingJob) setPendingRemoveJob(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemoveJob?.source_type === 'quote'
                ? 'Remove Quote job from the schedule?'
                : 'Remove Project job from the schedule?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoveJob?.source_type === 'quote'
                ? `This clears the planning date on Quote ${pendingRemoveJob.job_reference} and permanently removes all timed visits, day assignments, employee assignments, and plant assignments. The Quote is not deleted and will return to the Jobs queue.`
                : `This permanently removes only the schedule for ${pendingRemoveJob?.job_reference || 'this Project'}, including all timed visits, day assignments, employee assignments, and plant assignments. The Project Number and its costs remain open and can be scheduled again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={schedulingControlStyles.outline} disabled={isRemovingJob}>Keep job</AlertDialogCancel>
            <AlertDialogAction
              className={schedulingControlStyles.danger}
              onClick={() => void handleRemoveJob()}
              disabled={isRemovingJob}
            >
              {isRemovingJob ? 'Removing...' : 'Remove job'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingDeleteAssignment !== null}
        onOpenChange={(open) => !open && setPendingDeleteAssignment(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              The resource will be removed from this job day. You can assign it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={schedulingControlStyles.outline}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={schedulingControlStyles.danger}
              onClick={() => {
                if (!pendingDeleteAssignment) return;
                void handleDeleteAssignment(pendingDeleteAssignment).finally(() =>
                  setPendingDeleteAssignment(null)
                );
              }}
            >
              Remove assignment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DragDropProvider>
  );
}
