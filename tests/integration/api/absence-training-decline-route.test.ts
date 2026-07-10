import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/training-bookings', () => ({
  declineTrainingBookings: vi.fn(),
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { POST } from '@/app/api/absence/training-decline/route';

describe('POST /api/absence/training-decline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when no absence ids are provided', async () => {
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
      new NextRequest('http://localhost/api/absence/training-decline', {
        method: 'POST',
        body: JSON.stringify({ absenceIds: [] }),
      })
    );

    expect(response.status).toBe(400);
  });

  it('declines training bookings for an authenticated user', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { declineTrainingBookings } = await import('@/lib/server/training-bookings');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'employee-1' } },
          error: null,
        }),
      },
    } as never);

    vi.mocked(declineTrainingBookings).mockResolvedValue({
      deletedAbsenceIds: ['absence-1'],
      employeeName: 'Alice Employee',
      trainingDate: 'Wednesday 15 April 2026',
      notifiedProfileIds: ['manager-1', 'example-profile'],
      returnedTimesheetIds: [],
    });

    const response = await POST(
      new NextRequest('http://localhost/api/absence/training-decline', {
        method: 'POST',
        body: JSON.stringify({ absenceIds: ['absence-1'] }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(declineTrainingBookings).toHaveBeenCalledWith('employee-1', ['absence-1']);
  });
});
