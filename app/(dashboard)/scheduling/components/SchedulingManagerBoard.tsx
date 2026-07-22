'use client';

import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  Accessibility,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from '@dnd-kit/dom';
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
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
  Clock3,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Tractor,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createScheduleAssignment,
  deleteScheduleAssignment,
  fetchSchedulingBoard,
  moveScheduleAssignment,
  SchedulingApiError,
  type CreateAssignmentInput,
} from '@/lib/client/scheduling';
import {
  SCHEDULING_BOARD_VIEWS,
  readSchedulingViewPreference,
  type SchedulingBoardView,
  writeSchedulingViewPreference,
} from '@/lib/config/scheduling-view-preference';
import { cn } from '@/lib/utils/cn';
import { isResourceUnavailableForVisit } from '@/lib/utils/scheduling-availability';
import {
  enumerateScheduleDates,
  formatScheduleDate,
  formatScheduleVisitTime,
  getScheduleVisitDate,
  getSchedulingWeek,
} from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantResource,
  ScheduleVisit,
  SchedulingBoardPayload,
  SchedulingConflict,
} from '@/types/scheduling';
import { PlantUnavailabilityDialog } from './PlantUnavailabilityDialog';
import type { SelectedScheduleResource } from './ScheduleAssignmentDialog';
import { ScheduleJobDialog } from './ScheduleJobDialog';
import { ScheduleVisitDialog } from './ScheduleVisitDialog';
import { SchedulingDateRangeControls } from './SchedulingDateRangeControls';

