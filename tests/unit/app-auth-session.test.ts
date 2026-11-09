import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_SESSION_ABSOLUTE_HOURS,
  APP_SESSION_COOKIE_VERSION,
  APP_SESSION_IDLE_HOURS,
  APP_SESSION_REMEMBER_IDLE_DAYS,
} from '@/lib/server/app-auth/constants';

const {
  maybeSingleMock,
  singleMock,
  getUserByIdMock,
  getCurrentAppSessionCookiePayloadMock,
  buildAppSessionCookieValueMock,
  getAppAuthProfileMock,
  sha256HexMock,
  getSupabaseUserMock,
  randomTokenMock,
  revokeSelectMock,
  revokeIsMock,
  updateMock,
} = vi.hoisted(() => ({
  maybeSingleMock: vi.fn(),
  singleMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  getCurrentAppSessionCookiePayloadMock: vi.fn(),
  buildAppSessionCookieValueMock: vi.fn(),
  getAppAuthProfileMock: vi.fn(),
  sha256HexMock: vi.fn(),
  getSupabaseUserMock: vi.fn(),
  randomTokenMock: vi.fn(),
  revokeSelectMock: vi.fn(),
  revokeIsMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: maybeSingleMock,
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: singleMock,
        })),
      })),
      update: updateMock.mockImplementation(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({ single: singleMock })),
          is: revokeIsMock,
        })),
      })),
    })),
    auth: {
      admin: {
        getUserById: getUserByIdMock,
      },
    },
  })),
}));

vi.mock('@/lib/server/app-auth/cookies', () => ({
  getCurrentAppSessionCookiePayload: getCurrentAppSessionCookiePayloadMock,
  buildAppSessionCookieValue: buildAppSessionCookieValueMock,
}));

vi.mock('@/lib/server/app-auth/profile', () => ({
  getAppAuthProfile: getAppAuthProfileMock,
}));

vi.mock('@/lib/server/app-auth/jwt', () => ({
  randomToken: randomTokenMock,
  sha256Hex: sha256HexMock,
}));

vi.mock('@/lib/server/webauthn/devices', () => ({
  getWebAuthnDevice: vi.fn(),
  upsertWebAuthnDevice: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: getSupabaseUserMock,
    },
  })),
}));

import { getCurrentAuthenticatedProfile, validateAppSession, revokeAppSessionsForProfile } from '@/lib/server/app-auth/session';

