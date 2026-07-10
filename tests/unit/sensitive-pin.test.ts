import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  verifyUserPassword: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mocks.getCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/server/password-auth', () => ({
  verifyUserPassword: mocks.verifyUserPassword,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/server/sensitive-pin-notifications', () => ({
  notifyAdminsOfSensitivePinEvent: vi.fn(),
}));

import { renewSensitiveModuleAccess, requestSensitivePinVerification, validateSensitivePin } from '@/lib/server/sensitive-pin';

function createQueryChain(
  chainMethods: string[],
  terminalMethod: string,
  terminalResult: unknown
): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chainMethods.forEach((methodName) => {
    chain[methodName] = vi.fn(() => chain);
  });
  chain[terminalMethod] = vi.fn().mockResolvedValue(terminalResult);
  return chain;
}

describe('sensitive PIN helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: {
        id: 'user-1',
        email: 'user@example.com',
        full_name: 'User One',
      },
      validation: { session: { id: 'session-1' } },
    });
  });

  it('accepts only 4 or 6 digit PINs', () => {
    expect(validateSensitivePin('1234')).toEqual({ valid: true, length: 4 });
    expect(validateSensitivePin('123456')).toEqual({ valid: true, length: 6 });
    expect(validateSensitivePin('12345').valid).toBe(false);
    expect(validateSensitivePin('12a4').valid).toBe(false);
  });

  it('rejects a sensitive PIN that matches the main password before writing tokens', async () => {
    mocks.verifyUserPassword.mockResolvedValue(true);

    await expect(
      requestSensitivePinVerification({ pin: '1234', purpose: 'setup' })
    ).rejects.toThrow('Sensitive PIN cannot be the same as your main password');

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('renews active sensitive module unlocks for the current session', async () => {
    const unlockCheckChain = createQueryChain(['eq', 'gt'], 'maybeSingle', { data: { module_name: 'quotes' }, error: null });
    const unlockStateChain = createQueryChain(['eq', 'gt', 'order', 'limit'], 'maybeSingle', {
      data: { expires_at: '2026-05-28T13:20:00.000Z' },
      error: null,
    });
    const updateChain = createQueryChain(['eq'], 'gt', { error: null });
    const permissionModuleChain = createQueryChain(['eq'], 'maybeSingle', { data: { module_name: 'quotes', requires_sensitive_pin: true }, error: null });
    const sensitivePinChain = createQueryChain(['eq'], 'maybeSingle', {
        data: {
          pin_hash: 'hash',
          pin_salt: 'salt',
          pin_length: 4,
          failed_attempts: 0,
          locked_until: null,
          must_reset: false,
        },
        error: null,
      });
    const update = vi.fn(() => updateChain);

    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'sensitive_pin_unlocks') {
          return {
            select: vi.fn((columns: string) => columns === 'module_name' ? unlockCheckChain : unlockStateChain),
            update,
          };
        }

        if (table === 'permission_modules') {
          return { select: vi.fn(() => permissionModuleChain) };
        }

        if (table === 'profile_sensitive_pins') {
          return { select: vi.fn(() => sensitivePinChain) };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const state = await renewSensitiveModuleAccess('quotes');

    expect(update).toHaveBeenCalledWith({
      expires_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(updateChain.eq).toHaveBeenCalledWith('profile_id', 'user-1');
    expect(updateChain.eq).toHaveBeenCalledWith('session_id', 'session-1');
    expect(state).toMatchObject({
      module_name: 'quotes',
      required: true,
      unlocked: true,
      expires_at: '2026-05-28T13:20:00.000Z',
    });
  });

  it('does not renew an expired sensitive module unlock', async () => {
    const unlockCheckChain = createQueryChain(['eq', 'gt'], 'maybeSingle', { data: null, error: null });
    const update = vi.fn();

    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'sensitive_pin_unlocks') {
          return {
            select: vi.fn(() => unlockCheckChain),
            update,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    await expect(renewSensitiveModuleAccess('quotes')).rejects.toThrow('Sensitive access PIN required');
    expect(update).not.toHaveBeenCalled();
  });
});
