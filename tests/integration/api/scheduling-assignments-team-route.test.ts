import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { mockAccess, mockAssign } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockAssign: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));
vi.mock('@/lib/server/scheduling-day-teams', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/scheduling-day-teams')>(
    '@/lib/server/scheduling-day-teams'
  );
  return {
    ...actual,
    assignDayTeamToVisit: mockAssign,
  };
});
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ name: 'admin' }),
}));

const managerAccess = {
  allowed: true,
  status: 200,
  userId: '33333333-3333-4333-8333-333333333333',
  isManagerOrAdmin: true,
};

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/assignments/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/scheduling/assignments/team (SCH-TEAM-API-002, SCH-TEAM-API-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(managerAccess);
    mockAssign.mockResolvedValue({
      assignments: [{
        id: 'assignment-1',
        job_id: '11111111-1111-4111-8111-111111111111',
        work_date: '2026-09-01',
        visit_id: '55555555-5555-4555-8555-555555555555',
        notes: null,
        conflict_override: false,
        conflict_codes: [],
        conflict_override_by: null,
        conflict_override_at: null,
        assigned_by: managerAccess.userId,
        created_at: '2026-09-01T08:00:00.000Z',
        updated_at: '2026-09-01T08:00:00.000Z',
        resource_type: 'employee',
        profile_id: '22222222-2222-4222-8222-222222222222',
      }],
      skipped: [{
        profile_id: '44444444-4444-4444-8444-444444444444',
        full_name: 'Busy Person',
        reason: 'conflict',
        conflicts: [{
          code: 'employee_double_booked',
          severity: 'warning',
          message: 'Already booked',
        }],
      }],
      already_assigned_count: 1,
      employee_capacity: [],
    });
  });

  it('rejects missing manager access', async () => {
    mockAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });
    const { POST } = await import('@/app/api/scheduling/assignments/team/route');
    const response = await POST(post({
      visit_id: '55555555-5555-4555-8555-555555555555',
      slot_index: 1,
    }));
    expect(response.status).toBe(403);
    expect(mockAssign).not.toHaveBeenCalled();
  }, 15000);

  it('SCH-TEAM-API-003 does not accept a client work_date and reuses the server helper', async () => {
    const { POST } = await import('@/app/api/scheduling/assignments/team/route');
    const response = await POST(post({
      visit_id: '55555555-5555-4555-8555-555555555555',
      slot_index: 2,
      work_date: '1999-01-01',
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mockAssign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        visitId: '55555555-5555-4555-8555-555555555555',
        slotIndex: 2,
        actorUserId: managerAccess.userId,
      })
    );
    expect(mockAssign.mock.calls[0][1]).not.toHaveProperty('workDate');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.skipped).toHaveLength(1);
    expect(payload.already_assigned_count).toBe(1);
  });

  it('maps a missing visit to 404', async () => {
    mockAssign.mockResolvedValue({ status: 404, error: 'Scheduling visit not found.' });
    const { POST } = await import('@/app/api/scheduling/assignments/team/route');
    const response = await POST(post({
      visit_id: '55555555-5555-4555-8555-555555555555',
      slot_index: 1,
    }));
    expect(response.status).toBe(404);
  });
});
