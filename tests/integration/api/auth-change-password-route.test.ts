import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateUserById, profileEq, from, verifyUserPassword } = vi.hoisted(() => {
  const updateUserById = vi.fn();
  const profileEq = vi.fn();
  const profileUpdate = vi.fn(() => ({ eq: profileEq }));
  const from = vi.fn(() => ({ update: profileUpdate }));
  const verifyUserPassword = vi.fn();
  return { updateUserById, profileEq, from, verifyUserPassword };
});

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/server/password-auth', () => ({
  verifyUserPassword,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        updateUserById,
      },
    },
    from,
  })),
}));

import { POST as changePasswordPost } from '@/app/api/auth/change-password/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

describe('auth change-password route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileEq.mockResolvedValue({ error: null });
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
        email: 'user-1@example.com',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    updateUserById.mockResolvedValue({ error: null });
    verifyUserPassword.mockResolvedValue(true);
  });

  it('preserves leading and trailing whitespace when updating the password', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: '  padded-secret  ',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(verifyUserPassword).toHaveBeenCalledWith('user-1@example.com', 'user-1', 'OldPassword123');
    expect(updateUserById).toHaveBeenCalledWith('user-1', {
      password: '  padded-secret  ',
    });
  });

  it('rejects requests without a current password', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Current password is required');
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('rejects an incorrect current password', async () => {
    verifyUserPassword.mockResolvedValue(false);

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'WrongPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Current password is incorrect');
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('rejects passwords that are only whitespace', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: '   ',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Password is required');
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
