import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SESSION_COOKIE_NAME } from '@/lib/server/app-auth/constants';

const {
  signInWithPassword,
  validateAppSession,
  issueAppSession,
  revokeAppSession,
  isWebAuthnConfigured,
} = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  validateAppSession: vi.fn(),
  issueAppSession: vi.fn(),
  revokeAppSession: vi.fn(),
  isWebAuthnConfigured: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithPassword,
    },
  })),
}));

vi.mock('@/lib/server/app-auth/profile', () => ({
  getAppAuthProfile: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
  issueAppSession,
  revokeAppSession,
}));

vi.mock('@/lib/server/webauthn/config', () => ({
  isWebAuthnConfigured,
}));

import { POST as loginPost } from '@/app/api/auth/login/route';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';

describe('auth login route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWebAuthnConfigured.mockReturnValue(true);
    validateAppSession.mockResolvedValue({
      status: 'missing',
      session: null,
      profileId: null,
      email: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });
    issueAppSession.mockResolvedValue({
      row: { id: 'session-1' },
      cookieValue: 'signed-app-session',
      cookieExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });
    revokeAppSession.mockResolvedValue(undefined);
    vi.mocked(getAppAuthProfile).mockResolvedValue({
      id: 'user-1',
      full_name: 'User One',
      phone_number: null,
      employee_id: '001',
      avatar_url: null,
      must_change_password: false,
      annual_holiday_allowance_days: null,
      super_admin: false,
      team_id: null,
      team: null,
      role: null,
      email: 'user-1@example.com',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when Supabase rejects the password', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'wrong-password',
      }),
    });

    const response = await loginPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Invalid email or password');
  });

  it('issues an app session cookie on valid password login', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'user-1@example.com',
        },
      },
      error: null,
    });

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'correct-password',
        rememberMe: true,
        deviceId: 'device-1234567890abcdef',
        deviceLabel: 'Browser (Windows)',
      }),
    });

    const response = await loginPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(getAppAuthProfile).toHaveBeenCalledWith('user-1', 'user-1@example.com');
    expect(response.cookies.get(APP_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it('does not block password login with WebAuthn device metadata when biometrics are disabled', async () => {
    isWebAuthnConfigured.mockReturnValue(false);
    signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'user-1@example.com',
        },
      },
      error: null,
    });

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'correct-password',
        rememberMe: true,
        deviceId: 'device-1234567890abcdef',
        deviceLabel: 'Browser (Windows)',
      }),
    });

    const response = await loginPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(issueAppSession).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'password_login',
        rawDeviceId: null,
        deviceLabel: null,
      })
    );
  });

  it('retries with a trimmed password when only edge whitespace differs', async () => {
    signInWithPassword
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      })
      .mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-1',
            email: 'user-1@example.com',
          },
        },
        error: null,
      });

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: '  correct-password  ',
      }),
    });

    const response = await loginPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(signInWithPassword).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        email: 'user-1@example.com',
        password: '  correct-password  ',
      })
    );
    expect(signInWithPassword).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        email: 'user-1@example.com',
        password: 'correct-password',
      })
    );
  });
});
