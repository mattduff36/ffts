import { beforeEach, describe, expect, it, vi } from 'vitest';

const { single, eq } = vi.hoisted(() => ({ single: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq }) }) }),
}));
import { isPasswordChangeRequired } from '@/lib/server/app-auth/profile';

describe('live password-change requirement', () => {
  beforeEach(() => { vi.clearAllMocks(); eq.mockReturnValue({ single }); });
  it('reads the current flag rather than reusing an unrestricted profile', async () => {
    single.mockResolvedValueOnce({ data: { must_change_password: false }, error: null })
      .mockResolvedValueOnce({ data: { must_change_password: true }, error: null });
    expect(await isPasswordChangeRequired('profile-1')).toBe(false);
    expect(await isPasswordChangeRequired('profile-1')).toBe(true);
    expect(eq).toHaveBeenCalledWith('id', 'profile-1');
    expect(single).toHaveBeenCalledTimes(2);
  });
  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'offline' } },
  ])('fails closed when the profile cannot be verified', async (result) => {
    single.mockResolvedValue(result);
    await expect(isPasswordChangeRequired('profile-1')).rejects.toThrow('Unable to verify');
  });
});
