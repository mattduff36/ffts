'use client';

import { useEffect, useMemo, useState } from 'react';
import { Accessibility } from '@dnd-kit/dom';
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
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
import { fetchSchedulingBoard, deleteScheduleAssignment } from '@/lib/client/scheduling';
import {
  SCHEDULING_BOARD_VIEWS,
  readSchedulingViewPreference,
  type SchedulingBoardView,
  writeSchedulingViewPreference,
} from '@/lib/config/scheduling-view-preference';
import { cn } from '@/lib/utils/cn';
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
} from '@/types/scheduling';
import { PlantUnavailabilityDialog } from './PlantUnavailabilityDialog';
import {
  ScheduleAssignmentDialog,
  type SelectedScheduleResource,
} from './ScheduleAssignmentDialog';
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

function useWideDragEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => setEnabled(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return enabled;
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
  const { ref, isDragging } = useDraggable({
    id: `resource:${resource.type}:${resource.id}`,
    type: 'schedule-resource',
    data: { resource },
  });

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${selected ? 'Selected' : 'Select'} ${resource.label}, or drag to an available job day`}
      data-testid={`schedule-resource-${resource.type}-${resource.id}`}
      className={cn(
        'flex w-full cursor-grab items-center gap-2 rounded-lg border p-2 text-left transition active:cursor-grabbing',
        selected
          ? 'border-scheduling bg-scheduling-soft'
          : 'border-border bg-muted/20 hover:border-muted-foreground',
        isDragging && 'opacity-40'
      )}
    >
      <span className="rounded p-1 text-muted-foreground" aria-hidden="true">
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{resource.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
    </button>
  );
}

interface AssignmentChipProps {
  assignment: ScheduleAssignment;
  onDelete: (assignment: ScheduleAssignment) => void;
}

function AssignmentChip({ assignment, onDelete }: AssignmentChipProps) {
  const label =
    assignment.resource_type === 'employee'
      ? assignment.employee?.full_name || 'Employee'
      : assignment.plant?.nickname || assignment.plant?.plant_id || 'Plant';
  const hasConflict = assignment.conflicts.length > 0;

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
        assignment.resource_type === 'employee'
          ? 'border-sky-500/35 bg-sky-500/10 text-sky-100'
          : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100',
        hasConflict && 'border-amber-400/70 bg-amber-500/10'
      )}
      title={hasConflict ? assignment.conflicts.map((conflict) => conflict.message).join('\n') : label}
    >
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
  onAddVisit: () => void;
  onAssignVisit: (visit: ScheduleVisit) => void;
  onEditVisit: (visit: ScheduleVisit) => void;
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
}

interface VisitCardProps {
  job: ScheduleJob;
  visit: ScheduleVisit;
  assignments: ScheduleAssignment[];
  isDropEnabled: boolean;
  onAssign: () => void;
  onEdit: () => void;
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
}

function VisitCard({
  job,
  visit,
  assignments,
  isDropEnabled,
  onAssign,
  onEdit,
  onDeleteAssignment,
}: VisitCardProps) {
  const workDate = getScheduleVisitDate(visit.starts_at);
  const { ref, isDropTarget } = useDroppable({
    id: isDropEnabled ? `visit:${visit.id}` : `mobile-visit:${visit.id}`,
    type: 'schedule-visit',
    accept: 'schedule-resource',
    disabled: !isDropEnabled || visit.status === 'cancelled',
    data: { jobId: job.id, visitId: visit.id, workDate },
  });

  return (
    <div
      ref={ref}
      data-testid={`schedule-visit-${visit.id}`}
      className={cn(
        'rounded-md border border-border bg-card/80 p-1.5',
        visit.status === 'cancelled' && 'opacity-60',
        isDropTarget && 'border-scheduling bg-scheduling-soft ring-2 ring-scheduling'
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={visit.status === 'cancelled' ? onEdit : onAssign}
          className="min-w-0 text-left text-xs font-semibold text-foreground hover:text-scheduling"
          aria-label={
            visit.status === 'cancelled'
              ? `Edit cancelled visit ${visit.sequence_number} for ${job.job_reference}`
              : `Assign resource to visit ${visit.sequence_number} for ${job.job_reference}`
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
          />
        ))}
      </div>
      {visit.status !== 'cancelled' ? (
        <button
          type="button"
          onClick={onAssign}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded px-1 py-1 text-[11px] font-medium text-scheduling hover:bg-scheduling-soft"
        >
          <Plus className="h-3 w-3" />
          Assign
        </button>
      ) : null}
    </div>
  );
}

function DayCell({
  job,
  date,
  visits,
  assignments,
  onAddVisit,
  onAssignVisit,
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
          />
        ))}
        {dayVisits.map((visit) => (
          <VisitCard
            key={visit.id}
            job={job}
            visit={visit}
            assignments={assignments.filter((assignment) => assignment.visit_id === visit.id)}
            isDropEnabled
            onAssign={() => onAssignVisit(visit)}
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

export function SchedulingManagerBoard({ userId }: SchedulingManagerBoardProps) {
  const queryClient = useQueryClient();
  const wideDragEnabled = useWideDragEnabled();
  const [selectedDate, setSelectedDate] = useState(() => formatScheduleDate(new Date()));
  const [view, setView] = useState<SchedulingBoardView>(() =>
    readSchedulingViewPreference(userId)
  );
  const [resourceType, setResourceType] = useState<'employee' | 'plant'>('employee');
  const [resourceSearch, setResourceSearch] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [selectedResource, setSelectedResource] = useState<SelectedScheduleResource | null>(null);
  const [draggedResource, setDraggedResource] = useState<SelectedScheduleResource | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<{ job: ScheduleJob; visit: ScheduleVisit } | null>(null);
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

  const teams = useMemo(() => {
    const values = new Map<string, string>();
    for (const employee of board?.resources.employees || []) {
      if (employee.team_id) values.set(employee.team_id, employee.team_name || 'Unnamed team');
    }
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [board]);

  const filteredEmployees = useMemo(() => {
    const search = resourceSearch.trim().toLowerCase();
    return (board?.resources.employees || []).filter(
      (employee) =>
        (teamFilter === 'all' || employee.team_id === teamFilter) &&
        (!search ||
          employee.full_name.toLowerCase().includes(search) ||
          (employee.employee_id || '').toLowerCase().includes(search))
    );
  }, [board, resourceSearch, teamFilter]);
  const filteredPlant = useMemo(() => {
    const search = resourceSearch.trim().toLowerCase();
    return (board?.resources.plant || []).filter(
      (plant) =>
        !search ||
        plant.plant_id.toLowerCase().includes(search) ||
        (plant.nickname || '').toLowerCase().includes(search)
    );
  }, [board, resourceSearch]);
  const filteredJobs = useMemo(() => {
    const search = jobSearch.trim().toLowerCase();
    const rangeStart = weekDates[0];
    const rangeEnd = weekDates[weekDates.length - 1];
    return (board?.jobs || []).filter(
      (job) =>
        (!rangeStart || !rangeEnd || (job.start_date <= rangeEnd && job.end_date >= rangeStart))
        && (
          !search
          || job.job_reference.toLowerCase().includes(search)
          || job.title.toLowerCase().includes(search)
          || (job.site_address || '').toLowerCase().includes(search)
        )
    );
  }, [board, jobSearch, weekDates]);
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

  async function handleDeleteAssignment(assignment: ScheduleAssignment) {
    try {
      await deleteScheduleAssignment(assignment.id, assignment.resource_type);
      toast.success('Assignment removed');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove assignment');
    }
  }

  function visitsFor(jobId: string): ScheduleVisit[] {
    return board?.visits.filter((visit) => visit.job_id === jobId) || [];
  }

  function openAssignment(job: ScheduleJob, visit: ScheduleVisit, resource = selectedResource) {
    setSelectedResource(resource);
    setAssignmentTarget({ job, visit });
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
      plugins={(defaults) => [
        ...defaults,
        Accessibility.configure({
          announcements: {
            dragstart({ operation: { source } }: DndAnnouncementEvent) {
              const resource = source?.data?.resource as SelectedScheduleResource | undefined;
              return resource ? `Picked up ${resource.label}.` : 'Started dragging resource.';
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
              return resource && target ? `Choose dates for ${resource.label}.` : 'Resource was not assigned.';
            },
          },
        }),
      ]}
      onDragStart={(event) => {
        const resource = event.operation.source?.data?.resource as SelectedScheduleResource | undefined;
        if (resource) setSelectedResource(resource);
        setDraggedResource(resource || null);
      }}
      onDragEnd={(event) => {
        const sourceResource = event.operation.source?.data?.resource as SelectedScheduleResource | undefined;
        const targetData = event.operation.target?.data as { jobId?: string; visitId?: string } | undefined;
        setDraggedResource(null);
        if (event.canceled || !sourceResource) return;
        if (!targetData?.jobId || !targetData.visitId) {
          toast.info('Drop onto a timed visit.');
          return;
        }
        const job = board.jobs.find((item) => item.id === targetData.jobId);
        const visit = board.visits.find((item) => item.id === targetData.visitId);
        if (job && visit) {
          openAssignment(job, visit, sourceResource);
        } else {
          toast.error('That job is no longer available. Refresh the board and try again.');
        }
      }}
    >
      <div className="space-y-4">
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
                            selected={selectedResource?.type === 'employee' && selectedResource.id === employee.id}
                            dragEnabled={wideDragEnabled}
                            onSelect={() => setSelectedResource(resource)}
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
                            warning={plant.status !== 'active' ? `Status: ${plant.status}` : undefined}
                            selected={selectedResource?.type === 'plant' && selectedResource.id === plant.id}
                            dragEnabled={wideDragEnabled}
                            onSelect={() => setSelectedResource(resource)}
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
                  <Input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search jobs" className="pl-9" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground xl:hidden">
                Select a resource, then tap or click <span className="font-medium text-foreground">Assign</span> on a timed visit.
              </p>
              <p className="hidden text-sm text-muted-foreground xl:block">
                Select a resource and click <span className="font-medium text-foreground">Assign</span>, or drag the whole resource card onto a timed visit.
              </p>
            </CardHeader>
            <CardContent>
              <div className="hidden overflow-auto rounded-lg border border-border md:block">
                <div className={view === SCHEDULING_BOARD_VIEWS.daily ? 'min-w-[560px]' : 'min-w-[1260px]'}>
                  <div
                    className={cn(
                      'grid bg-muted/60',
                      view === SCHEDULING_BOARD_VIEWS.daily
                        ? 'grid-cols-[240px_minmax(320px,1fr)]'
                        : 'grid-cols-[240px_repeat(7,minmax(140px,1fr))]'
                    )}
                  >
                    <div className="sticky left-0 z-20 border-r border-border p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Job
                    </div>
                    {weekDates.map((date) => (
                      <div key={date} className="border-l border-border p-3 text-center">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{format(parseISO(date), 'EEE')}</p>
                        <p className="text-sm font-semibold text-foreground">{format(parseISO(date), 'd MMM')}</p>
                      </div>
                    ))}
                  </div>
                  {filteredJobs.map((job) => (
                    <div
                      key={job.id}
                      className={cn(
                        'grid border-t border-border',
                        view === SCHEDULING_BOARD_VIEWS.daily
                          ? 'grid-cols-[240px_minmax(320px,1fr)]'
                          : 'grid-cols-[240px_repeat(7,minmax(140px,1fr))]'
                      )}
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
                            {job.estimated_duration_minutes ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Estimated {Math.round(job.estimated_duration_minutes / 60 * 10) / 10} hours
                              </p>
                            ) : null}
                          </div>
                          {job.source_type === 'quote' && job.quote_id ? (
                            <Button asChild size="sm" variant="ghost" className="h-7 w-7 p-0">
                              <Link
                                href={`/quotes/overview/${encodeURIComponent(job.job_reference)}`}
                                aria-label={`Open Quote ${job.job_reference}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          ) : (
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
                          )}
                        </div>
                      </div>
                      {weekDates.map((date) => (
                        <DayCell
                          key={`${job.id}-${date}`}
                          job={job}
                          date={date}
                          visits={visitsFor(job.id)}
                          assignments={assignmentsFor(job.id, date)}
                          onAddVisit={() => openVisitEditor(job, date)}
                          onAssignVisit={(visit) => openAssignment(job, visit)}
                          onEditVisit={(visit) => openVisitEditor(job, date, visit)}
                          onDeleteAssignment={setPendingDeleteAssignment}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 md:hidden" data-mobile-scroll-lock="true">
                {filteredJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">{job.job_reference}</p>
                          {job.source_type === 'quote' ? <Badge variant="outline">Quote</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {job.customer_name ? `${job.customer_name} · ` : ''}{job.title}
                        </p>
                      </div>
                      {job.source_type === 'quote' ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/quotes/overview/${encodeURIComponent(job.job_reference)}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => { setEditingJob(job); setJobDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
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
                                <AssignmentChip key={`${assignment.resource_type}-${assignment.id}`} assignment={assignment} onDelete={setPendingDeleteAssignment} />
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
                                    onAssign={() => openAssignment(job, visit)}
                                    onEdit={() => openVisitEditor(job, date, visit)}
                                    onDeleteAssignment={setPendingDeleteAssignment}
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
                      {board.jobs.length === 0 || !jobSearch.trim()
                        ? `No jobs scheduled for this ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}`
                        : 'No jobs match your search'}
                    </p>
                    <p className="mt-1 text-sm">
                      {board.jobs.length === 0 || !jobSearch.trim()
                        ? `Add a job that overlaps this ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}, or choose another ${view === SCHEDULING_BOARD_VIEWS.daily ? 'day' : 'week'}.`
                        : 'Clear or change the job search to see more results.'}
                    </p>
                  </div>
                  {board.jobs.length === 0 || !jobSearch.trim() ? (
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
        ) : null}
      </DragOverlay>

      <ScheduleAssignmentDialog
        open={assignmentTarget !== null}
        onOpenChange={(open) => !open && setAssignmentTarget(null)}
        job={assignmentTarget?.job || null}
        visit={assignmentTarget?.visit || null}
        initialDate={assignmentTarget ? getScheduleVisitDate(assignmentTarget.visit.starts_at) : null}
        initialResource={selectedResource}
        availableDates={weekDates}
        employees={board.resources.employees}
        plant={board.resources.plant}
        onSaved={() => void refresh()}
      />
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