interface ResourceCardProps {
  resource: SelectedScheduleResource;
  subtitle: string;
  selected: boolean;
  dragEnabled: boolean;
  warning?: string;
  onSelect: () => void;
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

function ResourceCard({
  resource,
  subtitle,
  selected,
  dragEnabled,
  warning,
  onSelect,
}: ResourceCardProps) {
  if (dragEnabled) {
    return (
      <DraggableResourceCard
        resource={resource}
        subtitle={subtitle}
        selected={selected}
        warning={warning}
        onSelect={onSelect}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${selected ? 'Selected' : 'Select'} ${resource.label}`}
      data-testid={`schedule-resource-${resource.type}-${resource.id}`}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border p-2 text-left transition',
        selected
          ? 'border-scheduling bg-scheduling-soft'
          : 'border-border bg-muted/20 hover:border-muted-foreground'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{resource.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
    </button>
  );
}

function DraggableResourceCard({
  resource,
  subtitle,
  selected,
  warning,
  onSelect,
}: Omit<ResourceCardProps, 'dragEnabled'>) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `resource:${resource.type}:${resource.id}`,
    type: 'schedule-resource',
    data: { resource },
  });

  return (
    <div
      ref={ref}
      data-testid={`schedule-resource-${resource.type}-${resource.id}`}
      className={cn(
        'flex w-full cursor-grab items-center gap-2 rounded-lg border p-2 text-left transition active:cursor-grabbing',
        selected
          ? 'border-scheduling bg-scheduling-soft'
          : 'border-border bg-muted/20 hover:border-muted-foreground',
        isDragging && 'opacity-40'
      )}
    >
      <button
        ref={handleRef}
        type="button"
        className="touch-none rounded p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scheduling"
        aria-label={`Drag ${resource.label} to a visit`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${selected ? 'Selected' : 'Select'} ${resource.label}`}
        className="min-w-0 flex flex-1 items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{resource.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
      </button>
    </div>
  );
}

interface AssignmentChipProps {
  assignment: ScheduleAssignment;
  onDelete: (assignment: ScheduleAssignment) => void;
  dragScope?: 'desktop' | 'mobile';
}

function AssignmentChip({
  assignment,
  onDelete,
  dragScope = 'desktop',
}: AssignmentChipProps) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `${dragScope}:assignment:${assignment.resource_type}:${assignment.id}`,
    type: 'schedule-assignment',
    data: { assignment },
  });
  const label =
    assignment.resource_type === 'employee'
      ? assignment.employee?.full_name || 'Employee'
      : assignment.plant?.nickname || assignment.plant?.plant_id || 'Plant';
  const hasConflict = assignment.conflicts.length > 0;

  return (
    <div
      ref={ref}
      className={cn(
        'group flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
        assignment.resource_type === 'employee'
          ? 'border-sky-500/35 bg-sky-500/10 text-sky-100'
          : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100',
        hasConflict && 'border-amber-400/70 bg-amber-500/10',
        isDragging && 'opacity-40'
      )}
      title={hasConflict ? assignment.conflicts.map((conflict) => conflict.message).join('\n') : label}
    >
      <button
        ref={handleRef}
        type="button"
        className="touch-none rounded p-1 opacity-70 hover:bg-black/20 hover:opacity-100"
        aria-label={`Move ${label} to another visit`}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {assignment.resource_type === 'employee' ? (
        <UserRound className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Tractor className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hasConflict ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" /> : null}
      {assignment.conflict_override ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-label="Conflict overridden" />
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(assignment);
        }}
        className="rounded p-0.5 opacity-70 hover:bg-black/20 hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

interface DayCellProps {
  job: ScheduleJob;
  date: string;
  visits: ScheduleVisit[];
  assignments: ScheduleAssignment[];
  activeVisitId: string | null;
  onActivateVisit: (visit: ScheduleVisit) => void;
  onAddVisit: () => void;
  onEditVisit: (visit: ScheduleVisit) => void;
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
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
  assignmentDragScope?: 'desktop' | 'mobile';
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
  onDeleteAssignment,
  assignmentDragScope = 'desktop',
}: VisitCardProps) {
  const workDate = getScheduleVisitDate(visit.starts_at);
  const { ref, isDropTarget } = useDroppable({
    id: isDropEnabled ? `visit:${visit.id}` : `mobile-visit:${visit.id}`,
    type: 'schedule-visit',
    accept: ['schedule-resource', 'schedule-assignment'],
    disabled: !isDropEnabled || visit.status === 'cancelled',
    data: { jobId: job.id, visitId: visit.id, workDate },
  });

  return (
    <div
      ref={ref}
      data-schedule-visit-card
      data-testid={`schedule-visit-${visit.id}`}
      style={style}
      className={cn(
        'rounded-md border border-border bg-card/80 p-1.5',
        className,
        visit.status === 'cancelled' && 'opacity-60',
        isActiveTarget && 'border-scheduling ring-1 ring-scheduling',
        isDropTarget && 'border-scheduling bg-scheduling-soft ring-2 ring-scheduling'
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={visit.status === 'cancelled' ? onEdit : onActivate}
          className="min-w-0 text-left text-xs font-semibold text-foreground hover:text-scheduling"
          aria-label={
            visit.status === 'cancelled'
              ? `Edit cancelled visit ${visit.sequence_number} for ${job.job_reference}`
              : `Select visit ${visit.sequence_number} for ${job.job_reference}`
          }
        >
          <span className="flex items-center gap-1">
            <Clock3 className="h-3 w-3 shrink-0" />
            {formatScheduleVisitTime(visit.starts_at)}–{formatScheduleVisitTime(visit.ends_at)}
            {visit.status !== 'planned' ? ` · ${visit.status.replace('_', ' ')}` : ''}
          </span>
          {visit.title ? <span className="mt-0.5 block truncate font-normal text-muted-foreground">{visit.title}</span> : null}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Edit visit ${visit.sequence_number}`}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-1">
        {assignments.map((assignment) => (
          <AssignmentChip
            key={`${assignment.resource_type}-${assignment.id}`}
            assignment={assignment}
            onDelete={onDeleteAssignment}
            dragScope={assignmentDragScope}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  job,
  date,
  visits,
  assignments,
  activeVisitId,
  onActivateVisit,
  onAddVisit,
  onEditVisit,
  onDeleteAssignment,
}: DayCellProps) {
  const active = date >= job.start_date && date <= job.end_date;
  const dayVisits = visits.filter(
    (visit) => getScheduleVisitDate(visit.starts_at) === date
  );
  const legacyAssignments = assignments.filter((assignment) => !assignment.visit_id);

  return (
    <div
      data-testid={`schedule-cell-${job.id}-${date}`}
      className={cn(
        'flex min-h-24 flex-col border-l border-border p-1.5',
        active
          ? 'bg-muted/10'
          : 'bg-muted/40 opacity-45'
      )}
    >
      <div className="space-y-1">
        {legacyAssignments.map((assignment) => (
          <AssignmentChip
            key={`${assignment.resource_type}-${assignment.id}`}
            assignment={assignment}
            onDelete={onDeleteAssignment}
            dragScope="desktop"
          />
        ))}
        {dayVisits.map((visit) => (
          <VisitCard
            key={visit.id}
            job={job}
            visit={visit}
            assignments={assignments.filter((assignment) => assignment.visit_id === visit.id)}
            isDropEnabled
            isActiveTarget={activeVisitId === visit.id}
            onActivate={() => onActivateVisit(visit)}
            onEdit={() => onEditVisit(visit)}
            onDeleteAssignment={onDeleteAssignment}
          />
        ))}
      </div>
      {active ? (
        <button
          type="button"
          onClick={onAddVisit}
          className="mt-auto flex w-full items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-scheduling transition hover:bg-scheduling-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scheduling"
          aria-label={`Add visit to ${job.job_reference} on ${date}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add visit
        </button>
      ) : (
        <span className="m-auto px-2 text-center text-[11px] text-muted-foreground">
          Outside job dates
        </span>
      )}
    </div>
  );
}

const DAILY_TIMELINE_DEFAULT_START_HOUR = 5;
const DAILY_TIMELINE_DEFAULT_END_HOUR = 20;
const DAILY_TIMELINE_HOUR_WIDTH = 96;
const DAILY_TIMELINE_VISIT_STYLE = {
  backgroundColor: '#334155',
} satisfies CSSProperties;

interface DailyTimelineRange {
  startHour: number;
  endHour: number;
  width: number;
}

interface DailyTimelineCellProps extends DayCellProps {
  range: DailyTimelineRange;
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
    width: (endHour - startHour) * DAILY_TIMELINE_HOUR_WIDTH,
  };
}

