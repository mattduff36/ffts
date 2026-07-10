import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ admin: true })),
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: vi.fn(),
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

vi.mock('@/lib/server/timesheet-delete', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/timesheet-delete')>();
  return {
    TimesheetDeleteError: actual.TimesheetDeleteError,
    listTimesheetAssociatedLeaveBookings: vi.fn(),
    deleteTimesheetWithOptionalLeaveBookings: vi.fn(),
  };
});

import { DELETE, GET } from '@/app/api/timesheets/[id]/delete/route';

describe('/api/timesheets/[id]/delete', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { createClient } = await import('@/lib/supabase/server');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
  });

  it('lists associated leave bookings before deletion', async () => {
    const { listTimesheetAssociatedLeaveBookings } = await import('@/lib/server/timesheet-delete');

    vi.mocked(listTimesheetAssociatedLeaveBookings).mockResolvedValue([
      {
        id: 'absence-1',
        date: '2026-06-17',
        endDate: null,
        reasonName: 'Training',
        status: 'approved',
        isHalfDay: true,
        halfDaySession: 'AM',
        durationDays: 0.5,
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/timesheets/timesheet-1/delete'),
      { params: Promise.resolve({ id: 'timesheet-1' }) }
    );
    if (!response) {
      throw new Error('Expected the delete preview route to return a response');
    }
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.associatedLeaveBookings).toHaveLength(1);
    expect(listTimesheetAssociatedLeaveBookings).toHaveBeenCalledWith(
      { admin: true },
      'timesheet-1'
    );
  });

  it('passes selected associated leave booking ids to the delete helper', async () => {
    const { deleteTimesheetWithOptionalLeaveBookings } = await import('@/lib/server/timesheet-delete');

    vi.mocked(deleteTimesheetWithOptionalLeaveBookings).mockResolvedValue({
      success: true,
      deletedAssociatedLeaveBookingCount: 2,
    });

    const response = await DELETE(
      new NextRequest('http://localhost/api/timesheets/timesheet-1/delete', {
        method: 'DELETE',
        body: JSON.stringify({ associatedLeaveBookingIdsToDelete: ['absence-1', 'absence-2'] }),
      }),
      { params: Promise.resolve({ id: 'timesheet-1' }) }
    );
    if (!response) {
      throw new Error('Expected the delete route to return a response');
    }
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.deletedAssociatedLeaveBookingCount).toBe(2);
    expect(deleteTimesheetWithOptionalLeaveBookings).toHaveBeenCalledWith(
      { admin: true },
      {
        timesheetId: 'timesheet-1',
        associatedLeaveBookingIdsToDelete: ['absence-1', 'absence-2'],
      }
    );
  });
});
