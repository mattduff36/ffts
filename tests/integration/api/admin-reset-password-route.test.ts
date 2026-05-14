import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const createSupabaseAdminClient = vi.fn();
  const createServerClient = vi.fn();
  const getUserById = vi.fn();
  const updateUserById = vi.fn();
  const profileSelect = vi.fn();
  const profileSelectEq = vi.fn();
  const profileSelectSingle = vi.fn();
  const profileUpdate = vi.fn();
  const profileUpdateEq = vi.fn();
  const sendPasswordEmail = vi.fn();
  const canEffectiveRoleAccessModule = vi.fn();
  const canEffectiveRoleAssignRole = vi.fn();
  const generateSecurePassword = vi.fn(() => 'TMPa1B2');
  const logServerError = vi.fn().mockResolvedValue(undefined);

  return {
    createSupabaseAdminClient,
    createServerClient,
    getUserById,
    updateUserById,
    profileSelect,
    profileSelectEq,
    profileSelectSingle,
    profileUpdate,
    profileUpdateEq,
    sendPasswordEmail,
    canEffectiveRoleAccessModule,
    canEffectiveRoleAssignRole,
    generateSecurePassword,
    logServerError,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createSupabaseAdminClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createServerClient,
}));

vi.mock('@/lib/utils/password', () => ({
  generateSecurePassword: mocks.generateSecurePassword,
}));

vi.mock('@/lib/utils/email', () => ({
  sendPasswordEmail: mocks.sendPasswordEmail,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mocks.canEffectiveRoleAccessModule,
  canEffectiveRoleAssignRole: mocks.canEffectiveRoleAssignRole,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mocks.logServerError,
}));

import { POST } from '@/app/api/admin/users/[id]/reset-password/route';

describe('POST /api/admin/users/[id]/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.profileSelect.mockReturnValue({
      eq: mocks.profileSelectEq,
    });
    mocks.profileSelectEq.mockReturnValue({
      single: mocks.profileSelectSingle,
    });
    mocks.profileUpdate.mockReturnValue({
      eq: mocks.profileUpdateEq,
    });
    mocks.profileSelectSingle.mockResolvedValue({
      data: {
        full_name: 'Example User',
        role_id: 'role-employee',
      },
      error: null,
    });
    mocks.profileUpdateEq.mockResolvedValue({ error: null });

    mocks.createServerClient.mockResolvedValue({
      from: (table: string) => {
        if (table !== 'profiles') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          select: mocks.profileSelect,
          update: mocks.profileUpdate,
        };
      },
    } as never);

    mocks.createSupabaseAdminClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: mocks.getUserById,
          updateUserById: mocks.updateUserById,
        },
      },
    } as never);

    mocks.canEffectiveRoleAccessModule.mockResolvedValue(true);
    mocks.canEffectiveRoleAssignRole.mockResolvedValue(true);
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'user@example.com',
        },
      },
      error: null,
    });
    mocks.updateUserById.mockResolvedValue({ error: null });
    mocks.sendPasswordEmail.mockResolvedValue({ success: true });
  });

  it('lets admins reset a user password and force a password change on next login', async () => {
    const request = new Request('http://localhost/api/admin/users/user-1/reset-password', {
      method: 'POST',
    });

    const response = await POST(request as never, { params: Promise.resolve({ id: 'user-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.temporaryPassword).toBe('TMPa1B2');
    expect(payload.emailSent).toBe(true);

    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', {
      password: 'TMPa1B2',
    });
    expect(mocks.profileUpdate).toHaveBeenCalledWith({
      must_change_password: true,
    });
    expect(mocks.profileUpdateEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mocks.sendPasswordEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      userName: 'Example User',
      temporaryPassword: 'TMPa1B2',
      isReset: true,
    });
  });

  it('rejects non-admin access before attempting a reset', async () => {
    mocks.canEffectiveRoleAccessModule.mockResolvedValue(false);

    const request = new Request('http://localhost/api/admin/users/user-1/reset-password', {
      method: 'POST',
    });

    const response = await POST(request as never, { params: Promise.resolve({ id: 'user-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('admin-users access required');
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });
});
