/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleAssignmentDialog } from '@/app/(dashboard)/scheduling/components/ScheduleAssignmentDialog';
import { SchedulingApiError } from '@/lib/client/scheduling';
import type { ScheduleJob } from '@/types/scheduling';

const { mockCreateAssignment } = vi.hoisted(() => ({
  mockCreateAssignment: vi.fn(),
}));

vi.mock('@/lib/client/scheduling', async () => {
  const actual = await vi.importActual<typeof import('@/lib/client/scheduling')>(
    '@/lib/client/scheduling'
  );
  return {
    ...actual,
    createScheduleAssignment: mockCreateAssignment,
  };
});

const job: ScheduleJob = {
  id: 'job-1',
  job_reference: 'JOB-101',
  title: 'Crown reduction',
  description: null,
  site_address: 'Riverside',
  status: 'scheduled',
  source_type: 'manual',
  start_date: '2026-07-13',
  end_date: '2026-07-15',
  quote_id: null,
  quote_project_number_id: null,
  customer_id: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

function renderDialog(onSaved = vi.fn()) {
  render(
    <ScheduleAssignmentDialog
      open
      onOpenChange={vi.fn()}
      job={job}
      initialDate="2026-07-14"
      initialResource={{ type: 'employee', id: 'employee-1', label: 'Alex Smith' }}
      employees={[{
        id: 'employee-1',
        full_name: 'Alex Smith',
        employee_id: 'E001',
        team_id: 'team-1',
        team_name: 'Arborists',
      }]}
      plant={[]}
      onSaved={onSaved}
    />
  );
  return onSaved;
}

describe('ScheduleAssignmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supports assigning through the non-drag dialog', async () => {
    mockCreateAssignment.mockResolvedValue(undefined);
    const onSaved = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(mockCreateAssignment).toHaveBeenCalledWith({
      job_id: 'job-1',
      resource_type: 'employee',
      resource_id: 'employee-1',
      work_dates: ['2026-07-14'],
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows server conflicts and allows an audited override retry', async () => {
    mockCreateAssignment
      .mockRejectedValueOnce(
        new SchedulingApiError('Conflict', 409, {
          conflicts_by_date: {
            '2026-07-14': [{
              code: 'employee_absent',
              severity: 'warning',
              message: 'Employee has approved absence.',
            }],
          },
        })
      )
      .mockResolvedValueOnce(undefined);
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('Employee has approved absence.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Assign anyway' }));

    await waitFor(() =>
      expect(mockCreateAssignment).toHaveBeenLastCalledWith(
        expect.objectContaining({ override_conflicts: true })
      )
    );
  });
});
