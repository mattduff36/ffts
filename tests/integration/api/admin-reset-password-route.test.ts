import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

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
  const requireAdminUsersModuleAccess = vi.fn();
  const generateSecurePassword = vi.fn(() => 'Fft1A2b');
  const logServerError = vi.fn().mockResolvedValue(undefined);
  const getEffectiveRole = vi.fn();
  const revokeAppSessionsForProfile = vi.fn();
  const revokeWebAuthnCredentialsForProfile = vi.fn();
  const flagSingle = vi.fn();
  const getCurrentAuthenticatedProfile = vi.fn();

  return {
    getCurrentAuthenticatedProfile,
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
    requireAdminUsersModuleAccess,
    generateSecurePassword,
    logServerError,
    getEffectiveRole,
    revokeAppSessionsForProfile,
    revokeWebAuthnCredentialsForProfile,
    flagSingle,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createSupabaseAdminClient,
}));

vi.mock('@/lib/server/app-auth/credential-lock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/app-auth/credential-lock')>();
  return { ...actual, withCredentialLock: vi.fn() };
});

vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: mocks.getEffectiveRole }));
vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mocks.getCurrentAuthenticatedProfile,
  revokeAppSessionsForProfile: mocks.revokeAppSessionsForProfile,
}));
vi.mock('@/lib/server/webauthn/credentials', () => ({ revokeWebAuthnCredentialsForProfile: mocks.revokeWebAuthnCredentialsForProfile }));

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

vi.mock('@/lib/server/admin-users-module-access', () => ({
  requireAdminUsersModuleAccess: mocks.requireAdminUsersModuleAccess,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mocks.logServerError,
}));

import { POST } from '@/app/api/admin/users/[id]/reset-password/route';
import { CredentialLockError, withCredentialLock } from '@/lib/server/app-auth/credential-lock';