describe('app auth session helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T12:00:00.000Z'));
    revokeIsMock.mockReturnValue({ select: revokeSelectMock });
    revokeSelectMock.mockResolvedValue({ data: [{ id: 'session-1' }, { id: 'session-2' }], error: null });

    maybeSingleMock.mockResolvedValue({
      data: {
        id: 'session-1',
        profile_id: 'user-1',
        device_id: null,
        session_secret_hash: 'hashed-secret',
        session_source: 'password_login',
        remember_me: true,
        last_seen_at: '2026-04-04T12:00:00.000Z',
        idle_expires_at: '2026-04-05T12:00:00.000Z',
        absolute_expires_at: '2026-04-30T12:00:00.000Z',
        revoked_at: null,
        revoked_reason: null,
        replaced_by_session_id: null,
        user_agent: null,
        ip_hash: null,
        created_at: '2026-04-04T10:00:00.000Z',
        updated_at: '2026-04-04T12:00:00.000Z',
      },
      error: null,
    });
    getUserByIdMock.mockResolvedValue({
      data: {
        user: {
          email: 'user-1@example.com',
        },
      },
      error: null,
    });
    getCurrentAppSessionCookiePayloadMock.mockResolvedValue({
      sid: 'session-1',
      secret: 'raw-secret',
      exp: Math.floor(new Date('2026-04-05T12:00:00.000Z').getTime() / 1000),
      v: APP_SESSION_COOKIE_VERSION,
    });
    sha256HexMock.mockImplementation(async (value: string) => {
      if (value === 'app-session:raw-secret') {
        return 'hashed-secret';
      }
      return `hash:${value}`;
    });
    randomTokenMock.mockReturnValue('new-raw-secret');
    getAppAuthProfileMock.mockResolvedValue({
      id: 'user-1',
      email: 'user-1@example.com',
      full_name: 'User One',
      role: null,
      team: null,
    });
    buildAppSessionCookieValueMock.mockResolvedValue('unused-cookie');
    getSupabaseUserMock.mockResolvedValue({
      data: {
        user: null,
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the standard app session idle timeout at no less than 24 hours', () => {
    expect(APP_SESSION_IDLE_HOURS).toBeGreaterThanOrEqual(24);
    expect(APP_SESSION_ABSOLUTE_HOURS).toBeGreaterThanOrEqual(APP_SESSION_IDLE_HOURS);
    expect(APP_SESSION_REMEMBER_IDLE_DAYS).toBeGreaterThanOrEqual(1);
  });

  it('returns the current profile for a valid app session', async () => {
    const current = await getCurrentAuthenticatedProfile();

    expect(current?.validation.status).toBe('active');
    expect(current?.profile.id).toBe('user-1');
    expect(getAppAuthProfileMock).toHaveBeenCalledWith('user-1', null);
  });

  it('returns the refreshed session row after activity updates', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        profile_id: 'user-1',
        device_id: null,
        session_secret_hash: 'hashed-secret',
        session_source: 'password_login',
        remember_me: true,
        last_seen_at: '2026-04-04T11:55:00.000Z',
        idle_expires_at: '2026-04-05T12:00:00.000Z',
        absolute_expires_at: '2026-04-30T12:00:00.000Z',
        revoked_at: null,
        revoked_reason: null,
        replaced_by_session_id: null,
        user_agent: null,
        ip_hash: null,
        created_at: '2026-04-04T10:00:00.000Z',
        updated_at: '2026-04-04T11:55:00.000Z',
      },
      error: null,
    });
    getCurrentAppSessionCookiePayloadMock.mockResolvedValueOnce({
      sid: 'session-1',
      secret: 'raw-secret',
      exp: Math.floor(new Date('2026-04-05T12:00:00.000Z').getTime() / 1000),
      v: APP_SESSION_COOKIE_VERSION,
    });
    singleMock.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        profile_id: 'user-1',
        device_id: null,
        session_secret_hash: 'hashed-secret',
        session_source: 'password_login',
        remember_me: true,
        last_seen_at: '2026-04-04T12:00:00.000Z',
        idle_expires_at: '2026-04-05T12:00:00.000Z',
        absolute_expires_at: '2026-04-30T12:00:00.000Z',
        revoked_at: null,
        revoked_reason: null,
        replaced_by_session_id: null,
        user_agent: null,
        ip_hash: null,
        created_at: '2026-04-04T10:00:00.000Z',
        updated_at: '2026-04-04T12:00:00.000Z',
      },
      error: null,
    });

    const validation = await validateAppSession();

    expect(validation.status).toBe('active');
    expect(validation.email).toBeNull();
    expect(validation.session?.last_seen_at).toBe('2026-04-04T12:00:00.000Z');
    expect(validation.session?.updated_at).toBe('2026-04-04T12:00:00.000Z');
    expect(validation.cookieValue).toBe('unused-cookie');
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('returns the active profile with email when requested', async () => {
    const current = await getCurrentAuthenticatedProfile({ includeEmail: true });

    expect(current?.validation.status).toBe('active');
    expect(current?.profile.id).toBe('user-1');
    expect(getAppAuthProfileMock).toHaveBeenCalledWith('user-1', 'user-1@example.com');
    expect(getUserByIdMock).toHaveBeenCalledWith('user-1');
  });

  it('denies pending profiles for ordinary business authorization but allows password replacement', async () => {
    getAppAuthProfileMock.mockResolvedValue({ id: 'user-1', must_change_password: true });
    expect(await getCurrentAuthenticatedProfile()).toBeNull();
    expect((await getCurrentAuthenticatedProfile({ allowPendingPasswordChange: true }))?.profile.id).toBe('user-1');
    expect(getSupabaseUserMock).not.toHaveBeenCalled();
  });

  it('does not revive a revoked app session through Supabase fallback', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { revoked_at: '2026-04-04T11:00:00.000Z' }, error: null });
    expect(await getCurrentAuthenticatedProfile()).toBeNull();
    expect(getSupabaseUserMock).not.toHaveBeenCalled();
  });

  it('denies pending legacy SSR users for ordinary business authorization', async () => {
    getCurrentAppSessionCookiePayloadMock.mockResolvedValueOnce(null);
    getSupabaseUserMock.mockResolvedValueOnce({ data: { user: { id: 'user-2' } }, error: null });
    getAppAuthProfileMock.mockResolvedValueOnce({ id: 'user-2', must_change_password: true });
    expect(await getCurrentAuthenticatedProfile()).toBeNull();
  });

  it('reads email live across requests after an account handover', async () => {
    await validateAppSession({ includeEmail: true });
    getUserByIdMock.mockResolvedValueOnce({ data: { user: { email: 'new@example.test' } }, error: null });
    expect((await validateAppSession({ includeEmail: true })).email).toBe('new@example.test');
    expect(getUserByIdMock).toHaveBeenCalledTimes(2);
  });

  it('revokes all active sessions for the profile, not just the current device', async () => {
    expect(await revokeAppSessionsForProfile('user-1', 'admin_password_reset')).toBe(2);
    expect(updateMock).toHaveBeenCalledWith({ revoked_at: expect.any(String), revoked_reason: 'admin_password_reset' });
    expect(updateMock.mock.results[0].value.eq).toHaveBeenCalledWith('profile_id', 'user-1');
    expect(revokeIsMock).toHaveBeenCalledWith('revoked_at', null);
  });

  it('does not claim profile-wide session revocation after a failed write', async () => {
    revokeSelectMock.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(revokeAppSessionsForProfile('user-1', 'admin_password_reset')).rejects.toThrow('Failed to revoke');
  });

  it('falls back to the Supabase SSR user when no app-session cookie exists', async () => {
    getCurrentAppSessionCookiePayloadMock.mockResolvedValueOnce(null);
    getSupabaseUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-2',
          email: 'user-2@example.com',
        },
      },
      error: null,
    });
    getAppAuthProfileMock.mockResolvedValueOnce({
      id: 'user-2',
      email: 'user-2@example.com',
      full_name: 'User Two',
      role: null,
      team: null,
    });

    const current = await getCurrentAuthenticatedProfile({ includeEmail: true });

    expect(current?.validation.status).toBe('active');
    expect(current?.validation.session).toBeNull();
    expect(current?.profile.id).toBe('user-2');
    expect(getAppAuthProfileMock).toHaveBeenCalledWith('user-2', 'user-2@example.com');
  });
});
