import { describe, expect, it } from 'vitest';
import { unfinishedScheduleJobs } from '@/lib/utils/scheduling-resource-jobs';
import type { ScheduleJob } from '@/types/scheduling';

describe('Resources unfinished jobs', () => {
  it('ignores expired dates and duration, excludes completed and intentionally cancelled work', () => {
    const jobs = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'].map((status) => ({
      id: status, status, start_date: '2001-01-01', end_date: '2001-01-01',
      estimated_duration_minutes: 15,
    })) as ScheduleJob[];
    expect(unfinishedScheduleJobs(jobs).map((job) => job.id)).toEqual(['draft', 'scheduled', 'in_progress']);
    expect(jobs[1].end_date).toBe('2001-01-01');
    expect(unfinishedScheduleJobs([{ ...jobs[1], status: 'completed' }])).toEqual([]);
  });
});
