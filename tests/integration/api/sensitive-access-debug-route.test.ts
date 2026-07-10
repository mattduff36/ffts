import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  canCurrentUserAccessDebugConsole: vi.fn(),
  getSensitiveModulePinState: vi.fn(),
  unlockSensitiveModuleWithPin: vi.fn(),
  renewSensitiveModuleAccess: vi.fn(),
  canEffectiveRoleAccessModule: vi.fn(),
}));

vi.mock('@/lib/server/debug-console-access', () => ({
  canCurrentUserAccessDebugConsole: mocks.canCurrentUserAccessDebugConsole,
  createDebugAccessErrorBody: (access: { error: string | null; code?: string; sensitive_access?: unknown }) => ({
    error: access.error,
    code: access.code,
    sensitive_access: access.sensitive_access,
  }),
}));

vi.mock('@/lib/server/sensitive-pin', () => ({
  getSensitiveModulePinState: mocks.getSensitiveModulePinState,
  unlockSensitiveModuleWithPin: mocks.unlockSensitiveModuleWithPin,
  renewSensitiveModuleAccess: mocks.renewSensitiveModuleAccess,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mocks.canEffectiveRoleAccessModule,
}));

import { GET as getStatus } from '@/app/api/sensitive-access/status/route';
import { POST as postUnlock } from '@/app/api/sensitive-access/unlock/route';
import { POST as postRenew } from '@/app/api/sensitive-access/renew/route';

function buildJsonRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/sensitive-access', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const unlockedDebugState = {
  module_name: 'debug',
  required: true,
  unlocked: true,
  expires_at: '2026-05-29T16:00:00.000Z',
  pin_status: {
    configured: true,
    pin_length: 4,
    must_reset: false,
    locked_until: null,
  },
};

describe('hidden debug sensitive access routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canCurrentUserAccessDebugConsole.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
    });
    mocks.getSensitiveModulePinState.mockResolvedValue(unlockedDebugState);
    mocks.unlockSensitiveModuleWithPin.mockResolvedValue(unlockedDebugState);
    mocks.renewSensitiveModuleAccess.mockResolvedValue(unlockedDebugState);
  });

  it('allows eligible debug users to check hidden debug PIN status', async () => {
    const response = await getStatus(new NextRequest('http://localhost/api/sensitive-access/status?module=debug'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.canCurrentUserAccessDebugConsole).toHaveBeenCalled();
    expect(mocks.canEffectiveRoleAccessModule).not.toHaveBeenCalled();
    expect(mocks.getSensitiveModulePinState).toHaveBeenCalledWith('debug');
    expect(payload.state).toMatchObject({ module_name: 'debug', unlocked: true });
  });

  it('allows eligible debug users to unlock the hidden debug module', async () => {
    const response = await postUnlock(buildJsonRequest({ module: 'debug', pin: '1234' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.unlockSensitiveModuleWithPin).toHaveBeenCalledWith({
      moduleName: 'debug',
      pin: '1234',
    });
    expect(payload.state).toMatchObject({ module_name: 'debug', unlocked: true });
  });

  it('allows eligible debug users to renew the hidden debug module unlock', async () => {
    const response = await postRenew(buildJsonRequest({ module: 'debug' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.renewSensitiveModuleAccess).toHaveBeenCalledWith('debug');
    expect(payload.state).toMatchObject({ module_name: 'debug', unlocked: true });
  });

  it('still rejects non-matrix modules other than debug', async () => {
    const response = await getStatus(new NextRequest('http://localhost/api/sensitive-access/status?module=not-real'));

    expect(response.status).toBe(400);
    expect(mocks.getSensitiveModulePinState).not.toHaveBeenCalled();
  });
});
