import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/sensitive-access/renew/route';

const {
  mockCanEffectiveRoleAccessModule,
  mockRenewSensitiveModuleAccess,
} = vi.hoisted(() => ({
  mockCanEffectiveRoleAccessModule: vi.fn(),
  mockRenewSensitiveModuleAccess: vi.fn(),
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanEffectiveRoleAccessModule,
}));

vi.mock('@/lib/server/sensitive-pin', () => ({
  renewSensitiveModuleAccess: mockRenewSensitiveModuleAccess,
}));

function buildRenewRequest(moduleName: string) {
  return new NextRequest('http://localhost/api/sensitive-access/renew', {
    method: 'POST',
    body: JSON.stringify({ module: moduleName }),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/sensitive-access/renew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanEffectiveRoleAccessModule.mockResolvedValue(true);
    mockRenewSensitiveModuleAccess.mockResolvedValue({
      module_name: 'quotes',
      required: true,
      unlocked: true,
      expires_at: '2026-05-28T13:20:00.000Z',
      pin_status: {
        configured: true,
        pin_length: 4,
        must_reset: false,
        locked_until: null,
      },
    });
  });

  it('renews an existing sensitive module unlock', async () => {
    const response = await POST(buildRenewRequest('quotes'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockCanEffectiveRoleAccessModule).toHaveBeenCalledWith('quotes');
    expect(mockRenewSensitiveModuleAccess).toHaveBeenCalledWith('quotes');
    expect(payload.state).toMatchObject({
      module_name: 'quotes',
      unlocked: true,
      expires_at: '2026-05-28T13:20:00.000Z',
    });
  });

  it('returns 428 when the unlock has already expired', async () => {
    mockRenewSensitiveModuleAccess.mockRejectedValue(new Error('Sensitive access PIN required for protected modules.'));

    const response = await POST(buildRenewRequest('customers'));
    const payload = await response.json();

    expect(response.status).toBe(428);
    expect(payload).toEqual({
      error: 'Sensitive access PIN required for protected modules.',
      code: 'SENSITIVE_PIN_REQUIRED',
    });
  });
});
