import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ admin: true })),
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));

vi.mock('@/lib/server/timesheet-did-not-work-bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/timesheet-did-not-work-bookings')>();
  return {
    TimesheetDidNotWorkBookingError: actual.TimesheetDidNotWorkBookingError,
    commitTimesheetDidNotWorkBookings: vi.fn(),
  };
});

import { POST } from '@/app/api/timesheets/[id]/did-not-work-bookings/route';

describe('POST /api/timesheets/[id]/did-not-work-bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid booking payloads', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'employee-1' } },
          error: null,
        }),
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/timesheets/timesheet-1/did-not-work-bookings', {
        method: 'POST',
        body: JSON.stringify({ bookings: [{ dayOfWeek: 2, date: '2026-04-28', kind: 'holiday' }] }),
      }),
      { params: Promise.resolve({ id: 'timesheet-1' }) }
    );

    expect(response.status).toBe(400);
  });

  it('commits bookings for an authenticated timesheet user', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { commitTimesheetDidNotWorkBookings } = await import('@/lib/server/timesheet-did-not-work-bookings');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'employee-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_class: 'employee',
      role_name: 'Employee',
      team_name: 'Civils',
      is_manager_admin: false,
      is_super_admin: false,
    } as never);
    vi.mocked(commitTimesheetDidNotWorkBookings).mockResolvedValue({
      insertedAbsenceIds: ['absence-1'],
      existingAbsenceIds: [],
      notifiedProfileIds: ['manager-1', 'accounts-1'],
    });

    const bookings = [{ dayOfWeek: 2, date: '2026-04-28', kind: 'sickness' as const }];
    const response = await POST(
      new NextRequest('http://localhost/api/timesheets/timesheet-1/did-not-work-bookings', {
        method: 'POST',
        body: JSON.stringify({ bookings }),
      }),
      { params: Promise.resolve({ id: 'timesheet-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.insertedAbsenceIds).toEqual(['absence-1']);
    expect(commitTimesheetDidNotWorkBookings).toHaveBeenCalledWith(
      { admin: true },
      {
        actorUserId: 'employee-1',
        timesheetId: 'timesheet-1',
        canManageOtherUsers: false,
        bookings,
      }
    );
  });
});
