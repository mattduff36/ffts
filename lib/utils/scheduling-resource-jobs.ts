import type { ScheduleJob } from '@/types/scheduling';

export function isUnfinishedScheduleJob(job: Pick<ScheduleJob, 'status'>): boolean {
  return job.status !== 'completed' && job.status !== 'cancelled';
}

export function unfinishedScheduleJobs(jobs: ScheduleJob[]): ScheduleJob[] {
  return jobs.filter(isUnfinishedScheduleJob);
}
