import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// An in-test PostgreSQL model only: the routes use the real serialization helper.
const locks = new Map<string, MockClient>();
const events: string[] = [];
class MockClient {
  private key: string | null = null;
  on() { return this; }
  async connect() {}
  async query(sql: string, values?: string[]) {
    events.push(sql);
    if (sql.includes('pg_try_advisory_xact_lock')) {
      const key = JSON.stringify(values);
      if (locks.has(key)) return { rows: [{ locked: false }] };
      this.key = key;
      locks.set(key, this);
      return { rows: [{ locked: true }] };
    }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') this.release();
    return { rows: [] };
  }
  async end() { this.release(); }
  private release() {
    if (this.key && locks.get(this.key) === this) locks.delete(this.key);
    this.key = null;
  }
}
vi.doMock('pg', () => ({ default: { Client: MockClient } }));

let currentPassword = '';
let email = '';
let mustChangePassword = false;
let sessionActive = true;
const getCurrentAuthenticatedProfile = vi.fn();
const verifyUserPassword = vi.fn();
const updateUserById = vi.fn();
const profileUpdate = vi.fn();
const revokeAppSessionsForProfile = vi.fn();
const revokeWebAuthnCredentialsForProfile = vi.fn();
const sendPasswordEmail = vi.fn();
const generateSecurePassword = vi.fn();
const getEffectiveRole = vi.fn();
const requireAdminUsersModuleAccess = vi.fn();
const canEffectiveRoleAssignRole = vi.fn();

function currentSession() {
  return {
    profile: { id: 'user-1', email, must_change_password: mustChangePassword },
    validation: { cookieValue: null, cookieExpiresAt: null },
  };
}
const admin = {
  auth: { admin: { updateUserById, getUserById: async () => ({ data: { user: { id: 'user-1', email } }, error: null }) } },
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({
      data: { full_name: 'Example User', role_id: 'employee-role', super_admin: false, role: { is_super_admin: false, role_class: 'employee' } },
      error: null,
    }) }) }),
    update: profileUpdate,
  }),
};
vi.doMock('@/lib/server/app-auth/session', () => ({ getCurrentAuthenticatedProfile, revokeAppSessionsForProfile }));
vi.doMock('@/lib/server/password-auth', () => ({ verifyUserPassword }));
vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
vi.doMock('@supabase/supabase-js', () => ({ createClient: () => admin }));
vi.doMock('@/lib/server/webauthn/credentials', () => ({ revokeWebAuthnCredentialsForProfile }));
vi.doMock('@/lib/utils/view-as', () => ({ getEffectiveRole }));
vi.doMock('@/lib/server/admin-users-module-access', () => ({ requireAdminUsersModuleAccess }));
vi.doMock('@/lib/utils/rbac', () => ({ canEffectiveRoleAssignRole }));
vi.doMock('@/lib/utils/email', () => ({ sendPasswordEmail }));
vi.doMock('@/lib/utils/server-error-logger', () => ({ logServerError: vi.fn() }));
vi.doMock('@/lib/utils/password', async () => ({
  ...await vi.importActual<typeof import('@/lib/utils/password')>('@/lib/utils/password'),
  generateSecurePassword,
}));

const { POST: changePassword } = await import('@/app/api/auth/change-password/route');
const { POST: resetPassword } = await import('@/app/api/admin/users/[id]/reset-password/route');

function change() {
  return changePassword(new Request('http://localhost/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword: 'OldPassword123', password: 'PermanentPassword456' }),
  }) as never);
}
function reset() {
  return resetPassword(new Request('http://localhost/api/admin/users/user-1/reset-password', { method: 'POST' }) as never,
    { params: Promise.resolve({ id: 'user-1' }) });
}

