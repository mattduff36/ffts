import { beforeEach, describe, expect, it, vi } from 'vitest';
const { current, createClient, getUser, getSession } = vi.hoisted(() => ({
  current: vi.fn(), createClient: vi.fn(), getUser: vi.fn(), getSession: vi.fn(),
}));
vi.mock('@/lib/server/app-auth/session', () => ({ getCurrentAuthenticatedProfile: current }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
import { GET } from '@/app/api/auth/data-token/route';

describe('data-token password gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.mockResolvedValue({ profile: { id: 'user-1', must_change_password: false } });
    createClient.mockResolvedValue({ auth: { getUser, getSession } });
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    getSession.mockResolvedValue({ data: { session: { access_token: 'mock-data-token', expires_at: 2000000000 } } });
  });
  it('denies pending users before creating a token-capable client', async () => {
    current.mockResolvedValue({ profile: { id: 'user-1', must_change_password: true } });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(createClient).not.toHaveBeenCalled();
  });
  it('denies unauthenticated users', async () => {
    current.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('preserves the token response for unrestricted users', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ token: 'mock-data-token', expires_at: 2000000000 });
  });
});
