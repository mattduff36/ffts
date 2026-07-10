/// <reference types="@testing-library/jest-dom/vitest" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DEFAULT_COLUMN_VISIBILITY,
  TimesheetsApprovalTable,
} from '@/app/(dashboard)/approvals/components/TimesheetsApprovalTable';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

function buildTimesheet(status: string) {
  return {
    id: `timesheet-${status}`,
    user_id: 'profile-1',
    week_ending: '2026-06-14',
    status,
    submitted_at: '2026-06-16T08:00:00.000Z',
    user: {
      full_name: 'Zak Edlin',
      employee_id: 'ZE001',
    },
    timesheet_entries: [
      {
        day_of_week: 1,
        daily_total: 9,
        job_number: '40029-GH',
        working_in_yard: false,
        did_not_work: false,
      },
    ],
  } as Parameters<typeof TimesheetsApprovalTable>[0]['timesheets'][number];
}

describe('TimesheetsApprovalTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Adjust and Manager Approved actions for payroll received timesheets', () => {
    const onProcess = vi.fn();

    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('approved')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={onProcess}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      />
    );

    expect(screen.getByRole('button', { name: 'Adjust' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manager Approved' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));

    expect(pushMock).toHaveBeenCalledWith('/timesheets/timesheet-approved');
    expect(onProcess).not.toHaveBeenCalled();
  });

  it('keeps Manager Approved wired to the process action', () => {
    const onProcess = vi.fn();

    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('approved')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={onProcess}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manager Approved' }));

    expect(onProcess).toHaveBeenCalledWith('timesheet-approved');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
