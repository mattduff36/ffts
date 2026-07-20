import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockAccess } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingAccess: mockAccess,
}));

describe('GET /api/scheduling/context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      accessLevel: 4,
      isManagerOrAdmin: true,
      roleName: 'manager',
      roleClass: 'manager',
      teamId: 'team-1',
      teamName: 'Arborists',
    });
  });

  it('returns the effective scheduling level used by the management gate', async () => {
    const { GET } = await import('@/app/api/scheduling/context/route');
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      user_id: 'manager-1',
      access_level: 4,
      is_manager_or_admin: true,
      role_name: 'manager',
      role_class: 'manager',
      team_id: 'team-1',
      team_name: 'Arborists',
    });
  });

  it('returns a clear service error when permission resolution fails', async () => {
    mockAccess.mockRejectedValue(new Error('permission service failed'));
    const { GET } = await import('@/app/api/scheduling/context/route');
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to verify scheduling access right now.',
    });
  });
});
