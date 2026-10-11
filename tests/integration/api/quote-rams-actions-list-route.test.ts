import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const harness = vi.hoisted(() => ({
  getUser: vi.fn(),
  canEffectiveRoleAccessModule: vi.fn(),
  isManagerOrAdmin: vi.fn(),
  callerIsQuoteAdmin: vi.fn(),
  listQuoteRamsActions: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: harness.getUser } }),
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: harness.canEffectiveRoleAccessModule,
}));

vi.mock('@/lib/utils/permissions', () => ({
  isManagerOrAdmin: harness.isManagerOrAdmin,
}));

vi.mock('@/lib/server/quote-rams-actions', () => ({
  callerIsQuoteAdmin: harness.callerIsQuoteAdmin,
  listQuoteRamsActions: harness.listQuoteRamsActions,
}));

const USER_ID = '22222222-2222-4222-8222-222222222222';

function get(status = 'open') {
  return new NextRequest(`http://localhost/api/quote-rams-actions?status=${status}`);
}

describe('GET /api/quote-rams-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    harness.canEffectiveRoleAccessModule.mockResolvedValue(false);
    harness.isManagerOrAdmin.mockResolvedValue(false);
    harness.callerIsQuoteAdmin.mockResolvedValue(false);
    harness.listQuoteRamsActions.mockResolvedValue([]);
  });

  it('requires a signed-in user', async () => {
    const { GET } = await import('@/app/api/quote-rams-actions/route');
    harness.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(get());
    expect(response.status).toBe(401);
    expect(harness.listQuoteRamsActions).not.toHaveBeenCalled();
  });

  it('lists own rows unless the caller is an actions manager or admin', async () => {
    const { GET } = await import('@/app/api/quote-rams-actions/route');

    const own = await GET(get());
    expect(own.status).toBe(200);
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: false,
      status: 'open',
    });

    harness.canEffectiveRoleAccessModule.mockResolvedValue(true);
    harness.isManagerOrAdmin.mockResolvedValue(true);
    const managers = await GET(get('all'));
    expect(managers.status).toBe(200);
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: true,
      status: null,
    });

    harness.isManagerOrAdmin.mockResolvedValue(false);
    harness.callerIsQuoteAdmin.mockResolvedValue(true);
    await GET(get('completed'));
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: true,
      status: 'completed',
    });

    harness.canEffectiveRoleAccessModule.mockResolvedValue(false);
    await GET(get());
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: false,
      status: 'open',
    });
  });
});
