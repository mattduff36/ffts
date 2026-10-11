'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Clock3, MapPin, RefreshCw, Tractor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchMySchedule } from '@/lib/client/scheduling';
import {
  enumerateScheduleDates,
  formatScheduleDate,
  formatScheduleVisitTime,
  getScheduleVisitDate,
  getSchedulingWeek,
  isScheduleDate,
} from '@/lib/utils/scheduling';
import type {
  ScheduleEmployeeAssignment,
  ScheduleJob,
  SchedulePlantAssignment,
  ScheduleSelfJobDetails,
  ScheduleSelfCrewMember,
  SchedulingSelfPayload,
} from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';
import { SchedulingJobSiteDetails } from './SchedulingJobSiteDetails';

const touchTarget = 'min-h-[44px] min-w-[44px] text-[max(0.875rem,14px)]';

function directionsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function slotKey(jobId: string, workDate: string, visitId: string | null): string {
  return `${jobId}|${workDate}|${visitId ?? ''}`;
}

function plantForAssignment(
  plant: SchedulePlantAssignment[],
  assignment: ScheduleEmployeeAssignment
): SchedulePlantAssignment[] {
  const key = slotKey(assignment.job_id, assignment.work_date, assignment.visit_id);
  return plant.filter((item) => slotKey(item.job_id, item.work_date, item.visit_id) === key);
}

function isTimed(assignment: ScheduleEmployeeAssignment): boolean {
  return Boolean(assignment.visit?.starts_at);
}

function compareTimed(first: ScheduleEmployeeAssignment, second: ScheduleEmployeeAssignment): number {
  const firstStart = first.visit?.starts_at || '';
  const secondStart = second.visit?.starts_at || '';
  if (firstStart !== secondStart) return firstStart < secondStart ? -1 : 1;
  return first.id.localeCompare(second.id);
}

