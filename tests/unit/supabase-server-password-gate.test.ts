import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { validate, required, issue, legacyUser, base, legacy } = vi.hoisted(() => ({
  validate: vi.fn(), required: vi.fn(), issue: vi.fn(), legacyUser: vi.fn(), base: vi.fn(), legacy: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: vi.fn() }) }));
vi.mock('@/lib/server/app-auth/session', () => ({ validateAppSession: validate }));
vi.mock('@/lib/server/app-auth/supabase-token', () => ({ issueSupabaseDataToken: issue }));
vi.mock('@/lib/server/app-auth/profile', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/app-auth/profile')>(), isPasswordChangeRequired: required,
}));
vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@supabase/supabase-js')>(), createClient: base,
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: legacy }));
import { createClient } from '@/lib/supabase/server';

describe('server Supabase password gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon');
    validate.mockResolvedValue({ status: 'active', session: { id: 'session-1', profile_id: 'user-1' }, email: 'user@example.test' });
    required.mockResolvedValue(true);
    base.mockReturnValue({ auth: {} });
    legacyUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    legacy.mockReturnValue({ auth: { getUser: legacyUser } });
    issue.mockResolvedValue({ token: 'mock-token', expiresAt: 2000000000 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('denies ordinary authorization without minting a token for pending app sessions', async () => {
    const client = await createClient();
    expect(await client.auth.getUser()).toMatchObject({ data: { user: null }, error: { status: 403, code: 'PASSWORD_CHANGE_REQUIRED' } });
    expect(await client.auth.getSession()).toMatchObject({ data: { session: null }, error: { status: 403 } });
    expect(issue).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledWith('http://localhost:54321', 'test-anon', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  });
  it('allows auth identity inspection without minting a token', async () => {
    const client = await createClient({ allowPendingPasswordChange: true });
    expect((await client.auth.getUser()).data.user?.id).toBe('user-1');
    expect((await client.auth.getSession()).data.session?.access_token).toBe('');
    expect(issue).not.toHaveBeenCalled();
  });
  it('denies pending legacy business authorization while preserving logout', async () => {
    validate.mockResolvedValue({ status: 'missing', session: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    legacy.mockReturnValue({ auth: { getUser: legacyUser, signOut } });
    const client = await createClient();
    expect(await client.auth.getUser()).toMatchObject({ data: { user: null }, error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
    expect(required).toHaveBeenCalledWith('user-1');
    await client.auth.signOut();
    expect(signOut).toHaveBeenCalledOnce();
    expect(issue).not.toHaveBeenCalled();
  });
  it('does not restore revoked app sessions through legacy cookies', async () => {
    validate.mockResolvedValue({ status: 'invalid', session: null });
    await createClient();
    expect(legacy).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });
  it('preserves nonpending token issuance', async () => {
    required.mockResolvedValue(false);
    const client = await createClient();
    expect((await client.auth.getSession()).data.session?.access_token).toBe('mock-token');
    expect(issue).toHaveBeenCalledWith({ profileId: 'user-1', email: 'user@example.test', sessionId: 'session-1' });
  });
  it('fails closed on a profile lookup error', async () => {
    required.mockRejectedValue(new Error('offline'));
    await expect(createClient()).rejects.toThrow('offline');
    expect(issue).not.toHaveBeenCalled();
  });
});
