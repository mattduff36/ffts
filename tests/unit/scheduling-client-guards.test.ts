import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createScheduleAssignment,
  deletePlantUnavailability,
  deleteScheduleAssignment,
  deleteScheduleJob,
  deleteScheduleVisit,
  savePlantUnavailability,
  saveScheduleJob,
} from '@/lib/client/scheduling';

describe('scheduling client mutation guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('FOLLOWUP-ID-003 rejects provisional entities and tags before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      saveScheduleJob(
        { tag_ids: ['optimistic:tag-operation:tag'] },
        'job-1'
      )
    ).rejects.toThrow('finish saving');
    await expect(
      deleteScheduleVisit('optimistic:visit-operation:visit')
    ).rejects.toThrow('finish saving');
    await expect(
      deleteScheduleJob('optimistic:job-operation:job')
    ).rejects.toThrow('finish saving');
    await expect(
      deleteScheduleAssignment(
        'optimistic:assignment-operation:assignment',
        'employee'
      )
    ).rejects.toThrow('finish saving');
    await expect(
      deletePlantUnavailability('optimistic:block-operation:plant-block')
    ).rejects.toThrow('finish saving');
    await expect(
      savePlantUnavailability({
        plant_id: 'optimistic:plant-operation:plant',
        start_date: '2026-08-11',
        end_date: '2026-08-12',
        reason: 'Maintenance',
        notes: null,
      })
    ).rejects.toThrow('finish saving');
    await expect(
      createScheduleAssignment({
        job_id: 'job-1',
        visit_id: 'optimistic:visit-operation:visit',
        resource_type: 'employee',
        resource_id: 'employee-1',
      })
    ).rejects.toThrow('finish saving');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
