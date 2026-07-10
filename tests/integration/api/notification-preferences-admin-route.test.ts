import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/system-test-accounts', () => ({
  filterHiddenSystemTestAccountProfiles: vi.fn(async (_client, profiles) => profiles),
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { GET, PUT } from '@/app/api/notification-preferences/admin/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';

const baseEffectiveRole = {
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
};

describe('notification preferences admin route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows Charlotte debug access to fetch notification preferences', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'charlotte-id', email: 'charlotte@example.test' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue(baseEffectiveRole);

    const orderProfiles = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'user-1',
          full_name: 'User One',
          employee_id: 'E001',
          is_placeholder: false,
          role: { name: 'employee' },
        },
      ],
      error: null,
    });
    const selectProfiles = vi.fn(() => ({ order: orderProfiles }));
    const selectPreferences = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'pref-1',
          user_id: 'user-1',
          module_key: 'reminders',
          enabled: true,
          notify_in_app: true,
          notify_email: false,
        },
      ],
      error: null,
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return { select: selectProfiles };
        }
        if (table === 'notification_preferences') {
          return { select: selectPreferences };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/notification-preferences/admin'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.users).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        preferences: [expect.objectContaining({ module_key: 'reminders' })],
      }),
    ]);
  });

  it('allows Charlotte debug access to update notification preferences', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'charlotte-id', email: 'charlotte@example.test' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue(baseEffectiveRole);

    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'pref-1',
        user_id: 'user-1',
        module_key: 'reminders',
        enabled: true,
        notify_in_app: false,
        notify_email: true,
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select }));

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'notification_preferences') {
          return { upsert };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const response = await PUT(
      new NextRequest('http://localhost/api/notification-preferences/admin', {
        method: 'PUT',
        body: JSON.stringify({
          user_id: 'user-1',
          module_key: 'reminders',
          notify_in_app: false,
          notify_email: true,
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        module_key: 'reminders',
        notify_in_app: false,
        notify_email: true,
      },
      { onConflict: 'user_id,module_key' }
    );
  });

  it('blocks Toolbox Talk notification disables through debug updates', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'charlotte-id', email: 'charlotte@example.test' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue(baseEffectiveRole);

    const response = await PUT(
      new NextRequest('http://localhost/api/notification-preferences/admin', {
        method: 'PUT',
        body: JSON.stringify({
          user_id: 'user-1',
          module_key: 'toolbox_talks',
          notify_in_app: false,
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Toolbox Talk notifications cannot be disabled');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('blocks below-supervisor debug users from disabling notification preferences', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'charlotte-id', email: 'charlotte@example.test' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      ...baseEffectiveRole,
      role_name: 'employee',
      role_class: 'employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_actual_super_admin: false,
    });

    const response = await PUT(
      new NextRequest('http://localhost/api/notification-preferences/admin', {
        method: 'PUT',
        body: JSON.stringify({
          user_id: 'user-1',
          module_key: 'reminders',
          enabled: false,
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Only supervisors and above can disable notifications');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('blocks debug access while viewing as another role', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'charlotte-id', email: 'charlotte@example.test' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      ...baseEffectiveRole,
      is_viewing_as: true,
    });

    const response = await GET(new NextRequest('http://localhost/api/notification-preferences/admin'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden: Debug access required');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