describe('POST /api/admin/users/[id]/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withCredentialLock).mockImplementation(async (_id, operation) => operation({ assertHeld() {} }));
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: { id: 'admin-1' }, validation: { cookieValue: null, cookieExpiresAt: null },
    });

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
        super_admin: false,
        role: { is_super_admin: false, role_class: 'employee' },
      },
      error: null,
    });
    mocks.profileUpdateEq.mockReturnValue({ select: vi.fn(() => ({ single: mocks.flagSingle })) });
    mocks.flagSingle.mockResolvedValue({ data: { id: 'user-1', must_change_password: true }, error: null });
    mocks.getEffectiveRole.mockResolvedValue({ user_id: 'admin-1' });
    mocks.revokeAppSessionsForProfile.mockResolvedValue(2);
    mocks.revokeWebAuthnCredentialsForProfile.mockResolvedValue(2);

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
      from: () => ({ select: mocks.profileSelect, update: mocks.profileUpdate }),
      auth: {
        admin: {
          getUserById: mocks.getUserById,
          updateUserById: mocks.updateUserById,
        },
      },
    } as never);

    mocks.canEffectiveRoleAccessModule.mockResolvedValue(true);
    mocks.canEffectiveRoleAssignRole.mockResolvedValue(true);
    mocks.requireAdminUsersModuleAccess.mockResolvedValue(null);
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'user@example.com',
        },
      },
      error: null,
    });
    mocks.updateUserById.mockImplementation(async (id: string, attributes: { email?: string }) => ({
      data: { user: { id, email: attributes.email || 'user@example.com' } }, error: null,
    }));
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
    expect(payload.temporaryPassword).toBe('Fft1A2b');
    expect(payload.emailSent).toBe(true);

    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', {
      password: 'Fft1A2b',
    });
    expect(mocks.profileUpdate).toHaveBeenCalledWith({
      must_change_password: true,
    });
    expect(mocks.profileUpdateEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mocks.sendPasswordEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      userName: 'Example User',
      temporaryPassword: 'Fft1A2b',
      isReset: true,
    });
  });

  async function reset(body?: unknown) {
    return POST(new Request('http://localhost/api/admin/users/user-1/reset-password', {
      method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as never, { params: Promise.resolve({ id: 'user-1' }) });
  }

  it.each(['busy', 'unavailable'] as const)('does not mutate or email when the lock is %s', async (reason) => {
    vi.mocked(withCredentialLock).mockRejectedValueOnce(new CredentialLockError(reason));
    const response = await reset();
    expect(response.status).toBe(reason === 'busy' ? 409 : 503);
    expect(await response.json()).toMatchObject({ code: reason === 'busy' ? 'CREDENTIAL_CHANGE_BUSY' : 'CREDENTIAL_CHANGE_UNAVAILABLE' });
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.revokeAppSessionsForProfile).not.toHaveBeenCalled();
    expect(mocks.revokeWebAuthnCredentialsForProfile).not.toHaveBeenCalled();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'changed-account'])('rejects a %s actor session from fresh validation under the lock', async (state) => {
    mocks.getCurrentAuthenticatedProfile.mockResolvedValueOnce({
      profile: { id: 'admin-1' }, validation: { cookieValue: null, cookieExpiresAt: null },
    }).mockResolvedValueOnce(state === 'revoked' ? null : {
      profile: { id: 'another-admin' }, validation: { cookieValue: null, cookieExpiresAt: null },
    });
    expect((await reset()).status).toBe(401);
    expect(mocks.getCurrentAuthenticatedProfile).toHaveBeenCalledTimes(2);
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it.each(['pin', 'actor', 'target-permission'])('rechecks %s authorization under the lock before any writes', async (denial) => {
    vi.mocked(withCredentialLock).mockImplementationOnce(async (_id, operation) => {
      expect(mocks.requireAdminUsersModuleAccess).toHaveBeenCalledTimes(1);
      if (denial === 'pin') mocks.requireAdminUsersModuleAccess.mockResolvedValueOnce(NextResponse.json({ code: 'SENSITIVE_PIN_REQUIRED' }, { status: 428 }));
      if (denial === 'actor') mocks.getEffectiveRole.mockResolvedValueOnce({ user_id: null });
      if (denial === 'target-permission') mocks.canEffectiveRoleAssignRole.mockResolvedValueOnce(false);
      return operation({ assertHeld() {} });
    });
    const response = await reset();
    expect(response.status).toBe(denial === 'pin' ? 428 : denial === 'actor' ? 401 : 403);
    expect(mocks.requireAdminUsersModuleAccess).toHaveBeenCalledTimes(2);
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it('reports email already delivered honestly if lock cleanup fails', async () => {
    vi.mocked(withCredentialLock).mockImplementationOnce(async (_id, operation) => {
      await operation({ assertHeld() {} });
      throw new CredentialLockError('unavailable');
    });
    const response = await reset();
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload.partialState).toMatchObject({ credentialsChanged: true, emailDeliveryAttempted: true, emailSent: true });
    expect(payload.error).toContain('Email delivery was attempted and reported successful');
    expect(payload.temporaryPassword).toBeUndefined();
  });

  it('updates email and password together while preserving profile identity and links', async () => {
    const response = await reset({ email: '  Real@Example.test  ' });
    expect(response.status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { email: 'real@example.test', email_confirm: true, password: 'Fft1A2b' });
    expect(mocks.profileUpdate).toHaveBeenCalledExactlyOnceWith({ must_change_password: true });
    expect(mocks.revokeAppSessionsForProfile).toHaveBeenCalledWith('user-1', 'admin_password_reset');
    expect(mocks.revokeWebAuthnCredentialsForProfile).toHaveBeenCalledWith('user-1');
    expect(mocks.profileUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.revokeAppSessionsForProfile.mock.invocationCallOrder[0]);
    expect(mocks.revokeWebAuthnCredentialsForProfile.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateUserById.mock.invocationCallOrder[0]);
    expect(mocks.revokeAppSessionsForProfile).toHaveBeenCalledTimes(2);
    expect(mocks.revokeWebAuthnCredentialsForProfile).toHaveBeenCalledTimes(2);
    expect(mocks.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(mocks.revokeWebAuthnCredentialsForProfile.mock.invocationCallOrder[1]);
    expect(mocks.revokeWebAuthnCredentialsForProfile.mock.invocationCallOrder[1]).toBeLessThan(mocks.revokeAppSessionsForProfile.mock.invocationCallOrder[1]);
    expect(mocks.revokeAppSessionsForProfile.mock.invocationCallOrder[1]).toBeLessThan(mocks.sendPasswordEmail.mock.invocationCallOrder[0]);
    expect(mocks.sendPasswordEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'real@example.test' }));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['bad-address', '', 'a@b', 42, null])('rejects an invalid destination before mutations: %s', async (email) => {
    expect((await reset({ email })).status).toBe(400);
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    { role_id: null, role: null },
    { role_id: 'missing-role', role: null },
    { role_id: 'invalid-role', role: { is_super_admin: false, role_class: null } },
    { role_id: 'role-super', role: { is_super_admin: true } },
    { role_id: 'role-employee', role: { is_super_admin: false }, super_admin: true },
  ])('fails closed for a missing or protected target role', async (target) => {
    mocks.profileSelectSingle.mockResolvedValueOnce({ data: { full_name: 'User', ...target }, error: null });
    expect((await reset()).status).toBe(403);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
  });

  it('reports a target profile lookup failure without mutating credentials', async () => {
    mocks.profileSelectSingle.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    const response = await reset();
    expect(response.status).toBe(500);
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.logServerError).toHaveBeenCalled();
  });

  it('reports a target Auth lookup failure without applying restrictions', async () => {
    mocks.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { status: 503, message: 'offline' } });
    const response = await reset();
    expect(response.status).toBe(500);
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it('preserves role-management restrictions', async () => {
    mocks.canEffectiveRoleAssignRole.mockResolvedValueOnce(false);
    expect((await reset()).status).toBe(403);
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
  });

  it('preserves the locked sensitive PIN response', async () => {
    mocks.requireAdminUsersModuleAccess.mockResolvedValueOnce(NextResponse.json({ code: 'SENSITIVE_PIN_REQUIRED' }, { status: 428 }));
    expect((await reset()).status).toBe(428);
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: 'write denied' } },
    { data: null, error: null },
    { data: { id: 'user-1', must_change_password: false }, error: null },
  ])('does not issue credentials unless the flag write is confirmed', async (result) => {
    mocks.flagSingle.mockResolvedValueOnce(result);
    const response = await reset();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ partialState: { credentialsChanged: false } });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it.each(['sessions', 'biometrics'])('does not issue or email credentials if %s revocation fails', async (step) => {
    (step === 'sessions' ? mocks.revokeAppSessionsForProfile : mocks.revokeWebAuthnCredentialsForProfile).mockRejectedValueOnce(new Error('failed'));
    const response = await reset();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ partialState: { passwordChangeRequired: true, credentialsChanged: false } });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it.each(['sessions', 'biometrics'])('withholds credentials when final %s revocation fails after Auth changes', async (step) => {
    (step === 'sessions' ? mocks.revokeAppSessionsForProfile : mocks.revokeWebAuthnCredentialsForProfile)
      .mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('failed'));
    const response = await reset();
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.partialState).toMatchObject({ passwordChangeRequired: true, credentialsChanged: true });
    expect(payload.partialState[step === 'sessions' ? 'sessionsRevoked' : 'biometricsRevoked']).toBe(false);
    expect(payload.temporaryPassword).toBeUndefined();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it('reports duplicate email without claiming full success or sending credentials', async () => {
    mocks.updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { code: 'email_exists', message: 'Already registered' } });
    const response = await reset({ email: 'duplicate@example.test' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'EMAIL_ALREADY_IN_USE', partialState: { passwordChangeRequired: true, credentialsChanged: false, sessionsRevoked: true, biometricsRevoked: true } });
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it('reports an unconfirmed Auth update as potentially changed without disclosing credentials', async () => {
    mocks.updateUserById.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await reset();
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.partialState.credentialsMayHaveChanged).toBe(true);
    expect(payload.temporaryPassword).toBeUndefined();
    expect(mocks.sendPasswordEmail).not.toHaveBeenCalled();
  });

  it.each([false, 'throws'])('warns on failed delivery and retains the privileged password fallback: %s', async (failure) => {
    if (failure === 'throws') mocks.sendPasswordEmail.mockRejectedValueOnce(new Error('network failure'));
    else mocks.sendPasswordEmail.mockResolvedValueOnce({ success: false });
    const response = await reset();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ emailSent: false, temporaryPassword: 'Fft1A2b', warning: expect.stringContaining('delivery failed') });
  });

  it('identifies self-reset so the browser can finish signing out', async () => {
    mocks.getEffectiveRole.mockResolvedValue({ user_id: 'user-1' });
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: { id: 'user-1' }, validation: { cookieValue: null, cookieExpiresAt: null },
    });
    const response = await reset();
    expect(await response.json()).toMatchObject({ selfReset: true });
    expect(mocks.revokeAppSessionsForProfile).toHaveBeenCalledWith('user-1', 'admin_password_reset');
  });

  it('rejects non-admin access before attempting a reset', async () => {
    mocks.requireAdminUsersModuleAccess.mockResolvedValue(
      NextResponse.json(
        { error: 'Forbidden: admin-users access required' },
        { status: 403 }
      )
    );

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
