import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/profile/permissions', () => ({
  canEditOwnBasicProfileFields: vi.fn(() => true),
}));

import { GET as sessionGet } from '@/app/api/auth/session/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

describe('auth session route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps pending users authenticated for password replacement but disables data tokens', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      validation: { cookieValue: null, cookieExpiresAt: null },
      profile: { id: 'user-1', email: 'user@example.test', must_change_password: true },
    } as never);
    const response = await sessionGet();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.authenticated).toBe(true);
    expect(payload.profile.must_change_password).toBe(true);
    expect(payload.data_token_available).toBe(false);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getCurrentAuthenticatedProfile).toHaveBeenCalledWith({ includeEmail: true, allowPendingPasswordChange: true });
  });

  it('reports the active authenticated session without lock state', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      validation: {
        status: 'active',
        session: {
          id: 'session-1',
          profile_id: 'user-1',
        },
        profileId: 'user-1',
        email: 'user-1@example.com',
        cookieValue: null,
        cookieExpiresAt: null,
      },
      profile: {
        id: 'user-1',
        email: 'user-1@example.com',
      },
    } as never);

    const response = await sessionGet();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.authenticated).toBe(true);
    expect(payload.locked).toBeUndefined();
  });
});
