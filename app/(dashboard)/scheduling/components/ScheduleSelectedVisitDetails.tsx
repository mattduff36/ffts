'use client';

import { format, parseISO } from 'date-fns';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import {
  formatScheduleVisitTime,
  getScheduleVisitDate,
} from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleJob,
  ScheduleVisit,
} from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

export interface ResolvedSelectedVisit {
  job: ScheduleJob;
  visit: ScheduleVisit;
  visitDate: string;
  employees: string[];
  plant: string[];
}

export function resolveSelectedVisitDetails(input: {
  jobId: string;
  visitId: string;
  jobs: readonly ScheduleJob[];
  visits: readonly ScheduleVisit[];
  assignments: readonly ScheduleAssignment[];
  visibleDates: readonly string[];
}): ResolvedSelectedVisit | null {
  const job = input.jobs.find((item) => item.id === input.jobId);
  if (!job) return null;
  const visit = input.visits.find(
    (item) => item.id === input.visitId && item.job_id === job.id
  );
  if (!visit) return null;
  const visitDate = getScheduleVisitDate(visit.starts_at);
  if (!visitDate || !input.visibleDates.includes(visitDate)) return null;

  const employees: string[] = [];
  const plant: string[] = [];
  for (const assignment of input.assignments) {
    if (assignment.job_id !== job.id || assignment.visit_id !== visit.id) continue;
    if (assignment.work_date !== visitDate) continue;
    if (assignment.resource_type === 'employee') {
      const name = assignment.employee?.full_name?.trim();
      if (name) employees.push(name);
      continue;
    }
    const name = (assignment.plant?.nickname || assignment.plant?.plant_id || '').trim();
    if (name) plant.push(name);
  }

  return { job, visit, visitDate, employees, plant };
}

export function formatSelectedVisitTime(visit: ScheduleVisit, visitDate: string): string {
  const start = formatScheduleVisitTime(visit.starts_at);
  const end = formatScheduleVisitTime(visit.ends_at);
  const dateLabel = format(parseISO(`${visitDate}T12:00:00`), 'EEE d MMM');
  if (!start || !end) return dateLabel;
  return `${dateLabel} · ${start}–${end}`;
}

export function ScheduleSelectedVisitDetails({
  details,
  onClear,
}: {
  details: ResolvedSelectedVisit;
  onClear: () => void;
}) {
  const timeLabel = formatSelectedVisitTime(details.visit, details.visitDate);

  return (
    <section
      aria-label="Selected visit"
      data-testid="schedule-selected-visit-details"
      className="max-h-40 shrink-0 overflow-y-auto rounded-md border border-scheduling/40 bg-scheduling-soft p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('font-semibold text-foreground', schedulingControlStyles.readableLabel)}>
            {details.job.job_reference} · Visit {details.visit.sequence_number}
          </p>
          {details.job.title ? (
            <p className={cn('mt-1 text-foreground', schedulingControlStyles.readableLabel)}>
              {details.job.title}
            </p>
          ) : null}
          <p className={cn('mt-1 text-muted-foreground', schedulingControlStyles.readableMeta)}>
            {timeLabel}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className={cn('h-7 shrink-0 px-2', schedulingControlStyles.ghost)}
          aria-label="Clear selected visit"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className={cn('mt-2 space-y-1 text-foreground', schedulingControlStyles.readableMeta)}>
        <p>
          <span className="font-semibold">Employees: </span>
          {details.employees.length > 0 ? details.employees.join(', ') : 'None on this visit'}
        </p>
        <p>
          <span className="font-semibold">Plant: </span>
          {details.plant.length > 0 ? details.plant.join(', ') : 'None on this visit'}
        </p>
      </div>
    </section>
  );
}
