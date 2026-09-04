import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { mockAccess, mockRpc } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

const managerAccess = {
  allowed: true,
  status: 200,
  userId: '33333333-3333-4333-8333-333333333333',
  isManagerOrAdmin: true,
};

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/day-teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST/DELETE /api/scheduling/day-teams (SCH-TEAM-API-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(managerAccess);
    mockRpc.mockResolvedValue({
      data: [{
        work_date: '2026-09-01',
        slot_index: 1,
        profile_id: '22222222-2222-4222-8222-222222222222',
        added_by: managerAccess.userId,
        created_at: '2026-09-01T08:00:00.000Z',
      }],
      error: null,
    });
  });

  it('rejects employees without manager access', async () => {
    mockAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });
    const { POST } = await import('@/app/api/scheduling/day-teams/route');
    const response = await POST(post({
      work_date: '2026-09-01',
      slot_index: 1,
      profile_id: '22222222-2222-4222-8222-222222222222',
    }));
    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  }, 15000);

  it('adds a member through the locked RPC', async () => {
    const { POST } = await import('@/app/api/scheduling/day-teams/route');
    const response = await POST(post({
      work_date: '2026-09-01',
      slot_index: 2,
      profile_id: '22222222-2222-4222-8222-222222222222',
    }));
    expect(response.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'add_schedule_day_team_member_v1',
      expect.objectContaining({
        p_work_date: '2026-09-01',
        p_slot_index: 2,
        p_profile_id: '22222222-2222-4222-8222-222222222222',
        p_actor_user_id: managerAccess.userId,
      })
    );
  });

  it('sched-team-leader-locked maps the RPC lock to 409', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'TEAM_LEADER_LOCKED', code: 'P0001' },
    });
    const { DELETE } = await import('@/app/api/scheduling/day-teams/route');
    const response = await DELETE(
      new NextRequest(
        'http://localhost/api/scheduling/day-teams?work_date=2026-09-01&slot_index=1&profile_id=22222222-2222-4222-8222-222222222222',
        { method: 'DELETE' }
      )
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Settings/i);
  });

  it('maps a full slot to 409 without writing a generic 500', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'TEAM_SLOT_FULL', code: 'P0001' },
    });
    const { POST } = await import('@/app/api/scheduling/day-teams/route');
    const response = await POST(post({
      work_date: '2026-09-01',
      slot_index: 1,
      profile_id: '22222222-2222-4222-8222-222222222222',
    }));
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/six employees/i);
  });

  it('rejects placeholder mapping from the RPC', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'TEAM_PROFILE_INVALID', code: 'P0001' },
    });
    const { POST } = await import('@/app/api/scheduling/day-teams/route');
    const response = await POST(post({
      work_date: '2026-09-01',
      slot_index: 1,
      profile_id: '22222222-2222-4222-8222-222222222222',
    }));
    expect(response.status).toBe(400);
  });

  it('removes a member for the requested date and slot', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { DELETE } = await import('@/app/api/scheduling/day-teams/route');
    const response = await DELETE(
      new NextRequest(
        'http://localhost/api/scheduling/day-teams?work_date=2026-09-01&slot_index=3&profile_id=22222222-2222-4222-8222-222222222222',
        { method: 'DELETE' }
      )
    );
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'remove_schedule_day_team_member_v1',
      expect.objectContaining({
        p_work_date: '2026-09-01',
        p_slot_index: 3,
      })
    );
  });
});