describe('credential route interleavings (all services mocked)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    locks.clear();
    events.length = 0;
    vi.stubEnv('POSTGRES_URL_NON_POOLING', 'postgresql://postgres:fictional@db.example.test:5432/postgres');
    currentPassword = 'OldPassword123';
    email = 'user@example.test';
    mustChangePassword = true;
    sessionActive = true;
    getCurrentAuthenticatedProfile.mockImplementation(async (options?: { allowPendingPasswordChange?: boolean }) => options?.allowPendingPasswordChange
      ? (sessionActive ? currentSession() : null)
      : { profile: { id: 'admin-1' }, validation: { cookieValue: null, cookieExpiresAt: null } });
    verifyUserPassword.mockImplementation(async (_email: string, _id: string, password: string) => password === currentPassword);
    updateUserById.mockImplementation(async (id: string, attributes: { password: string; email?: string }) => {
      expect(locks.size).toBe(1);
      currentPassword = attributes.password;
      email = attributes.email ?? email;
      return { data: { user: { id, email } }, error: null };
    });
    profileUpdate.mockImplementation((attributes: { must_change_password: boolean }) => ({
      eq: () => ({ select: () => ({ single: async () => {
        expect(locks.size).toBe(1);
        mustChangePassword = attributes.must_change_password;
        return { data: { id: 'user-1', must_change_password: mustChangePassword }, error: null };
      } }) }),
    }));
    revokeAppSessionsForProfile.mockImplementation(async () => { sessionActive = false; return 1; });
    revokeWebAuthnCredentialsForProfile.mockResolvedValue(1);
    sendPasswordEmail.mockResolvedValue({ success: true });
    generateSecurePassword.mockReturnValue('TemporaryPassword789');
    getEffectiveRole.mockResolvedValue({ user_id: 'admin-1' });
    requireAdminUsersModuleAccess.mockResolvedValue(null);
    canEffectiveRoleAssignRole.mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['revoked-app-session', 'still-valid-legacy-session'])('a reset wins over an already-started stale completion (%s), which cannot overwrite credentials or clear the flag', async (sessionKind) => {
    if (sessionKind === 'still-valid-legacy-session') revokeAppSessionsForProfile.mockResolvedValue(0);
    const identified = deferred();
    const resumeStaleRequest = deferred();
    getCurrentAuthenticatedProfile.mockImplementationOnce(async () => {
      const stale = currentSession();
      identified.resolve();
      await resumeStaleRequest.promise;
      return stale;
    });
    const staleCompletion = change();
    await identified.promise;
    expect((await reset()).status).toBe(200);
    expect(currentPassword).toBe('TemporaryPassword789');
    expect(mustChangePassword).toBe(true);
    resumeStaleRequest.resolve();
    expect((await staleCompletion).status).toBe(401);
    expect(getCurrentAuthenticatedProfile).toHaveBeenCalledTimes(4);
    if (sessionKind === 'revoked-app-session') expect(verifyUserPassword).not.toHaveBeenCalled();
    else expect(verifyUserPassword).toHaveBeenCalledExactlyOnceWith('user@example.test', 'user-1', 'OldPassword123');
    expect(updateUserById).toHaveBeenCalledExactlyOnceWith('user-1', { password: 'TemporaryPassword789' });
    expect(profileUpdate).toHaveBeenCalledExactlyOnceWith({ must_change_password: true });
    expect(currentPassword).toBe('TemporaryPassword789');
    expect(mustChangePassword).toBe(true);
    expect(locks.size).toBe(0);
  });

  it('a completion holds its lock while verifying the old password; reset is busy with no writes until a retry', async () => {
    const verifying = deferred();
    const finishVerification = deferred();
    verifyUserPassword.mockImplementationOnce(async () => {
      verifying.resolve();
      await finishVerification.promise;
      return true;
    });
    const completion = change();
    await verifying.promise;
    const busy = await reset();
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: 'CREDENTIAL_CHANGE_BUSY' });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
    expect(revokeAppSessionsForProfile).not.toHaveBeenCalled();
    expect(sendPasswordEmail).not.toHaveBeenCalled();
    finishVerification.resolve();
    expect((await completion).status).toBe(200);
    expect(mustChangePassword).toBe(false);
    expect((await reset()).status).toBe(200);
    expect(currentPassword).toBe('TemporaryPassword789');
    expect(mustChangePassword).toBe(true);
    expect(locks.size).toBe(0);
  });

  it('serializes concurrent resets through email delivery and response preparation', async () => {
    const delivering = deferred();
    const finishDelivery = deferred();
    sendPasswordEmail.mockImplementationOnce(async () => {
      expect(locks.size).toBe(1);
      delivering.resolve();
      await finishDelivery.promise;
      expect(locks.size).toBe(1);
      return { success: true };
    });
    const firstReset = reset();
    await delivering.promise;
    const secondReset = await reset();
    expect(secondReset.status).toBe(409);
    expect(updateUserById).toHaveBeenCalledOnce();
    expect(profileUpdate).toHaveBeenCalledOnce();
    expect(revokeAppSessionsForProfile).toHaveBeenCalledTimes(2);
    expect(revokeWebAuthnCredentialsForProfile).toHaveBeenCalledTimes(2);
    expect(sendPasswordEmail).toHaveBeenCalledOnce();
    expect(generateSecurePassword).toHaveBeenCalledOnce();
    expect(events).not.toContain('COMMIT');
    finishDelivery.resolve();
    const response = await firstReset;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ temporaryPassword: 'TemporaryPassword789', emailSent: true });
    expect(events.at(-1)).toBe('COMMIT');
    expect(locks.size).toBe(0);
  });
});
