import { beforeEach, describe, expect, it, vi } from 'vitest';
const { from, update, eq, is, select } = vi.hoisted(() => ({
  from: vi.fn(), update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }));
vi.mock('@/lib/server/webauthn/devices', () => ({ getWebAuthnDevice: vi.fn(), parseWebAuthnDeviceId: vi.fn(), upsertWebAuthnDevice: vi.fn() }));
import { revokeWebAuthnCredentialsForProfile } from '@/lib/server/webauthn/credentials';

describe('profile-wide biometric revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ update }); update.mockReturnValue({ eq });
    eq.mockReturnValue({ is }); is.mockReturnValue({ select });
    select.mockResolvedValue({ data: [{ id: 'credential-1' }, { id: 'credential-2' }], error: null });
  });
  it('revokes every active credential, without restricting to a device', async () => {
    expect(await revokeWebAuthnCredentialsForProfile('user-1')).toBe(2);
    expect(from).toHaveBeenCalledWith('webauthn_credentials');
    expect(update).toHaveBeenCalledWith({ revoked_at: expect.any(String) });
    expect(eq).toHaveBeenCalledExactlyOnceWith('profile_id', 'user-1');
    expect(is).toHaveBeenCalledWith('revoked_at', null);
  });
  it('accepts an account with no enrolled devices', async () => {
    select.mockResolvedValue({ data: [], error: null });
    expect(await revokeWebAuthnCredentialsForProfile('user-1')).toBe(0);
  });
  it.each([
    { data: null, error: { message: 'write rejected' } },
    { data: null, error: null },
  ])('does not claim revocation when the write is unconfirmed', async (result) => {
    select.mockResolvedValue(result);
    await expect(revokeWebAuthnCredentialsForProfile('user-1')).rejects.toThrow('Failed to revoke');
  });
});
