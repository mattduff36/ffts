import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SESSION_COOKIE_NAME } from '@/lib/server/app-auth/constants';

const {
  signOut,
  revokeAppSession,
} = vi.hoisted(() => ({
  signOut: vi.fn(),
  revokeAppSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signOut,
    },
  })),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession: vi.fn(),
  revokeAppSession,
}));

import { POST as logoutPost } from '@/app/api/auth/logout/route';
import { validateAppSession } from '@/lib/server/app-auth/session';

describe('auth logout route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signOut.mockResolvedValue({ error: null });
    revokeAppSession.mockResolvedValue(undefined);
    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'active',
      session: {
        id: 'session-1',
        profile_id: 'user-1',
      },
      profileId: 'user-1',
      email: 'user-1@example.com',
      cookieValue: null,
      cookieExpiresAt: null,
    } as never);
  });

  it('skips Supabase sign-out when revoking an active app session', async () => {
    signOut.mockRejectedValue(new Error('network down'));

    const request = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${APP_SESSION_COOKIE_NAME}=signed-cookie; sb-project-auth-token=legacy-token`,
      },
      body: JSON.stringify({}),
    });

    const response = await logoutPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    expect(revokeAppSession).toHaveBeenCalledWith('session-1', 'logout');
    expect(response.cookies.get(APP_SESSION_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('');
  });

  it('still clears auth cookies when legacy Supabase sign-out throws', async () => {
    signOut.mockRejectedValue(new Error('network down'));
    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'missing',
      session: null,
      profileId: null,
      email: null,
      cookieValue: null,
      cookieExpiresAt: null,
    } as never);

    const request = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${APP_SESSION_COOKIE_NAME}=signed-cookie; sb-project-auth-token=legacy-token`,
      },
      body: JSON.stringify({}),
    });

    const response = await logoutPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('network down');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(revokeAppSession).not.toHaveBeenCalled();
    expect(response.cookies.get(APP_SESSION_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('');
  });
});
