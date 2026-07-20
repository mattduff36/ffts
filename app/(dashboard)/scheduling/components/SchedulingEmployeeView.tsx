'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Clock3, MapPin, Tractor } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { fetchMySchedule } from '@/lib/client/scheduling';
import {
  enumerateScheduleDates,
  formatScheduleVisitTime,
  getSchedulingWeek,
} from '@/lib/utils/scheduling';
import { SchedulingWeekNav } from './SchedulingWeekNav';

export function SchedulingEmployeeView() {
  const [weekStart, setWeekStart] = useState(() => getSchedulingWeek().start);
  const scheduleQuery = useQuery({
    queryKey: ['my-schedule', weekStart],
    queryFn: () => fetchMySchedule(weekStart),
  });

  if (scheduleQuery.isLoading) return <PageLoader message="Loading your schedule..." />;
  if (scheduleQuery.isError || !scheduleQuery.data) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="py-10 text-center text-red-300">
          {scheduleQuery.error instanceof Error ? scheduleQuery.error.message : 'Unable to load your schedule.'}
        </CardContent>
      </Card>
    );
  }

  const payload = scheduleQuery.data;
  const jobsById = new Map(payload.jobs.map((job) => [job.id, job]));
  const dates = enumerateScheduleDates(payload.week.start, payload.week.end);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/70 p-4">
        <SchedulingWeekNav weekStart={weekStart} onChange={setWeekStart} />
        <Badge variant="outline" className="border-scheduling/40 text-scheduling">
          {payload.assignments.length} assignment{payload.assignments.length === 1 ? '' : 's'}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {dates.map((date) => {
          const assignments = payload.assignments.filter((assignment) => assignment.work_date === date);
          const isToday = date === new Date().toISOString().slice(0, 10);
          return (
            <Card key={date} className={isToday ? 'border-scheduling/70 shadow-[0_0_22px_hsl(var(--scheduling-primary)/0.12)]' : 'border-border'}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{format(parseISO(date), 'EEEE')}</CardTitle>
                  <span className="text-sm text-muted-foreground">{format(parseISO(date), 'd MMM')}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {assignments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                    No work assigned
                  </div>
                ) : (
                  assignments.map((assignment) => {
                    const job = jobsById.get(assignment.job_id);
                    const plant = payload.plant_assignments.filter(
                      (item) =>
                        item.job_id === assignment.job_id
                        && item.work_date === date
                        && (
                          assignment.visit_id
                            ? item.visit_id === assignment.visit_id
                            : !item.visit_id
                        )
                    );
                    const repeatVisitCount = payload.visits.filter(
                      (visit) => visit.job_id === assignment.job_id && visit.status !== 'cancelled'
                    ).length;
                    return (
                      <div key={assignment.id} className="rounded-lg border border-border bg-muted/20 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-foreground">{job?.job_reference || 'Scheduled job'}</p>
                            <p className="text-sm text-muted-foreground">{job?.title || 'Job details unavailable'}</p>
                          </div>
                          {job?.source_type === 'sample' ? <Badge variant="outline">Sample</Badge> : null}
                        </div>
                        {assignment.visit ? (
                          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-foreground">
                            <Clock3 className="h-4 w-4 text-scheduling" />
                            {formatScheduleVisitTime(assignment.visit.starts_at)}–
                            {formatScheduleVisitTime(assignment.visit.ends_at)}
                            {repeatVisitCount > 1
                              ? ` · Visit ${assignment.visit.sequence_number} of ${repeatVisitCount}`
                              : ''}
                          </p>
                        ) : null}
                        {job?.site_address ? (
                          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-scheduling" />
                            {job.site_address}
                          </p>
                        ) : null}
                        {plant.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {plant.map((item) => (
                              <span key={item.id} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100">
                                <Tractor className="h-3.5 w-3.5" />
                                {item.plant?.nickname || item.plant?.plant_id || 'Plant'}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