function EmployeeJobCard({
  assignment,
  job,
  plant,
  details,
  crew,
}: {
  assignment: ScheduleEmployeeAssignment;
  job: ScheduleJob | undefined;
  plant: SchedulePlantAssignment[];
  details?: ScheduleSelfJobDetails;
  crew: ScheduleSelfCrewMember[];
}) {
  const visit = assignment.visit;
  const address = job?.site_address?.trim() || '';
  const customer = job?.customer_name?.trim() || '';
  const instructions = job?.description?.trim() || '';
  const visitNotes = visit?.notes?.trim() || '';
  const assignmentNotes = assignment.notes?.trim() || '';
  const visitTitle = visit?.title?.trim() || '';

  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-foreground">{job?.job_reference || 'Scheduled job'}</p>
          <p className="break-words text-[max(1rem,16px)] text-muted-foreground">{job?.title || 'Job details unavailable'}</p>
          {customer ? <p className="mt-1 break-words text-[max(1rem,16px)] text-foreground">{customer}</p> : null}
        </div>
        {job?.source_type === 'sample' ? <span className="rounded-md border border-border px-2 py-1 text-[max(0.875rem,14px)]">Sample</span> : null}
      </div>
      {visit ? (
        <div className="mt-3 space-y-1 text-[max(1rem,16px)] text-foreground">
          <p className="break-words font-medium">
            {`Visit ${visit.sequence_number}`}
            {visitTitle ? ` · ${visitTitle}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Clock3 className="h-4 w-4 text-scheduling" />
            <span>
              {formatScheduleVisitTime(visit.starts_at)}–{formatScheduleVisitTime(visit.ends_at)}
            </span>
            <span className="rounded-md border border-border px-2 py-1 text-[max(0.875rem,14px)]">{visit.status === 'completed' ? 'Completed' : 'Planned'}</span>
          </div>
        </div>
      ) : null}
      {address ? (
        <div className="mt-3 flex flex-wrap items-start gap-2 text-[max(1rem,16px)] text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-scheduling" />
          <span className="min-w-0 flex-1 break-words">{address}</span>
          <a
            className={`${touchTarget} inline-flex items-center text-[max(1rem,16px)] font-medium text-scheduling underline-offset-2 hover:underline`}
            href={directionsHref(address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Directions
          </a>
        </div>
      ) : null}
      {instructions ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-[max(1rem,16px)] text-foreground">
          <span className="font-medium">Work instructions: </span>
          {instructions}
        </p>
      ) : null}
      {visitNotes ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-[max(1rem,16px)] text-foreground">
          <span className="font-medium">Visit notes: </span>
          {visitNotes}
        </p>
      ) : null}
      {assignmentNotes ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-[max(1rem,16px)] text-foreground">
          <span className="font-medium">Assignment notes: </span>
          {assignmentNotes}
        </p>
      ) : null}
      {plant.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {plant.map((item) => (
            <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-md border border-scheduling/30 bg-scheduling/10 px-3 py-2 text-[max(1rem,16px)] text-foreground">
              <Tractor className="h-3.5 w-3.5" />
              <span className="break-words">{item.plant?.nickname || item.plant?.plant_id || 'Plant'}{item.plant?.nickname && item.plant.plant_id ? ` · ${item.plant.plant_id}` : ''}</span>
            </span>
          ))}
        </div>
      ) : null}
      <SchedulingJobSiteDetails details={details} crew={crew} />
    </div>
  );
}

export function SchedulingEmployeeView() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlDate = searchParams.get('date');
  const validUrlDate = isScheduleDate(urlDate) ? urlDate : null;
  const [selectedDate, setSelectedDate] = useState(
    () => validUrlDate ?? getScheduleVisitDate(new Date())
  );
  const [trackedUrlDate, setTrackedUrlDate] = useState(validUrlDate);
  if (validUrlDate !== trackedUrlDate) {
    setTrackedUrlDate(validUrlDate);
    setSelectedDate(validUrlDate ?? getScheduleVisitDate(new Date()));
  }

  const week = getSchedulingWeek(selectedDate);
  const weekStart = week.start;
  const scheduleQuery = useQuery({
    queryKey: ['my-schedule', userId, weekStart],
    queryFn: () => fetchMySchedule(weekStart),
    enabled: Boolean(userId),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === userId ? previous : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  function selectDate(nextDate: string) {
    if (!isScheduleDate(nextDate) || nextDate === selectedDate) return;
    setSelectedDate(nextDate);
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', nextDate);
    router.replace(`${pathname || '/scheduling/my'}?${params.toString()}`, { scroll: false });
  }

  function shiftDay(days: number) {
    selectDate(formatScheduleDate(addDays(parseISO(selectedDate), days)));
  }

  const payload: SchedulingSelfPayload | undefined = scheduleQuery.data;
  const weekAligned = payload?.week.start === weekStart && payload.week.end === week.end;
  const dates = enumerateScheduleDates(week.start, week.end);
  const dayAssignments = weekAligned
    ? payload.assignments.filter((assignment) => assignment.work_date === selectedDate)
    : [];
  const timed = dayAssignments.filter(isTimed).sort(compareTimed);
  const untimed = dayAssignments.filter((assignment) => !isTimed(assignment));
  const jobsById = new Map((payload?.jobs || []).map((job) => [job.id, job]));
  const detailsByJob = new Map((payload?.job_details || []).map((details) => [details.job_id, details]));
  const crewFor = (assignment: ScheduleEmployeeAssignment) => (payload?.crew_assignments || []).filter(
    (person) => slotKey(person.job_id, person.work_date, person.visit_id) === slotKey(assignment.job_id, assignment.work_date, assignment.visit_id)
  );
  const assignedDates = new Set(
    (weekAligned ? payload.assignments : []).map((assignment) => assignment.work_date)
  );
  const nextAssigned = dates.find((date) => date > selectedDate && assignedDates.has(date));
  const previousAssigned = [...dates].reverse().find((date) => date < selectedDate && assignedDates.has(date));
  const jumpDate = nextAssigned || previousAssigned;
  const updating = scheduleQuery.isFetching && !scheduleQuery.isLoading;
  const showInitialLoader = !payload && !scheduleQuery.isError && (scheduleQuery.isLoading || !userId);
  const errorMessage = scheduleQuery.error instanceof Error
    ? scheduleQuery.error.message
    : 'Unable to load your schedule.';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-end gap-2 rounded-xl border border-border bg-card/70 p-3 sm:flex sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          className={`${schedulingControlStyles.outline} ${touchTarget} order-1`}
          onClick={() => shiftDay(-1)}
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <label className="order-2 flex min-w-0 flex-1 flex-col gap-1 text-[max(0.875rem,14px)] text-muted-foreground">
          Date
          <input
            aria-label="Schedule date"
            className={`${touchTarget} w-full min-w-0 rounded-md border border-border bg-background px-3 text-[max(1rem,16px)] text-foreground`}
            type="date"
            value={selectedDate}
            onChange={(event) => selectDate(event.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          className={`${schedulingControlStyles.outline} ${touchTarget} order-4 col-span-2`}
          onClick={() => selectDate(getScheduleVisitDate(new Date()))}
          aria-label="Go to today"
        >
          Today
        </Button>
        <Button
          type="button"
          variant="outline"
          className={`${schedulingControlStyles.outline} ${touchTarget} order-3`}
          onClick={() => shiftDay(1)}
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className={`${schedulingControlStyles.outline} ${touchTarget} order-5`}
          onClick={() => { void scheduleQuery.refetch(); }}
          aria-label="Refresh schedule"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <details className="rounded-lg border border-border bg-card/50 p-3">
        <summary className="min-h-[44px] cursor-pointer content-center text-[max(1rem,16px)] font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-scheduling">
          Week overview <span className="ml-2 font-normal text-muted-foreground">{weekAligned ? `${payload.assignments.length} assignment${payload.assignments.length === 1 ? '' : 's'}` : 'Loading…'}</span>
        </summary>
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button variant="outline" className={touchTarget} aria-label="Previous week" onClick={() => shiftDay(-7)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-center text-[max(1rem,16px)] text-muted-foreground">{format(parseISO(week.start), 'd MMM')} – {format(parseISO(week.end), 'd MMM yyyy')}</span>
          <Button variant="outline" className={touchTarget} aria-label="Next week" onClick={() => shiftDay(7)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" aria-label="Week overview">
        {dates.map((date) => {
          const selected = date === selectedDate;
          const count = weekAligned
            ? payload.assignments.filter((assignment) => assignment.work_date === date).length
            : 0;
          return (
            <Button
              key={date}
              type="button"
              variant="outline"
              aria-pressed={selected}
              className={`${selected ? schedulingControlStyles.primary : schedulingControlStyles.outline} ${touchTarget} h-auto flex-col px-3 py-2`}
              onClick={() => selectDate(date)}
            >
              <span>{format(parseISO(date), 'EEE d')}</span>
              <span className="text-[max(0.875rem,14px)] font-normal">{!weekAligned ? '…' : count === 0 ? 'No jobs' : `${count} job${count === 1 ? '' : 's'}`}</span>
            </Button>
          );
        })}
      </div>
      </details>

      {updating ? (
        <p className="text-[max(1rem,16px)] text-muted-foreground" role="status">Updating schedule…</p>
      ) : null}
      {scheduleQuery.isError ? (
        <Card className="border-red-500/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6 text-red-300">
            <p role="alert">{errorMessage}{payload && weekAligned ? ' Showing the last loaded schedule; it may be out of date.' : ''}</p>
            <Button
              type="button"
              variant="outline"
              className={`${schedulingControlStyles.outline} ${touchTarget}`}
              onClick={() => { void scheduleQuery.refetch(); }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showInitialLoader ? (
        <p className="text-[max(1rem,16px)] text-muted-foreground" role="status">Loading your schedule...</p>
      ) : null}

      {payload && weekAligned && !showInitialLoader ? (
        <section className="space-y-3" aria-label={format(parseISO(selectedDate), 'EEEE d MMMM')}>
          <h2 className="text-[max(1.25rem,20px)] font-semibold text-foreground">
            {format(parseISO(selectedDate), 'EEEE d MMMM')}
          </h2>
          {dayAssignments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[max(1rem,16px)] text-muted-foreground">
              <p>No work assigned for this day.</p>
              {jumpDate ? (
                <Button
                  type="button"
                  variant="outline"
                  className={`${schedulingControlStyles.outline} ${touchTarget} mt-3`}
                  onClick={() => selectDate(jumpDate)}
                >
                  {nextAssigned ? 'Next assigned day' : 'Previous assigned day'}
                  {` · ${format(parseISO(jumpDate), 'EEEE d MMM')}`}
                </Button>
              ) : (
                <p className="mt-2">Nothing else is assigned this week.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {timed.map((assignment) => (
                <EmployeeJobCard
                  key={assignment.id}
                  assignment={assignment}
                  job={jobsById.get(assignment.job_id)}
                  plant={plantForAssignment(payload.plant_assignments, assignment)}
                  details={detailsByJob.get(assignment.job_id)}
                  crew={crewFor(assignment)}
                />
              ))}
              {untimed.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-[max(1rem,16px)] font-semibold text-foreground">Time to be confirmed</h3>
                  {untimed.map((assignment) => (
                    <EmployeeJobCard
                      key={assignment.id}
                      assignment={assignment}
                      job={jobsById.get(assignment.job_id)}
                      plant={plantForAssignment(payload.plant_assignments, assignment)}
                      details={detailsByJob.get(assignment.job_id)}
                      crew={crewFor(assignment)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
