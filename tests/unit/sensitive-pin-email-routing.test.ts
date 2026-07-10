import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

const originalFetch = global.fetch;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const originalResendApiKey2 = process.env.RESEND_API_KEY_2;
const originalResendFromEmail2 = process.env.RESEND_FROM_EMAIL_2;

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe('sensitive PIN email routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'primary-key';
    process.env.RESEND_FROM_EMAIL = 'Primary <primary@example.com>';
    process.env.RESEND_API_KEY_2 = 'secondary-key';
    process.env.RESEND_FROM_EMAIL_2 = 'Quotes <quotes@example.com>';
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv('RESEND_API_KEY', originalResendApiKey);
    restoreEnv('RESEND_FROM_EMAIL', originalResendFromEmail);
    restoreEnv('RESEND_API_KEY_2', originalResendApiKey2);
    restoreEnv('RESEND_FROM_EMAIL_2', originalResendFromEmail2);
  });

  it('uses the primary Resend account even when quote Resend settings are present', async () => {
    const preferenceChain = {
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({
        data: [{ user_id: 'admin-1', notify_in_app: false, notify_email: true }],
        error: null,
      }),
    };
    preferenceChain.eq.mockReturnValue(preferenceChain);

    mockCreateAdminClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: 'admin@example.com' } },
          }),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ id: 'admin-1', full_name: 'Admin User', super_admin: true, role: null }],
              error: null,
            }),
          };
        }

        if (table === 'notification_preferences') {
          return {
            select: vi.fn(() => preferenceChain),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { notifyAdminsOfSensitivePinEvent } = await import('@/lib/server/sensitive-pin-notifications');

    await notifyAdminsOfSensitivePinEvent({
      actorProfileId: 'actor-1',
      targetProfileId: 'user-1',
      targetName: 'Test User',
      eventType: 'changed',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body));

    expect(headers.Authorization).toBe('Bearer primary-key');
    expect(body.from).toBe('Primary <primary@example.com>');
    expect(body.to).toEqual(['admin@example.com']);
  });
});
