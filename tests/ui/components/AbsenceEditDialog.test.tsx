/// <reference types="@testing-library/jest-dom/vitest" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AbsenceEditDialog } from '@/app/(dashboard)/absence/manage/components/AbsenceEditDialog';

const mutateAsync = vi.fn();

vi.mock('@/lib/hooks/useAbsence', () => ({
  useUpdateAbsence: () => ({
    mutateAsync,
  }),
}));

vi.mock('@/lib/client/work-shifts', () => ({
  fetchEmployeeWorkShift: vi.fn(async () => ({
    pattern: undefined,
  })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/utils/absence-timesheet-impact', () => ({
  buildAbsenceTimesheetImpactMessage: vi.fn(() => null),
  getLockedAbsenceTimesheetImpacts: vi.fn(() => []),
  resolveAbsenceTimesheetImpacts: vi.fn(async () => []),
}));

describe('AbsenceEditDialog', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it('submits an edited end date without recreating the booking', async () => {
    render(
      <AbsenceEditDialog
        open={true}
        onOpenChange={() => undefined}
        reasons={[
          {
            id: 'reason-annual',
            name: 'Annual Leave',
            is_active: true,
            is_paid: true,
            color: '#8b5cf6',
            created_at: '',
            updated_at: '',
          },
        ]}
        absence={{
          id: 'absence-1',
          profile_id: 'profile-1',
          date: '2026-05-11',
          end_date: '2026-05-15',
          reason_id: 'reason-annual',
          duration_days: 5,
          is_half_day: false,
          half_day_session: null,
          notes: 'Existing booking',
          status: 'approved',
          created_by: 'admin-1',
          approved_by: 'admin-1',
          approved_at: '2026-05-01T09:00:00.000Z',
          allow_timesheet_work_on_leave: false,
          processed_by: null,
          processed_at: null,
          is_bank_holiday: false,
          auto_generated: false,
          generation_source: null,
          holiday_key: null,
          bulk_batch_id: null,
          created_at: '2026-05-01T09:00:00.000Z',
          updated_at: '2026-05-01T09:00:00.000Z',
          profiles: {
            full_name: 'Alex Able',
            employee_id: 'E001',
          },
          absence_reasons: {
            id: 'reason-annual',
            name: 'Annual Leave',
            is_active: true,
            is_paid: true,
            color: '#8b5cf6',
            created_at: '',
            updated_at: '',
          },
        }}
      />
    );

    const endDateInput = screen.getByLabelText('End Date (optional)') as HTMLInputElement;
    fireEvent.change(endDateInput, { target: { value: '2026-05-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'absence-1',
        updates: expect.objectContaining({
          date: '2026-05-11',
          end_date: '2026-05-14',
          reason_id: 'reason-annual',
        }),
      });
    });
  });
});
