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

vi.mock('@/lib/server/app-auth/credential-lock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/app-auth/credential-lock')>();
  return { ...actual, withCredentialLock: vi.fn() };
});

vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: vi.fn() }));

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
import { CredentialLockError, withCredentialLock } from '@/lib/server/app-auth/credential-lock';

describe('auth change-password route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withCredentialLock).mockImplementation(async (_id, operation) => operation({ assertHeld() {} }));
    profileEq.mockReturnValue({
      select: () => ({ single: async () => ({ data: { id: 'user-1', must_change_password: false }, error: null }) }),
    });
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
    updateUserById.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    verifyUserPassword.mockResolvedValue(true);
  });

  async function change() {
    return changePasswordPost(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password: 'NewPassword123' }),
    }) as never);
  }

  it.each(['busy', 'unavailable'] as const)('makes no credential/profile writes when the lock is %s', async (reason) => {
    vi.mocked(withCredentialLock).mockRejectedValueOnce(new CredentialLockError(reason));
    const response = await change();
    expect(response.status).toBe(reason === 'busy' ? 409 : 503);
    expect(await response.json()).toMatchObject({ code: reason === 'busy' ? 'CREDENTIAL_CHANGE_BUSY' : 'CREDENTIAL_CHANGE_UNAVAILABLE' });
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'different-account'])('rejects a %s session revalidated inside the lock', async (state) => {
    const current = await vi.mocked(getCurrentAuthenticatedProfile).getMockImplementation()?.();
    vi.mocked(getCurrentAuthenticatedProfile)
      .mockResolvedValueOnce(current ?? null)
      .mockResolvedValueOnce(state === 'revoked' ? null : { ...current, profile: { id: 'another-user' } } as never);
    expect((await change()).status).toBe(401);
    expect(getCurrentAuthenticatedProfile).toHaveBeenCalledTimes(2);
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('revalidates the session and current password only while holding the lock', async () => {
    let held = false;
    vi.mocked(withCredentialLock).mockImplementationOnce(async (id, operation) => {
      expect(id).toBe('user-1');
      expect(getCurrentAuthenticatedProfile).toHaveBeenCalledTimes(1);
      expect(verifyUserPassword).not.toHaveBeenCalled();
      held = true;
      try { return await operation({ assertHeld() { expect(held).toBe(true); } }); }
      finally { held = false; }
    });
    verifyUserPassword.mockImplementationOnce(async () => {
      expect(held).toBe(true);
      expect(getCurrentAuthenticatedProfile).toHaveBeenCalledTimes(2);
      return true;
    });
    expect((await change()).status).toBe(200);
    expect(held).toBe(false);
  });

  it('does not clear the restriction after losing the lock during Auth update', async () => {
    let lost = false;
    vi.mocked(withCredentialLock).mockImplementationOnce(async (_id, operation) => operation({
      assertHeld() { if (lost) throw new CredentialLockError('unavailable'); },
    }));
    updateUserById.mockImplementationOnce(async () => {
      lost = true;
      return { data: { user: { id: 'user-1' } }, error: null };
    });
    const response = await change();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ passwordChanged: true });
    expect(from).not.toHaveBeenCalled();
  });

  it('preserves leading and trailing whitespace when updating the password', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: '  Padded-secret1  ',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(verifyUserPassword).toHaveBeenCalledWith('user-1@example.com', 'user-1', 'OldPassword123');
    expect(updateUserById).toHaveBeenCalledWith('user-1', {
      password: '  Padded-secret1  ',
    });
  });

  it.each(['weak', 'lowercase123', 'UPPERCASE123', 'NoNumbersHere'])('rejects a password outside the strength policy: %s', async (password) => {
    const response = await changePasswordPost(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password }),
    }) as never);
    expect(response.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects reusing the current password', async () => {
    const response = await changePasswordPost(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password: 'OldPassword123' }),
    }) as never);
    expect(response.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('does not clear the requirement when Auth rejects the password change', async () => {
    updateUserById.mockResolvedValueOnce({ error: { message: 'Rejected' } });
    const response = await changePasswordPost(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password: 'NewPassword123' }),
    }) as never);
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('reports an already-changed password if clearing the flag fails', async () => {
    profileEq.mockReturnValueOnce({ select: () => ({ single: async () => ({ data: null, error: { message: 'offline' } }) }) });
    const response = await changePasswordPost(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password: 'NewPassword123' }),
    }) as never);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ passwordChanged: true });
    expect(updateUserById).toHaveBeenCalled();
  });

  it.each(['unconfirmed', 'throws'])('does not clear the flag after an uncertain Auth update: %s', async (failure) => {
    if (failure === 'throws') updateUserById.mockRejectedValueOnce(new Error('network failure'));
    else updateUserById.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await changePasswordPost(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password: 'NewPassword123' }),
    }) as never);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ passwordChanged: false, passwordMayHaveChanged: true });
    expect(from).not.toHaveBeenCalled();
  });

  it('reports an already-changed password when the flag write throws', async () => {
    profileEq.mockImplementationOnce(() => { throw new Error('network failure'); });
    const response = await changePasswordPost(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password: 'NewPassword123' }),
    }) as never);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ passwordChanged: true });
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
