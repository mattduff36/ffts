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
        data: {
          visible_slot_count: 8,
          names: { '1': '  Stored crew  ', '9': '   ' },
          updated_by: managerAccess.userId,
          updated_at: '2026-09-01T08:00:00.000Z',
        },
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
      visible_slot_count: 8,
      leaders: [],
    }));
    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps TEAM_SLOT_FULL from the settings RPC to 409', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'TEAM_SLOT_FULL', code: 'P0001' },
    });
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const response = await PUT(put({
      visible_slot_count: 8,
      leaders: [{ slot_index: 1, profile_id: '22222222-2222-4222-8222-222222222222' }],
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'This team already has six employees on at least one day. Remove a member before adding a standing leader.',
    });
  });

  it.each([8, 16])('sched-team-settings-persist saves %i teams and a leader through save v2', async (count) => {
    mockRpc.mockResolvedValue({ data: [{ visible_slot_count: count }], error: null });
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const response = await PUT(put({
      visible_slot_count: count,
      leaders: [{ slot_index: 1, profile_id: '22222222-2222-4222-8222-222222222222' }],
    }));
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'save_schedule_team_settings_v2',
      expect.objectContaining({
        p_visible_slot_count: count,
        p_names: null,
        p_leaders: expect.arrayContaining([
          { slot_index: 1, profile_id: '22222222-2222-4222-8222-222222222222' },
        ]),
        p_actor_user_id: managerAccess.userId,
      })
    );
    const body = await response.json();
    expect(body.settings.visible_slot_count).toBe(count);
    expect(body.settings.names).toEqual({ '1': 'Stored crew' });
    expect(mockRpc.mock.calls[0]?.[1].p_leaders).toHaveLength(count);
  });

  it('sched-team-settings-names-roundtrip trims names and keeps a leader on slot 16', async () => {
    mockRpc.mockResolvedValue({ data: [{ visible_slot_count: 16 }], error: null });
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const response = await PUT(put({
      visible_slot_count: 16,
      leaders: [{ slot_index: 16, profile_id: '22222222-2222-4222-8222-222222222222' }],
      names: { '16': '  West crew  ', '1': '   ' },
    }));
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'save_schedule_team_settings_v2',
      expect.objectContaining({
        p_visible_slot_count: 16,
        p_names: { '16': 'West crew' },
        p_actor_user_id: managerAccess.userId,
      })
    );
    const leaders = mockRpc.mock.calls[0]?.[1].p_leaders as Array<{
      slot_index: number;
      profile_id: string | null;
    }>;
    expect(leaders).toHaveLength(16);
    expect(leaders[15]).toEqual({
      slot_index: 16,
      profile_id: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('rejects duplicate leader slots and profiles before the RPC', async () => {
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const duplicateSlot = await PUT(put({
      visible_slot_count: 8,
      leaders: [
        { slot_index: 1, profile_id: '22222222-2222-4222-8222-222222222222' },
        { slot_index: 1, profile_id: '44444444-4444-4444-8444-444444444444' },
      ],
    }));
    expect(duplicateSlot.status).toBe(400);
    expect(await duplicateSlot.json()).toEqual({
      error: 'Each team slot can have only one leader.',
    });

    const duplicateProfile = await PUT(put({
      visible_slot_count: 8,
      leaders: [
        { slot_index: 1, profile_id: '22222222-2222-4222-8222-222222222222' },
        { slot_index: 2, profile_id: '22222222-2222-4222-8222-222222222222' },
      ],
    }));
    expect(duplicateProfile.status).toBe(400);
    expect(await duplicateProfile.json()).toEqual({
      error: 'Choose distinct active employees as team leaders.',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ '17': 'Nope' }, 'Custom team names must use a visible team slot.'],
    [{ nope: 'Nope' }, 'Custom team names must use a visible team slot.'],
    [{ '9': 'Hidden' }, 'Custom team names must use a visible team slot.'],
    [{ '1': 'x'.repeat(81) }, 'Custom team names must be 80 characters or fewer.'],
  ])('rejects bad team names %#', async (names, message) => {
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const response = await PUT(put({
      visible_slot_count: 8,
      leaders: [],
      names,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a leader on a hidden slot and maps occupied hidden buckets', async () => {
    const { PUT } = await import('@/app/api/scheduling/team-settings/route');
    const hiddenLeader = await PUT(put({
      visible_slot_count: 8,
      leaders: [{ slot_index: 9, profile_id: '22222222-2222-4222-8222-222222222222' }],
    }));
    expect(hiddenLeader.status).toBe(400);
    expect(await hiddenLeader.json()).toEqual({
      error: 'Leaders can only be set on visible teams.',
    });
    expect(mockRpc).not.toHaveBeenCalled();

    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'TEAM_SLOT_IN_USE', code: 'P0001' },
    });
    const occupied = await PUT(put({
      visible_slot_count: 8,
      leaders: [],
    }));
    expect(occupied.status).toBe(409);
    expect(await occupied.json()).toEqual({
      error: 'Remove employees and plant from extra teams before hiding those buckets.',
    });
  });
});
