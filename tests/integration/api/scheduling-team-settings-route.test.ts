import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { mockAccess, mockRpc, mockFrom } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

const managerAccess = {
  allowed: true,
  status: 200,
  userId: '33333333-3333-4333-8333-333333333333',
  isManagerOrAdmin: true,
};

function put(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/team-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/scheduling/team-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(managerAccess);
    mockRpc.mockResolvedValue({
      data: [{
        visible_slot_count: 6,
        updated_by: managerAccess.userId,
        updated_at: '2026-09-01T08:00:00.000Z',
        leaders: [],
      }],
      error: null,
    });
    const result = {
      select: () => result,
      eq: () => result,
      order: () => result,
      maybeSingle: async () => ({
        data: { visible_slot_count: 6, updated_by: managerAccess.userId, updated_at: '2026-09-01T08:00:00.000Z' },
        error: null,
      }),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: [], error: null })),
    };
    mockFrom.mockReturnValue(result);
  });

  it('sched-team-rls-manager-boundary rejects employees', async () => {
    mockAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const response = await PUT(put({
      visible_slot_count: 5,
      leaders: [],
    }));
    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sched-team-settings-persist saves through the locked RPC', async () => {
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const response = await PUT(put({
      visible_slot_count: 6,
      leaders: [{ slot_index: 1, profile_id: '22222222-2222-4222-8222-222222222222' }],
    }));
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'save_schedule_team_settings_v1',
      expect.objectContaining({
        p_visible_slot_count: 6,
        p_actor_user_id: managerAccess.userId,
      })
    );
  });
});
