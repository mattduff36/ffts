import { afterEach, describe, expect, it, vi } from 'vitest';

const { createSupabaseClientMock, signInWithPasswordMock } = vi.hoisted(() => ({
  createSupabaseClientMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createSupabaseClientMock,
}));

function stubDemoEnv(): void {
  vi.stubEnv('APP_MODE', 'demo');
  vi.stubEnv('NEXT_PUBLIC_APP_MODE', 'demo');
  vi.stubEnv('NEXT_PUBLIC_DEMO_EMAIL_DOMAIN', 'demo.example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_JWT_SECRET', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Supabase data tokens', () => {
  it('marks demo accounts as token-capable when the JWT secret is not configured', async () => {
    stubDemoEnv();

    const { canIssueSupabaseDataToken } = await import('@/lib/server/app-auth/supabase-token');

    expect(canIssueSupabaseDataToken('avery.stone@demo.example.test')).toBe(true);
    expect(canIssueSupabaseDataToken('admin@example.com')).toBe(false);
  });

  it('falls back to a normal Supabase demo-user access token in demo mode', async () => {
    stubDemoEnv();
    signInWithPasswordMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'demo-user-token',
          expires_at: 1_779_302_153,
        },
      },
      error: null,
    });
    createSupabaseClientMock.mockReturnValue({
      auth: {
        signInWithPassword: signInWithPasswordMock,
      },
    });

    const { issueSupabaseDataToken } = await import('@/lib/server/app-auth/supabase-token');
    const token = await issueSupabaseDataToken({
      profileId: 'profile-123',
      email: 'avery.stone@demo.example.test',
      sessionId: 'app-session-123',
    });

    expect(token).toEqual({
      token: 'demo-user-token',
      expiresAt: 1_779_302_153,
    });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'avery.stone@demo.example.test',
      password: 'DemoPass123!',
    });
  });

  it('does not use the demo fallback outside the configured demo domain', async () => {
    stubDemoEnv();

    const { issueSupabaseDataToken } = await import('@/lib/server/app-auth/supabase-token');
    const token = await issueSupabaseDataToken({
      profileId: 'profile-123',
      email: 'admin@example.com',
      sessionId: 'app-session-123',
    });

    expect(token).toBeNull();
    expect(createSupabaseClientMock).not.toHaveBeenCalled();
  });
});
