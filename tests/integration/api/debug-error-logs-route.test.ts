import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { DELETE, GET } from '@/app/api/debug/error-logs/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

describe('debug error logs route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when the caller is not authenticated', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/debug/error-logs'));

    expect(response.status).toBe(401);
  });

  it('returns enriched error logs for an actual superadmin', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');

    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'log-1',
          timestamp: '2026-04-21T09:00:00.000Z',
          error_message: 'Auth failure',
          error_stack: null,
          error_type: 'Error',
          user_id: 'user-1',
          user_email: 'user-1@example.com',
          page_url: 'https://example.com/dashboard',
          user_agent: 'Browser UA',
          component_name: '/api/auth/session',
          additional_data: null,
          created_at: '2026-04-21T09:00:00.000Z',
        },
      ],
      error: null,
    });
    const order = vi.fn(() => ({ limit }));
    const selectErrorLogs = vi.fn(() => ({ order }));
    const inProfiles = vi.fn().mockResolvedValue({
      data: [{ id: 'user-1', full_name: 'Client User' }],
      error: null,
    });
    const selectProfiles = vi.fn(() => ({ in: inProfiles }));

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'admin-1' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'role-1',
      role_name: 'super_admin',
      display_name: 'Super Admin',
      role_class: 'admin',
      is_manager_admin: true,
      is_super_admin: true,
      is_viewing_as: false,
      is_actual_super_admin: true,
      user_id: 'admin-1',
      team_id: null,
      team_name: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'error_logs') {
          return { select: selectErrorLogs };
        }
        if (table === 'profiles') {
          return { select: selectProfiles };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/debug/error-logs?limit=50'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.logs).toEqual([
      expect.objectContaining({
        id: 'log-1',
        user_name: 'Client User',
      }),
    ]);
  });

  it('returns enriched error logs for additional debug access', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');

    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'log-2',
          timestamp: '2026-04-22T09:00:00.000Z',
          error_message: 'Sync failed',
          error_stack: null,
          error_type: 'Error',
          user_id: 'user-2',
          user_email: 'user-2@example.com',
          page_url: 'https://example.com/debug',
          user_agent: 'Browser UA',
          component_name: '/api/debug/error-logs',
          additional_data: null,
          created_at: '2026-04-22T09:00:00.000Z',
        },
      ],
      error: null,
    });
    const order = vi.fn(() => ({ limit }));
    const selectErrorLogs = vi.fn(() => ({ order }));
    const inProfiles = vi.fn().mockResolvedValue({
      data: [{ id: 'user-2', full_name: 'Support User' }],
      error: null,
    });
    const selectProfiles = vi.fn(() => ({ in: inProfiles }));

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'charlotte-id', email: 'debug.user@example.com' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'role-admin',
      role_name: 'admin',
      display_name: 'Admin',
      role_class: 'admin',
      is_manager_admin: true,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'charlotte-id',
      team_id: null,
      team_name: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'error_logs') {
          return { select: selectErrorLogs };
        }
        if (table === 'profiles') {
          return { select: selectProfiles };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/debug/error-logs?limit=25'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.logs).toEqual([
      expect.objectContaining({
        id: 'log-2',
        user_name: 'Support User',
      }),
    ]);
  });

  it('clears error logs for an actual superadmin', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');

    const gte = vi.fn().mockResolvedValue({ error: null });
    const deleteLogs = vi.fn(() => ({ gte }));

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'admin-1' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'role-1',
      role_name: 'super_admin',
      display_name: 'Super Admin',
      role_class: 'admin',
      is_manager_admin: true,
      is_super_admin: true,
      is_viewing_as: false,
      is_actual_super_admin: true,
      user_id: 'admin-1',
      team_id: null,
      team_name: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'error_logs') {
          return { delete: deleteLogs };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const response = await DELETE(new NextRequest('http://localhost/api/debug/error-logs', { method: 'DELETE' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(gte).toHaveBeenCalledWith('timestamp', '1970-01-01');
  });
});
