import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const harness = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireSensitiveModuleAccess: vi.fn(),
  getEffectiveModuleAccessLevel: vi.fn(),
  listQuoteRamsActions: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: harness.getUser } }),
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: harness.requireSensitiveModuleAccess,
}));

vi.mock('@/lib/utils/rbac', () => ({
  getEffectiveModuleAccessLevel: harness.getEffectiveModuleAccessLevel,
}));

vi.mock('@/lib/server/quote-rams-actions', () => ({
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
    harness.requireSensitiveModuleAccess.mockResolvedValue(null);
    harness.getEffectiveModuleAccessLevel.mockResolvedValue(1);
    harness.listQuoteRamsActions.mockResolvedValue([]);
  });

  it('requires a signed-in user', async () => {
    const { GET } = await import('@/app/api/quote-rams-actions/route');
    harness.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(get());
    expect(response.status).toBe(401);
    expect(harness.listQuoteRamsActions).not.toHaveBeenCalled();
    expect(harness.requireSensitiveModuleAccess).not.toHaveBeenCalled();
  });

  it('lists own rows below actions level 4 and every row at level 4 or above', async () => {
    const { GET } = await import('@/app/api/quote-rams-actions/route');

    const own = await GET(get());
    expect(own.status).toBe(200);
    expect(harness.requireSensitiveModuleAccess).toHaveBeenCalledWith('actions');
    expect(harness.getEffectiveModuleAccessLevel).toHaveBeenCalledWith('actions');
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: false,
      status: 'open',
    });

    harness.getEffectiveModuleAccessLevel.mockResolvedValue(3);
    await GET(get('completed'));
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: false,
      status: 'completed',
    });

    harness.getEffectiveModuleAccessLevel.mockResolvedValue(4);
    const managers = await GET(get('all'));
    expect(managers.status).toBe(200);
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: true,
      status: null,
    });

    harness.getEffectiveModuleAccessLevel.mockResolvedValue(5);
    await GET(get());
    expect(harness.listQuoteRamsActions).toHaveBeenLastCalledWith({
      userId: USER_ID,
      listAll: true,
      status: 'open',
    });
  });

  it('returns the actions guard response and does not list when the matrix lookup fails', async () => {
    const { GET } = await import('@/app/api/quote-rams-actions/route');

    harness.requireSensitiveModuleAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );
    const forbidden = await GET(get());
    expect(forbidden.status).toBe(403);
    expect(harness.listQuoteRamsActions).not.toHaveBeenCalled();

    harness.requireSensitiveModuleAccess.mockResolvedValue(
      NextResponse.json({ error: 'Sensitive access PIN required for protected modules.', code: 'SENSITIVE_PIN_REQUIRED' }, { status: 428 })
    );
    const pin = await GET(get());
    expect(pin.status).toBe(428);
    expect(harness.getEffectiveModuleAccessLevel).not.toHaveBeenCalled();
    expect(harness.listQuoteRamsActions).not.toHaveBeenCalled();

    harness.requireSensitiveModuleAccess.mockResolvedValue(null);
    harness.getEffectiveModuleAccessLevel.mockResolvedValue(0);
    const revoked = await GET(get());
    expect(revoked.status).toBe(403);
    expect(harness.listQuoteRamsActions).not.toHaveBeenCalled();

    harness.getEffectiveModuleAccessLevel.mockRejectedValue(new Error('matrix lookup failed'));
    const failed = await GET(get());
    expect(failed.status).toBe(500);
    expect(harness.listQuoteRamsActions).not.toHaveBeenCalled();
  });
});
