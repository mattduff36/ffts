'use client';

import { useMemo, useState } from 'react';
import { Accessibility } from '@dnd-kit/dom';
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  CalendarOff,
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
import { cn } from '@/lib/utils/cn';
import { enumerateScheduleDates, getSchedulingWeek } from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantResource,
} from '@/types/scheduling';
import { PlantUnavailabilityDialog } from './PlantUnavailabilityDialog';
import {
  ScheduleAssignmentDialog,
  type SelectedScheduleResource,
} from './ScheduleAssignmentDialog';
import { ScheduleJobDialog } from './ScheduleJobDialog';
import { SchedulingWeekNav } from './SchedulingWeekNav';

interface ResourceCardProps {
  resource: SelectedScheduleResource;
  subtitle: string;
  selected: boolean;
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

function ResourceCard({ resource, subtitle, selected, warning, onSelect }: ResourceCardProps) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `resource:${resource.type}:${resource.id}`,
    type: 'schedule-resource',
    data: { resource },
  });

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 rounded-lg border p-2 transition',
        selected
          ? 'border-scheduling bg-scheduling-soft'
          : 'border-border bg-muted/20 hover:border-muted-foreground',
        isDragging && 'opacity-40'
      )}
    >
      <button
        ref={handleRef}
        type="button"
        className="touch-none rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scheduling"
        aria-label={`Drag ${resource.label}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-foreground">{resource.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </button>
      {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
    </div>
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
  assignments: ScheduleAssignment[];
  onActivate: () => void;
  onDeleteAssignment: (assignment: ScheduleAssignment) => void;
}

function DayCell({ job, date, assignments, onActivate, onDeleteAssignment }: DayCellProps) {
  const active = date >= job.start_date && date <= job.end_date;
  const { ref, isDropTarget } = useDroppable({
    id: `cell:${job.id}:${date}`,
    type: 'schedule-cell',
    accept: 'schedule-resource',
    disabled: !active,
    data: { jobId: job.id, workDate: date },
  });

  return (
    <div
      ref={ref}
      role={active ? 'button' : undefined}
      tabIndex={active ? 0 : -1}
      aria-label={active ? `Assign resource to ${job.job_reference} on ${date}` : undefined}
      onClick={() => active && onActivate()}
      onKeyDown={(event) => {
        if (active && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        'min-h-24 border-l border-border p-1.5 outline-none',
        active
          ? 'cursor-pointer bg-muted/10 hover:bg-scheduling-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-scheduling'
          : 'bg-muted/40 opacity-45',
        isDropTarget && 'bg-scheduling-soft ring-2 ring-inset ring-scheduling'
      )}
    >
      <div className="space-y-1">
        {assignments.map((assignment) => (
          <AssignmentChip
            key={`${assignment.resource_type}-${assignment.id}`}
            assignment={assignment}
            onDelete={onDeleteAssignment}
          />
        ))}
      </div>
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

export function SchedulingManagerBoard() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => getSchedulingWeek().start);
  const [resourceType, setResourceType] = useState<'employee' | 'plant'>('employee');
  const [resourceSearch, setResourceSearch] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [selectedResource, setSelectedResource] = useState<SelectedScheduleResource | null>(null);
  const [draggedResource, setDraggedResource] = useState<SelectedScheduleResource | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<{ job: ScheduleJob; date: string } | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);
  const [unavailabilityOpen, setUnavailabilityOpen] = useState(false);
  const [pendingDeleteAssignment, setPendingDeleteAssignment] = useState<ScheduleAssignment | null>(null);

  const boardQuery = useQuery({
    queryKey: ['scheduling-board', weekStart],
    queryFn: () => fetchSchedulingBoard(weekStart),
  });
  const board = boardQuery.data;
  const weekDates = useMemo(
    () => (board ? enumerateScheduleDates(board.week.start, board.week.end) : []),
    [board]
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
    return (board?.jobs || []).filter(
      (job) =>
        !search ||
        job.job_reference.toLowerCase().includes(search) ||
        job.title.toLowerCase().includes(search) ||
        (job.site_address || '').toLowerCase().includes(search)
    );
  }, [board, jobSearch]);

  function assignmentsFor(jobId: string, date: string): ScheduleAssignment[] {
    return (board?.assignments || []).filter(
      (assignment) => assignment.job_id === jobId && assignment.work_date === date
    );
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

  function openAssignment(job: ScheduleJob, date: string, resource = selectedResource) {
    setSelectedResource(resource);
    setAssignmentTarget({ job, date });
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
        setDraggedResource(resource || null);
      }}
      onDragEnd={(event) => {
        const sourceResource = event.operation.source?.data?.resource as SelectedScheduleResource | undefined;
        const targetData = event.operation.target?.data as { jobId?: string; workDate?: string } | undefined;
        setDraggedResource(null);
        if (event.canceled || !sourceResource || !targetData?.jobId || !targetData.workDate) return;
        const job = board.jobs.find((item) => item.id === targetData.jobId);
        if (job) openAssignment(job, targetData.workDate, sourceResource);
      }}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/70 p-4 xl:flex-row xl:items-center xl:justify-between">
          <SchedulingWeekNav weekStart={weekStart} onChange={setWeekStart} />
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
              <ScrollArea className="h-[420px] pr-3">
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
                            onSelect={() => setSelectedResource(resource)}
                          />
                        );
                      })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-border">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Weekly job board</CardTitle>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search jobs" className="pl-9" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Drag a resource onto a day, or select a resource and activate a day cell.
              </p>
            </CardHeader>
            <CardContent>
              <div className="hidden overflow-auto rounded-lg border border-border md:block">
                <div className="min-w-[1260px]">
                  <div className="grid grid-cols-[240px_repeat(7,minmax(140px,1fr))] bg-muted/60">
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
                    <div key={job.id} className="grid grid-cols-[240px_repeat(7,minmax(140px,1fr))] border-t border-border">
                      <div className="sticky left-0 z-10 border-r border-border bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-semibold text-foreground">{job.job_reference}</span>
                              {job.source_type === 'sample' ? <Badge variant="outline">Sample</Badge> : null}
                            </div>
                            <p className="truncate text-sm text-muted-foreground">{job.title}</p>
                            <p className="truncate text-xs text-muted-foreground">{job.site_address || 'No site'}</p>
                          </div>
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
                      {weekDates.map((date) => (
                        <DayCell
                          key={`${job.id}-${date}`}
                          job={job}
                          date={date}
                          assignments={assignmentsFor(job.id, date)}
                          onActivate={() => openAssignment(job, date)}
                          onDeleteAssignment={setPendingDeleteAssignment}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 md:hidden">
                {filteredJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">{job.job_reference}</p>
                        <p className="text-sm text-muted-foreground">{job.title}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => { setEditingJob(job); setJobDialogOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {weekDates
                        .filter((date) => date >= job.start_date && date <= job.end_date)
                        .map((date) => (
                          <button
                            key={date}
                            type="button"
                            onClick={() => openAssignment(job, date)}
                            className="w-full rounded-md border border-border p-3 text-left hover:bg-scheduling-soft"
                          >
                            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{format(parseISO(date), 'EEEE d MMM')}</p>
                            <div className="space-y-1">
                              {assignmentsFor(job.id, date).map((assignment) => (
                                <AssignmentChip key={`${assignment.resource_type}-${assignment.id}`} assignment={assignment} onDelete={setPendingDeleteAssignment} />
                              ))}
                              {assignmentsFor(job.id, date).length === 0 ? <span className="text-xs text-muted-foreground">Tap to assign</span> : null}
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>

              {filteredJobs.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">No jobs match this week and filter.</div>
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
        initialDate={assignmentTarget?.date || null}
        initialResource={selectedResource}
        employees={board.resources.employees}
        plant={board.resources.plant}
        onSaved={() => void refresh()}
      />
      <ScheduleJobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        job={editingJob}
        defaultDate={board.week.start}
        onSaved={() => void refresh()}
      />
      <PlantUnavailabilityDialog
        open={unavailabilityOpen}
        onOpenChange={setUnavailabilityOpen}
        plant={board.resources.plant}
        blocks={board.plant_unavailability}
        defaultDate={board.week.start}
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
