import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPasswordChangeRequired } from '@/lib/server/app-auth/profile';

vi.mock('@/lib/server/app-auth/profile', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/app-auth/profile')>(),
  isPasswordChangeRequired: vi.fn(async () => false),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Supabase data tokens', () => {
  it('disables data-token issuance when the JWT secret is not configured', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
    const { canIssueSupabaseDataToken } = await import('@/lib/server/app-auth/supabase-token');

    expect(canIssueSupabaseDataToken('employee@example.test')).toBe(false);
  });

  it('returns null when data-token signing is unavailable', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
    const { issueSupabaseDataToken } = await import('@/lib/server/app-auth/supabase-token');
    const token = await issueSupabaseDataToken({
      profileId: 'profile-123',
      email: 'employee@example.test',
      sessionId: 'app-session-123',
    });

    expect(token).toBeNull();
  });

  it('denies a fresh token while a permanent password is required', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', 'forest-test-jwt-secret');
    vi.mocked(isPasswordChangeRequired).mockResolvedValueOnce(true);
    const { issueSupabaseDataToken } = await import('@/lib/server/app-auth/supabase-token');
    await expect(issueSupabaseDataToken({ profileId: 'profile-123', email: null, sessionId: 'session-1' }))
      .rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('enables signed data tokens when the Supabase JWT secret is configured', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', 'forest-test-jwt-secret');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    const { canIssueSupabaseDataToken, issueSupabaseDataToken } = await import(
      '@/lib/server/app-auth/supabase-token'
    );

    expect(canIssueSupabaseDataToken('employee@example.test')).toBe(true);
    const result = await issueSupabaseDataToken({
      profileId: 'profile-123',
      email: 'employee@example.test',
      sessionId: 'app-session-123',
    });
    expect(result?.token.split('.')).toHaveLength(3);
    expect(result?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
