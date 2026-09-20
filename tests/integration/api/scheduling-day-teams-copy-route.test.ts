import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockAccess, mockCopy } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockCopy: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn(), rpc: vi.fn() }),
}));
vi.mock('@/lib/server/scheduling-day-teams', () => ({
  copyScheduleDayTeamMembers: mockCopy,
}));

const managerAccess = {
  allowed: true,
  status: 200,
  userId: '33333333-3333-4333-8333-333333333333',
  isManagerOrAdmin: true,
};

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/day-teams/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/scheduling/day-teams/copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(managerAccess);
    mockCopy.mockResolvedValue({
      members: [{
        work_date: '2026-09-21',
        slot_index: 2,
        profile_id: '22222222-2222-4222-8222-222222222222',
        added_by: managerAccess.userId,
        created_at: '2026-09-21T08:00:00.000Z',
      }],
      copied: 1,
      skipped: 0,
    });
  });

  it('rejects employees without manager access', async () => {
    mockAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });
    const { POST } = await import('@/app/api/scheduling/day-teams/copy/route');
    const response = await POST(post({
      from_date: '2026-09-20',
      to_date: '2026-09-21',
    }));
    expect(response.status).toBe(403);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('copies teams from the requested date', async () => {
    const { POST } = await import('@/app/api/scheduling/day-teams/copy/route');
    const response = await POST(post({
      from_date: '2026-09-20',
      to_date: '2026-09-21',
    }));
    expect(response.status).toBe(200);
    expect(mockCopy).toHaveBeenCalledWith(
      expect.anything(),
      {
        fromDate: '2026-09-20',
        toDate: '2026-09-21',
        actorUserId: managerAccess.userId,
      }
    );
    expect(await response.json()).toMatchObject({ copied: 1, skipped: 0 });
  });

  it('returns the helper validation error for the same date', async () => {
    mockCopy.mockResolvedValue({
      status: 400,
      error: 'Choose a different date to copy from.',
    });
    const { POST } = await import('@/app/api/scheduling/day-teams/copy/route');
    const response = await POST(post({
      from_date: '2026-09-21',
      to_date: '2026-09-21',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Choose a different date to copy from.',
    });
  });
});
