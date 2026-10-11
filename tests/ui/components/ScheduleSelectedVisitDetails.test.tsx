/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveSelectedVisitDetails,
  ScheduleSelectedVisitDetails,
} from '@/app/(dashboard)/scheduling/components/ScheduleSelectedVisitDetails';
import type {
  ScheduleAssignment,
  ScheduleJob,
  ScheduleVisit,
} from '@/types/scheduling';

const job = {
  id: 'job-1',
  job_reference: 'JOB-101',
  title: 'Crown reduction',
} as ScheduleJob;

const visit = {
  id: 'visit-1',
  job_id: 'job-1',
  sequence_number: 1,
  title: 'Morning visit',
  starts_at: '2026-07-14T08:00:00.000Z',
  ends_at: '2026-07-14T12:00:00.000Z',
} as ScheduleVisit;

const otherVisit = {
  ...visit,
  id: 'visit-2',
  sequence_number: 2,
  starts_at: '2026-07-14T13:00:00.000Z',
  ends_at: '2026-07-14T15:00:00.000Z',
} as ScheduleVisit;

function assignment(overrides: Record<string, unknown>): ScheduleAssignment {
  return {
    job_id: 'job-1',
    work_date: '2026-07-14',
    visit_id: 'visit-1',
    ...overrides,
  } as ScheduleAssignment;
}

describe('resolveSelectedVisitDetails', () => {
  const assignments = [
    assignment({
      id: 'employee-visit',
      resource_type: 'employee',
      employee: { full_name: 'Alex Smith' },
    }),
    assignment({
      id: 'plant-visit',
      resource_type: 'plant',
      plant: { nickname: 'Loader', plant_id: 'P001' },
    }),
    assignment({
      id: 'other-visit',
      resource_type: 'employee',
      visit_id: 'visit-2',
      employee: { full_name: 'Bob Jones' },
    }),
    assignment({
      id: 'unnamed',
      resource_type: 'employee',
      employee: { full_name: '   ' },
    }),
  ];

  it('returns the current visit names and omits another visit', () => {
    const details = resolveSelectedVisitDetails({
      jobId: 'job-1',
      visitId: 'visit-1',
      jobs: [job],
      visits: [visit, otherVisit],
      assignments,
      visibleDates: ['2026-07-14'],
    });

    expect(details?.job.title).toBe('Crown reduction');
    expect(details?.employees).toEqual(['Alex Smith']);
    expect(details?.plant).toEqual(['Loader']);
  });

  it('hides a deleted visit or a visit outside the visible day or week', () => {
    expect(resolveSelectedVisitDetails({
      jobId: 'job-1',
      visitId: 'missing',
      jobs: [job],
      visits: [visit],
      assignments,
      visibleDates: ['2026-07-14'],
    })).toBeNull();

    expect(resolveSelectedVisitDetails({
      jobId: 'job-1',
      visitId: 'visit-1',
      jobs: [job],
      visits: [visit],
      assignments,
      visibleDates: ['2026-07-20'],
    })).toBeNull();
  });
});

describe('ScheduleSelectedVisitDetails', () => {
  it('renders the job, exact time, and only the supplied names', () => {
    const onClear = vi.fn();
    render(
      <ScheduleSelectedVisitDetails
        details={{
          job,
          visit,
          visitDate: '2026-07-14',
          employees: ['Alex Smith'],
          plant: ['Loader'],
        }}
        onClear={onClear}
      />
    );

    const details = screen.getByTestId('schedule-selected-visit-details');
    expect(details).toHaveTextContent('JOB-101 · Visit 1');
    expect(details).toHaveTextContent('Crown reduction');
    expect(details).toHaveTextContent('09:00–13:00');
    expect(details).toHaveTextContent('Alex Smith');
    expect(details).toHaveTextContent('Loader');
    expect(details).not.toHaveTextContent('Bob Jones');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected visit' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