function DailyTimelineHeader({
  date,
  range,
}: {
  date: string;
  range: DailyTimelineRange;
}) {
  const hours = Array.from(
    { length: range.endHour - range.startHour + 1 },
    (_, index) => range.startHour + index
  );

  return (
    <div
      className="relative h-16 border-l border-border bg-muted/60"
      style={{ width: range.width }}
      data-testid="schedule-daily-timeline-header"
    >
      <p className="absolute left-3 top-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {format(parseISO(date), 'EEEE d MMMM')}
      </p>
      {hours.map((hour, index) => (
        <div
          key={hour}
          data-testid={`schedule-timeline-hour-${hour}`}
          className={cn(
            'absolute bottom-0 h-7 border-l border-border px-2 pt-1 text-xs font-medium tabular-nums text-foreground',
            index === hours.length - 1 && 'border-r'
          )}
          style={{
            left: index * DAILY_TIMELINE_HOUR_WIDTH,
            width: index === hours.length - 1 ? 1 : DAILY_TIMELINE_HOUR_WIDTH,
          }}
        >
          <span className={cn(index === hours.length - 1 && '-translate-x-full')}>
            {String(hour).padStart(2, '0')}:00
          </span>
        </div>
      ))}
    </div>
  );
}

function DailyTimelineCell({
  job,
  date,
  visits,
  assignments,
  range,
  activeVisitId,
  onActivateVisit,
  onAddVisit,
  onEditVisit,
  onDeleteAssignment,
}: DailyTimelineCellProps) {
  const dayVisits = visits
    .filter((visit) => getScheduleVisitDate(visit.starts_at) === date)
    .sort((first, second) => first.starts_at.localeCompare(second.starts_at));
  const legacyAssignments = assignments.filter((assignment) => !assignment.visit_id);
  const legacyHeight = legacyAssignments.length > 0 ? 48 : 0;
  const timelineLayout = dayVisits.reduce<{
    placements: Array<{
      visit: ScheduleVisit;
      assignments: ScheduleAssignment[];
      top: number;
      height: number;
    }>;
    nextTop: number;
  }>((layout, visit) => {
    const visitAssignments = assignments.filter(
      (assignment) => assignment.visit_id === visit.id
    );
    const height = Math.max(96, 64 + visitAssignments.length * 30);

    return {
      placements: [
        ...layout.placements,
        {
          visit,
          assignments: visitAssignments,
          top: layout.nextTop,
          height,
        },
      ],
      nextTop: layout.nextTop + height + 8,
    };
  }, { placements: [], nextTop: 8 + legacyHeight });
  const rowHeight = Math.max(112, timelineLayout.nextTop);
  const rangeStartMinutes = range.startHour * 60;

  return (
    <div
      data-testid={`schedule-cell-${job.id}-${date}`}
      data-timeline-start={`${String(range.startHour).padStart(2, '0')}:00`}
      data-timeline-end={`${String(range.endHour).padStart(2, '0')}:00`}
      className="relative border-l border-border bg-muted/10"
      style={{
        width: range.width,
        minHeight: rowHeight,
        backgroundImage:
          'linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px)',
        backgroundSize: `${DAILY_TIMELINE_HOUR_WIDTH}px 100%`,
      }}
    >
      {legacyAssignments.length > 0 ? (
        <div className="absolute inset-x-2 top-2 flex h-10 items-center gap-2 overflow-x-auto rounded-md border border-dashed border-border bg-card/90 px-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
            Untimed
          </span>
          {legacyAssignments.map((assignment) => (
            <AssignmentChip
              key={`${assignment.resource_type}-${assignment.id}`}
              assignment={assignment}
              onDelete={onDeleteAssignment}
              dragScope="desktop"
            />
          ))}
        </div>
      ) : null}
      {timelineLayout.placements.map(({ visit, assignments: visitAssignments, top, height }) => {
        const startsAt = Math.max(
          rangeStartMinutes,
          getScheduleTimeMinutes(visit.starts_at)
        );
        const endsAt = Math.min(
          range.endHour * 60,
          getScheduleTimeMinutes(visit.ends_at)
        );
        const left =
          ((startsAt - rangeStartMinutes) / 60) * DAILY_TIMELINE_HOUR_WIDTH + 4;
        const availableWidth = range.width - left - 4;
        const width = Math.min(
          availableWidth,
          Math.max(
            120,
            ((Math.max(endsAt, startsAt + 15) - startsAt) / 60)
              * DAILY_TIMELINE_HOUR_WIDTH
              - 8
          )
        );

        return (
          <div
            key={visit.id}
            className="absolute"
            style={{ left, top, width, height }}
            data-testid={`schedule-timeline-visit-${visit.id}`}
          >
            <VisitCard
              job={job}
              visit={visit}
              assignments={visitAssignments}
              className="h-full overflow-hidden border-slate-500 shadow-lg shadow-black/40"
              style={DAILY_TIMELINE_VISIT_STYLE}
              isDropEnabled
              isActiveTarget={activeVisitId === visit.id}
              onActivate={() => onActivateVisit(visit)}
              onEdit={() => onEditVisit(visit)}
              onDeleteAssignment={onDeleteAssignment}
            />
          </div>
        );
      })}
      {dayVisits.length === 0 ? (
        <button
          type="button"
          onClick={onAddVisit}
          className="absolute left-4 top-4 flex items-center gap-1 rounded-md border border-dashed border-border bg-card/80 px-3 py-2 text-xs font-medium text-scheduling hover:border-scheduling hover:bg-scheduling-soft"
          aria-label={`Add visit to ${job.job_reference} on ${date}`}
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

function flattenConflictMessages(payload: Record<string, unknown>): SchedulingConflict[] {
  const byDate = payload.conflicts_by_date;
  if (!byDate || typeof byDate !== 'object') return [];
  return Object.values(byDate as Record<string, SchedulingConflict[]>).flat();
}

export function SchedulingManagerBoard({ userId }: SchedulingManagerBoardProps) {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(() => formatScheduleDate(new Date()));
  const [view, setView] = useState<SchedulingBoardView>(() =>
    readSchedulingViewPreference(userId)
  );
  const [resourceType, setResourceType] = useState<'employee' | 'plant'>('employee');
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
  const [draggedResource, setDraggedResource] = useState<SelectedScheduleResource | null>(null);
  const [draggedAssignment, setDraggedAssignment] = useState<ScheduleAssignment | null>(null);
  const [activeVisitTarget, setActiveVisitTarget] = useState<ActiveVisitTarget | null>(null);
  const [resourceAvailabilityView, setResourceAvailabilityView] =
    useState<'available' | 'unavailable' | 'all'>('available');
  const [pendingConflict, setPendingConflict] = useState<PendingAssignmentConflict | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [visitTarget, setVisitTarget] = useState<{
    job: ScheduleJob;
    visit: ScheduleVisit | null;
    date: string;
  } | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);
  const [unavailabilityOpen, setUnavailabilityOpen] = useState(false);
  const [pendingDeleteAssignment, setPendingDeleteAssignment] = useState<ScheduleAssignment | null>(null);

  const weekStart = getSchedulingWeek(selectedDate).start;
  const boardQuery = useQuery({
    queryKey: ['scheduling-board', weekStart],
    queryFn: () => fetchSchedulingBoard(weekStart),
  });
  const board = boardQuery.data;
  const weekDates = useMemo(
    () => {
      if (!board) return [];
      if (view === SCHEDULING_BOARD_VIEWS.daily) return [selectedDate];
      return enumerateScheduleDates(board.week.start, board.week.end);
    },
    [board, selectedDate, view]
  );
  const dailyTimelineRange = useMemo(
    () => getDailyTimelineRange(board?.visits || [], selectedDate),
    [board?.visits, selectedDate]
  );

  const teams = useMemo(() => {
    const values = new Map<string, string>();
    for (const employee of board?.resources.employees || []) {
      if (employee.team_id) values.set(employee.team_id, employee.team_name || 'Unnamed team');
    }
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [board]);

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
  const hasActiveJobFilters =
    Boolean(jobSearch.trim()) || jobFilters.ready || jobFilters.tags.length > 0;
  const assignmentsByCell = useMemo(() => {
    const grouped = new Map<string, ScheduleAssignment[]>();
    for (const assignment of board?.assignments || []) {
      const key = `${assignment.job_id}:${assignment.work_date}`;
      const current = grouped.get(key);
      if (current) current.push(assignment);
      else grouped.set(key, [assignment]);
    }
    return grouped;
  }, [board]);

  function assignmentsFor(jobId: string, date: string): ScheduleAssignment[] {
    return assignmentsByCell.get(`${jobId}:${date}`) || [];
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['scheduling-board'] });
  }

  function setBoardData(
    updater: (current: SchedulingBoardPayload) => SchedulingBoardPayload
  ) {
    queryClient.setQueryData<SchedulingBoardPayload>(
      ['scheduling-board', weekStart],
      (current) => current ? updater(current) : current
    );
  }

  function createOptimisticAssignment(
    target: ActiveVisitTarget,
    resource: SelectedScheduleResource
  ): ScheduleAssignment {
    const now = new Date().toISOString();
    const base = {
      id: `optimistic-${resource.type}-${resource.id}-${target.visit.id}`,
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
    if (isAssigning) return;
    const input: CreateAssignmentInput = {
      job_id: target.job.id,
      visit_id: target.visit.id,
      resource_type: resource.type,
      resource_id: resource.id,
    };
    const previous = queryClient.getQueryData<SchedulingBoardPayload>([
      'scheduling-board',
      weekStart,
    ]);
    const optimisticAssignment = createOptimisticAssignment(target, resource);
    setBoardData((current) => ({
      ...current,
      assignments: [...current.assignments, optimisticAssignment],
    }));
    setSelectedResource(null);
    setIsAssigning(true);

    try {
      await createScheduleAssignment(input);
      toast.success(`${resource.label} assigned`);
      await refresh();
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(['scheduling-board', weekStart], previous);
      }
      if (error instanceof SchedulingApiError && error.status === 409 && error.payload.conflicts_by_date) {
        setPendingConflict({
          input,
          conflicts: flattenConflictMessages(error.payload),
        });
      } else {
        toast.error(error instanceof Error ? error.message : 'Unable to create assignment');
      }
    } finally {
      setIsAssigning(false);
    }
  }

  async function moveAssignmentToVisit(
    assignment: ScheduleAssignment,
    target: ActiveVisitTarget
  ) {
    if (isAssigning || assignment.visit_id === target.visit.id) return;
    const previous = queryClient.getQueryData<SchedulingBoardPayload>([
      'scheduling-board',
      weekStart,
    ]);
    setBoardData((current) => ({
      ...current,
      assignments: current.assignments.map((item) =>
        item.id === assignment.id
          ? {
              ...item,
              job_id: target.job.id,
              work_date: getScheduleVisitDate(target.visit.starts_at),
              visit_id: target.visit.id,
              visit: target.visit,
            }
          : item
      ),
    }));
    setIsAssigning(true);

    try {
      await moveScheduleAssignment(assignment, target.visit.id);
      toast.success('Assignment moved');
      await refresh();
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(['scheduling-board', weekStart], previous);
      }
      if (error instanceof SchedulingApiError && error.status === 409 && error.payload.conflicts_by_date) {
        setPendingConflict({
          assignment,
          input: {
            job_id: target.job.id,
            visit_id: target.visit.id,
            resource_type: assignment.resource_type,
            resource_id:
              assignment.resource_type === 'employee'
                ? assignment.profile_id
                : assignment.plant_id,
          },
          conflicts: flattenConflictMessages(error.payload),
        });
      } else {
        toast.error(error instanceof Error ? error.message : 'Unable to move assignment');
      }
    } finally {
      setIsAssigning(false);
    }
  }

  async function overridePendingConflict() {
    if (!pendingConflict || isAssigning) return;
    setIsAssigning(true);
    try {
      if (pendingConflict.assignment && pendingConflict.input.visit_id) {
        await moveScheduleAssignment(
          pendingConflict.assignment,
          pendingConflict.input.visit_id,
          true
        );
        toast.success('Assignment moved with conflict override');
      } else {
        await createScheduleAssignment({
          ...pendingConflict.input,
          override_conflicts: true,
        });
        toast.success('Resource assigned with conflict override');
      }
      setPendingConflict(null);
      setSelectedResource(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to override conflict');
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleDeleteAssignment(assignment: ScheduleAssignment) {
    const previous = queryClient.getQueryData<SchedulingBoardPayload>([
      'scheduling-board',
      weekStart,
    ]);
    setBoardData((current) => ({
      ...current,
      assignments: current.assignments.filter((item) => item.id !== assignment.id),
    }));
    try {
      await deleteScheduleAssignment(assignment.id, assignment.resource_type);
      toast.success('Assignment removed', {
        action: {
          label: 'Undo',
          onClick: () => {
            void createScheduleAssignment({
              job_id: assignment.job_id,
              visit_id: assignment.visit_id || undefined,
              resource_type: assignment.resource_type,
              resource_id:
                assignment.resource_type === 'employee'
                  ? assignment.profile_id
                  : assignment.plant_id,
              work_dates: assignment.visit_id ? undefined : [assignment.work_date],
              notes: assignment.notes,
              override_conflicts: assignment.conflict_override,
            })
              .then(() => refresh())
              .then(() => toast.success('Assignment restored'))
              .catch((error) =>
                toast.error(error instanceof Error ? error.message : 'Unable to restore assignment')
              );
          },
        },
      });
      void refresh();
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(['scheduling-board', weekStart], previous);
      }
      toast.error(error instanceof Error ? error.message : 'Unable to remove assignment');
    }
  }

  function visitsFor(jobId: string): ScheduleVisit[] {
    return board?.visits.filter((visit) => visit.job_id === jobId) || [];
  }

  function activateVisit(job: ScheduleJob, visit: ScheduleVisit) {
    setActiveVisitTarget({ job, visit });
  }

  function handleResourceSelect(resource: SelectedScheduleResource) {
    if (activeVisitTarget) {
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

  function openVisitEditor(job: ScheduleJob, date: string, visit: ScheduleVisit | null = null) {
    setVisitTarget({ job, visit, date });
  }

  function handleViewChange(nextView: SchedulingBoardView) {
    setView(nextView);
    writeSchedulingViewPreference(userId, nextView);
  }

  if (boardQuery.isLoading) return <PageLoader message="Loading scheduling board..." />;
  if (boardQuery.isError || !board) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="py-10 text-center">
          <p className="text-red-300">
            {boardQuery.error instanceof Error ? boardQuery.error.message : 'Unable to load the board.'}
          </p>
          <Button className="mt-4" variant="outline" onClick={() => void boardQuery.refetch()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <DragDropProvider
      sensors={[
        PointerSensor.configure({
          activationConstraints(event) {
            return event.pointerType === 'touch'
              ? [new PointerActivationConstraints.Delay({ value: 180, tolerance: 10 })]
              : [new PointerActivationConstraints.Distance({ value: 6 })];
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
              if (resource) return `Picked up ${resource.label}.`;
              if (assignment) return 'Picked up an existing assignment.';
              return 'Started dragging.';
            },
            dragover({ operation: { source, target } }: DndAnnouncementEvent) {
              const resource = source?.data?.resource as SelectedScheduleResource | undefined;
              const data = target?.data as { workDate?: string } | undefined;
              return resource && data?.workDate
                ? `${resource.label} is over ${format(parseISO(data.workDate), 'EEEE d MMMM')}.`
                : undefined;
            },
            dragend({ operation: { source, target }, canceled }: DndAnnouncementEvent) {
              if (canceled) return 'Drag cancelled.';
              const resource = source?.data?.resource as SelectedScheduleResource | undefined;
              const assignment = source?.data?.assignment as ScheduleAssignment | undefined;
              if (resource && target) return `${resource.label} was dropped on a visit.`;
              if (assignment && target) return 'Assignment was dropped on a visit.';
              return 'Nothing was assigned.';
            },
          },
        }),
      ]}
      onDragStart={(event) => {
        const resource = event.operation.source?.data?.resource as SelectedScheduleResource | undefined;
        const assignment = event.operation.source?.data?.assignment as ScheduleAssignment | undefined;
        if (resource) setSelectedResource(resource);
        setDraggedResource(resource || null);
        setDraggedAssignment(assignment || null);
      }}
      onDragEnd={(event) => {
        const sourceResource = event.operation.source?.data?.resource as SelectedScheduleResource | undefined;
        const sourceAssignment = event.operation.source?.data?.assignment as ScheduleAssignment | undefined;
        const targetData = event.operation.target?.data as { jobId?: string; visitId?: string } | undefined;
        setDraggedResource(null);
        setDraggedAssignment(null);
        if (event.canceled || (!sourceResource && !sourceAssignment)) return;
        if (!targetData?.jobId || !targetData.visitId) {
          toast.info('Drop onto a timed visit.');
          return;
        }
        const job = board.jobs.find((item) => item.id === targetData.jobId);
        const visit = board.visits.find((item) => item.id === targetData.visitId);
        if (job && visit) {
          const target = { job, visit };
          setActiveVisitTarget(target);
          if (sourceResource) void assignResource(target, sourceResource);
          else if (sourceAssignment) void moveAssignmentToVisit(sourceAssignment, target);
        } else {
          toast.error('That job is no longer available. Refresh the board and try again.');
        }
      }}
    >
      <div className="space-y-4" onClick={handleBoardClick}>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/70 p-4 xl:flex-row xl:items-center xl:justify-between">
          <SchedulingDateRangeControls
            selectedDate={selectedDate}
            view={view}
            onDateChange={setSelectedDate}
            onViewChange={handleViewChange}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setUnavailabilityOpen(true)}>
              <CalendarOff className="mr-2 h-4 w-4" />
              Plant availability
            </Button>
            <Button
              onClick={() => {
                setEditingJob(null);
                setJobDialogOpen(true);
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add job
            </Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit border-border xl:sticky xl:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Tabs value={resourceType} onValueChange={(value) => setResourceType(value as 'employee' | 'plant')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="employee">Employees</TabsTrigger>
                  <TabsTrigger value="plant">Plant</TabsTrigger>
                </TabsList>
              </Tabs>
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
                      className="h-7 px-2"
                      aria-label="Clear selected visit"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    Tap a resource or drag its handle onto this or another visit.
                  </p>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
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
                  <TabsTrigger value="available" className="whitespace-nowrap px-0.5 text-[10px] leading-none tracking-tight">
                    Available ({resourceType === 'employee' ? availableEmployees.length : availablePlant.length})
                  </TabsTrigger>
                  <TabsTrigger value="unavailable" className="whitespace-nowrap px-0.5 text-[10px] leading-none tracking-tight">
                    Unavailable ({resourceType === 'employee' ? unavailableEmployees.length : unavailablePlant.length})
                  </TabsTrigger>
                  <TabsTrigger value="all" className="whitespace-nowrap px-0.5 text-[10px] leading-none tracking-tight">
                    All ({resourceType === 'employee' ? matchingEmployees.length : matchingPlant.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {resourceType === 'employee' ? (
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
              {selectedResource ? (
                <div className="flex items-center justify-between rounded-md border border-scheduling/40 bg-scheduling-soft p-2 text-xs">
                  <span className="truncate">Selected: {selectedResource.label}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedResource(null)} className="h-6 px-1">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null}
              <ScrollArea className="h-[420px] pr-3" data-mobile-scroll-lock="true">
                <div className="space-y-2">
                  {resourceType === 'employee'
                    ? filteredEmployees.map((employee) => {
                        const resource = resourceFromEmployee(employee);
                        return (
                          <ResourceCard
                            key={employee.id}
                            resource={resource}
                            subtitle={employee.team_name || employee.employee_id || 'No team'}
                            warning={
                              activeVisitTarget
                              && isResourceUnavailableForVisit(
                                { type: 'employee', id: employee.id },
                                board.assignments,
                                activeVisitTarget.visit
                              )
                                ? 'Already assigned during this visit'
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
                        return (
                          <ResourceCard
                            key={plant.id}
                            resource={resource}
                            subtitle={[plant.make, plant.model, plant.status].filter(Boolean).join(' · ')}
                            warning={
                              activeVisitTarget
                              && isResourceUnavailableForVisit(
                                { type: 'plant', id: plant.id },
                                board.assignments,
                                activeVisitTarget.visit
                              )
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
                  {(resourceType === 'employee' ? filteredEmployees : filteredPlant).length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                      No {resourceType === 'employee' ? 'employees' : 'plant'} match these filters.
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-border">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>
                  {view === SCHEDULING_BOARD_VIEWS.daily ? 'Daily' : 'Weekly'} job board
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
              <div className="flex flex-wrap items-center gap-2" aria-label="Job classification filters">
                <Button
                  type="button"
                  size="sm"
                  variant={jobFilters.ready ? 'default' : 'outline'}
                  aria-pressed={jobFilters.ready}
                  onClick={() => void setJobFilters({ ready: !jobFilters.ready })}
                >
                  Ready for drop-on
                </Button>
                {(board.tags || []).map((tag) => {
                  const isSelected = jobFilters.tags.includes(tag.id);
                  return (
                    <Button
                      key={tag.id}
                      type="button"
                      size="sm"
                      variant={isSelected ? 'secondary' : 'outline'}
                      aria-pressed={isSelected}
                      onClick={() =>
                        void setJobFilters({
                          tags: isSelected
                            ? jobFilters.tags.filter((id) => id !== tag.id)
                            : [...jobFilters.tags, tag.id],
                        })
                      }
                    >
                      {tag.name}
                    </Button>
                  );
                })}
                {(jobFilters.ready || jobFilters.tags.length > 0 || jobSearch) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void setJobFilters({ q: '', tags: [], ready: false })}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground xl:hidden">
                Select a visit, then tap an available resource to assign it immediately.
              </p>
              <p className="hidden text-sm text-muted-foreground xl:block">
                Drag a resource handle onto a timed visit, or select the visit and tap a resource.
              </p>
            </CardHeader>
            <CardContent>
              <div
                className="scrollbar-hidden hidden overflow-x-auto rounded-lg border border-border overscroll-x-contain md:block"
                data-testid={view === SCHEDULING_BOARD_VIEWS.daily ? 'schedule-daily-timeline' : undefined}
                aria-label={view === SCHEDULING_BOARD_VIEWS.daily ? 'Daily schedule timeline' : undefined}
              >
                <div
                  className={view === SCHEDULING_BOARD_VIEWS.daily ? undefined : 'min-w-[1260px]'}
                  style={
                    view === SCHEDULING_BOARD_VIEWS.daily
                      ? { minWidth: 240 + dailyTimelineRange.width }
                      : undefined
                  }
                >
                  <div
                    className={cn(
                      'grid bg-muted/60',
                      view !== SCHEDULING_BOARD_VIEWS.daily
                        && 'grid-cols-[240px_repeat(7,minmax(140px,1fr))]'
                    )}
                    style={
                      view === SCHEDULING_BOARD_VIEWS.daily
                        ? { gridTemplateColumns: `240px ${dailyTimelineRange.width}px` }
                        : undefined
                    }
                  >
                    <div className="sticky left-0 z-20 border-r border-border bg-muted/95 p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                      <span>Job</span>
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
                      />
                    ) : (
                      weekDates.map((date) => (
                        <div key={date} className="border-l border-border p-3 text-center">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{format(parseISO(date), 'EEE')}</p>
                          <p className="text-sm font-semibold text-foreground">{format(parseISO(date), 'd MMM')}</p>
                        </div>
                      ))
                    )}
                  </div>
                  {filteredJobs.map((job) => (
                    <div
                      key={job.id}
                      className={cn(
                        'grid border-t border-border',
                        view !== SCHEDULING_BOARD_VIEWS.daily
                          && 'grid-cols-[240px_repeat(7,minmax(140px,1fr))]'
                      )}
                      style={
                        view === SCHEDULING_BOARD_VIEWS.daily
                          ? { gridTemplateColumns: `240px ${dailyTimelineRange.width}px` }
                          : undefined
                      }
                    >
                      <div className="sticky left-0 z-10 border-r border-border bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-semibold text-foreground">{job.job_reference}</span>
                              {job.source_type === 'sample' ? <Badge variant="outline">Sample</Badge> : null}
                              {job.source_type === 'quote' ? <Badge variant="outline">Quote</Badge> : null}
                            </div>
                            <p className="truncate text-sm text-muted-foreground">
                              {job.customer_name ? `${job.customer_name} · ` : ''}{job.title}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{job.site_address || 'No site'}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {job.is_drop_on_ready ? (
                                <Badge className="bg-emerald-500/15 text-emerald-300">
                                  Drop-on ready
                                </Badge>
                              ) : null}
                              {(job.tags || []).map((tag) => (
                                <Badge key={tag.id} variant="secondary">{tag.name}</Badge>
                              ))}
                            </div>
                            {job.estimated_duration_minutes ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Estimated {Math.round(job.estimated_duration_minutes / 60 * 10) / 10} hours
                              </p>
                            ) : null}
                            {view === SCHEDULING_BOARD_VIEWS.daily ? (
                              <button
                                type="button"
                                onClick={() => openVisitEditor(job, selectedDate)}
                                className="mt-3 flex items-center gap-1 text-xs font-medium text-scheduling hover:underline"
                                aria-label={`Add visit to ${job.job_reference} on ${selectedDate}`}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add visit
                              </button>
                            ) : null}
                          </div>
                          <div className="flex items-center">
                            {job.source_type === 'quote' && job.quote_id ? (
                              <Button asChild size="sm" variant="ghost" className="h-7 w-7 p-0">
                                <Link
                                  href={`/quotes/overview/${encodeURIComponent(job.job_reference)}`}
                                  aria-label={`Open Quote ${job.job_reference}`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setEditingJob(job);
                                setJobDialogOpen(true);
                              }}
                              aria-label={`Edit ${job.job_reference}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      {view === SCHEDULING_BOARD_VIEWS.daily ? (
                        <DailyTimelineCell
                          key={`${job.id}-${selectedDate}`}
                          job={job}
                          date={selectedDate}
                          visits={visitsFor(job.id)}
                          assignments={assignmentsFor(job.id, selectedDate)}
                          range={dailyTimelineRange}
                          activeVisitId={activeVisitTarget?.visit.id || null}
                          onActivateVisit={(visit) => activateVisit(job, visit)}
                          onAddVisit={() => openVisitEditor(job, selectedDate)}
                          onEditVisit={(visit) => openVisitEditor(job, selectedDate, visit)}
                          onDeleteAssignment={setPendingDeleteAssignment}
                        />
                      ) : (
                        weekDates.map((date) => (
                          <DayCell
                            key={`${job.id}-${date}`}
                            job={job}
                            date={date}
                            visits={visitsFor(job.id)}
                            assignments={assignmentsFor(job.id, date)}
                            activeVisitId={activeVisitTarget?.visit.id || null}
                            onActivateVisit={(visit) => activateVisit(job, visit)}
                            onAddVisit={() => openVisitEditor(job, date)}
                            onEditVisit={(visit) => openVisitEditor(job, date, visit)}
                            onDeleteAssignment={setPendingDeleteAssignment}
                          />
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 md:hidden" data-mobile-scroll-lock="true">
                {filteredJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-foreground">{job.job_reference}</p>
                          {job.source_type === 'quote' ? <Badge variant="outline">Quote</Badge> : null}
                          {job.is_drop_on_ready ? (
                            <Badge className="bg-emerald-500/15 text-emerald-300">Drop-on ready</Badge>
                          ) : null}
                          {(job.tags || []).map((tag) => (
                            <Badge key={tag.id} variant="secondary">{tag.name}</Badge>
                          ))}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {job.customer_name ? `${job.customer_name} · ` : ''}{job.title}
                        </p>
                      </div>
                      <div className="flex items-center">
                        {job.source_type === 'quote' ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/quotes/overview/${encodeURIComponent(job.job_reference)}`}>
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => { setEditingJob(job); setJobDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {weekDates
                        .filter((date) => date >= job.start_date && date <= job.end_date)
                        .map((date) => (
                          <div
                            key={date}
                            className="rounded-md border border-border p-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold uppercase text-muted-foreground">
                                {format(parseISO(date), 'EEEE d MMM')}
                              </span>
                              <button
                                type="button"
                                onClick={() => openVisitEditor(job, date)}
                                className="flex items-center gap-1 text-xs font-medium text-scheduling"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add visit
                              </button>
                            </div>
                            <div className="space-y-1">
                              {assignmentsFor(job.id, date).filter((assignment) => !assignment.visit_id).map((assignment) => (
                                <AssignmentChip
                                  key={`${assignment.resource_type}-${assignment.id}`}
                                  assignment={assignment}
                                  onDelete={setPendingDeleteAssignment}
                                  dragScope="mobile"
                                />
                              ))}
                              {visitsFor(job.id)
                                .filter((visit) => getScheduleVisitDate(visit.starts_at) === date)
                                .map((visit) => (
                                  <VisitCard
                                    key={visit.id}
                                    job={job}
                                    visit={visit}
                                    assignments={assignmentsFor(job.id, date).filter((assignment) => assignment.visit_id === visit.id)}
                                    isDropEnabled={false}
                                    isActiveTarget={activeVisitTarget?.visit.id === visit.id}
                                    onActivate={() => activateVisit(job, visit)}
                                    onEdit={() => openVisitEditor(job, date, visit)}
                                    onDeleteAssignment={setPendingDeleteAssignment}
                                    assignmentDragScope="mobile"
                                  />
                                ))}
                              {assignmentsFor(job.id, date).length === 0
                                && visitsFor(job.id).every((visit) => getScheduleVisitDate(visit.starts_at) !== date) ? (
                                <span className="text-xs text-muted-foreground">No visits yet</span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>

              {filteredJobs.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">
                      {!hasActiveJobFilters
                        ? `No jobs scheduled for this ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}`
                        : 'No jobs match these filters'}
                    </p>
                    <p className="mt-1 text-sm">
                      {!hasActiveJobFilters
                        ? `Add a job that overlaps this ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}, or choose another ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}.`
                        : 'Clear or change the job filters to see more results.'}
                    </p>
                  </div>
                  {!hasActiveJobFilters ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingJob(null);
                        setJobDialogOpen(true);
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add this {view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}&apos;s first job
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <DragOverlay>
        {draggedResource ? (
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

      <ScheduleVisitDialog
        open={visitTarget !== null}
        onOpenChange={(open) => !open && setVisitTarget(null)}
        job={visitTarget?.job || null}
        visit={visitTarget?.visit || null}
        defaultDate={visitTarget?.date || board.week.start}
        onSaved={() => void refresh()}
      />
      <ScheduleJobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        job={editingJob}
        defaultDate={weekDates[0] || board.week.start}
        onSaved={() => void refresh()}
      />
      <PlantUnavailabilityDialog
        open={unavailabilityOpen}
        onOpenChange={setUnavailabilityOpen}
        plant={board.resources.plant}
        blocks={board.plant_unavailability}
        defaultDate={weekDates[0] || board.week.start}
        onSaved={() => void refresh()}
      />
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
            <AlertDialogCancel>Keep current schedule</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void overridePendingConflict()}
              disabled={isAssigning}
              className="bg-amber-600 text-white hover:bg-amber-500"
            >
              Assign anyway
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500"
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
