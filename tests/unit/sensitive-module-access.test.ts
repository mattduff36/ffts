import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canEffectiveRoleAccessModule: vi.fn(),
  extendCurrentSensitiveModuleAccess: vi.fn(),
  getSensitiveModulePinState: vi.fn(),
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mocks.canEffectiveRoleAccessModule,
}));

vi.mock('@/lib/server/sensitive-pin', () => ({
  extendCurrentSensitiveModuleAccess: mocks.extendCurrentSensitiveModuleAccess,
  getSensitiveModulePinState: mocks.getSensitiveModulePinState,
}));

import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

function buildSensitiveState(params: {
  required: boolean;
  unlocked: boolean;
  configured?: boolean;
  mustReset?: boolean;
}) {
  return {
    module_name: 'quotes',
    required: params.required,
    unlocked: params.unlocked,
    expires_at: params.unlocked ? '2026-07-01T09:20:00.000Z' : null,
    pin_status: {
      configured: params.configured ?? true,
      pin_length: 4,
      must_reset: params.mustReset ?? false,
      locked_until: null,
    },
  };
}

describe('requireSensitiveModuleAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canEffectiveRoleAccessModule.mockResolvedValue(true);
    mocks.extendCurrentSensitiveModuleAccess.mockResolvedValue('2026-07-01T09:25:00.000Z');
  });

  it('extends the sensitive access window when a protected module is already unlocked', async () => {
    mocks.getSensitiveModulePinState.mockResolvedValue(buildSensitiveState({
      required: true,
      unlocked: true,
    }));

    const response = await requireSensitiveModuleAccess('quotes');

    expect(response).toBeNull();
    expect(mocks.extendCurrentSensitiveModuleAccess).toHaveBeenCalledTimes(1);
  });

  it('does not extend access for modules that do not require a sensitive PIN', async () => {
    mocks.getSensitiveModulePinState.mockResolvedValue(buildSensitiveState({
      required: false,
      unlocked: true,
    }));

    const response = await requireSensitiveModuleAccess('quotes');

    expect(response).toBeNull();
    expect(mocks.extendCurrentSensitiveModuleAccess).not.toHaveBeenCalled();
  });

  it('returns a PIN required response without extending when the protected module is locked', async () => {
    mocks.getSensitiveModulePinState.mockResolvedValue(buildSensitiveState({
      required: true,
      unlocked: false,
    }));

    const response = await requireSensitiveModuleAccess('quotes');
    const payload = await response?.json();

    expect(response?.status).toBe(428);
    expect(payload).toMatchObject({
      code: 'SENSITIVE_PIN_REQUIRED',
      error: 'Sensitive access PIN required for protected modules.',
    });
    expect(mocks.extendCurrentSensitiveModuleAccess).not.toHaveBeenCalled();
  });
});
