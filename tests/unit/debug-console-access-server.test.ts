import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  getSensitiveModulePinState: vi.fn(),
  getEffectiveRole: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mocks.getCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/server/sensitive-pin', () => ({
  getSensitiveModulePinState: mocks.getSensitiveModulePinState,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mocks.getEffectiveRole,
}));

import { requireDebugConsoleAccess } from '@/lib/server/debug-console-access';

describe('requireDebugConsoleAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: {
        id: 'superadmin-profile',
        email: 'admin@example.com',
      },
    });
    mocks.getEffectiveRole.mockResolvedValue({
      is_actual_super_admin: true,
      is_viewing_as: false,
    });
  });

  it('preserves the authenticated profile id when sensitive PIN is not required', async () => {
    mocks.getSensitiveModulePinState.mockResolvedValue({
      module_name: 'debug',
      required: false,
      unlocked: false,
      expires_at: null,
      pin_status: {
        configured: false,
        pin_length: null,
        must_reset: false,
        locked_until: null,
      },
    });

    const access = await requireDebugConsoleAccess();

    expect(access).toMatchObject({
      ok: true,
      status: 200,
      error: null,
      profileId: 'superadmin-profile',
    });
  });

  it('preserves the authenticated profile id when sensitive PIN is already unlocked', async () => {
    mocks.getSensitiveModulePinState.mockResolvedValue({
      module_name: 'debug',
      required: true,
      unlocked: true,
      expires_at: '2026-05-29T17:00:00.000Z',
      pin_status: {
        configured: true,
        pin_length: 4,
        must_reset: false,
        locked_until: null,
      },
    });

    const access = await requireDebugConsoleAccess();

    expect(access).toMatchObject({
      ok: true,
      status: 200,
      error: null,
      profileId: 'superadmin-profile',
    });
  });
});
