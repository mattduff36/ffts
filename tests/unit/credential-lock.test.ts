import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connect = vi.fn();
const query = vi.fn();
const end = vi.fn();
const listeners = new Map<string, () => void>();
const Client = vi.fn(function () {
  return { connect, query, end, on: (event: string, listener: () => void) => listeners.set(event, listener) };
});
vi.doMock('pg', () => ({ default: { Client } }));
const getCurrentAuthenticatedProfile = vi.fn();
const setCookie = vi.fn();
vi.doMock('@/lib/server/app-auth/session', () => ({ getCurrentAuthenticatedProfile }));
vi.doMock('next/headers', () => ({ cookies: async () => ({ set: setCookie }) }));
const { CredentialLockError, getCredentialChangeProfile, withCredentialLock } = await import('@/lib/server/app-auth/credential-lock');

const connection = 'postgresql://account%40demo:p%40ss%3Aword@db.example.test:6543/postgres';
const lockSql = 'SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2::uuid::text)) AS locked';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('account credential transaction lock (mocked PostgreSQL)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listeners.clear();
    vi.stubEnv('POSTGRES_URL_NON_POOLING', connection);
    vi.stubEnv('POSTGRES_URL', '');
    vi.stubEnv('FFTS_DATA_ENVIRONMENT', '');
    connect.mockResolvedValue(undefined);
    end.mockResolvedValue(undefined);
    query.mockImplementation(async (sql: string) => ({ rows: sql === lockSql ? [{ locked: true }] : [] }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('makes a rotated session cookie available to repeated live validation in the same request', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    const renewed = { profile: { id: 'profile-1' }, validation: { cookieValue: 'renewed-cookie', cookieExpiresAt: expiresAt } };
    getCurrentAuthenticatedProfile.mockResolvedValueOnce(renewed).mockImplementationOnce(async () => {
      expect(setCookie).toHaveBeenCalledWith(expect.any(String), 'renewed-cookie', expect.objectContaining({ httpOnly: true, expires: expiresAt }));
      return { ...renewed, validation: { cookieValue: null, cookieExpiresAt: null } };
    });
    await getCredentialChangeProfile({ allowPendingPasswordChange: true });
    expect((await getCredentialChangeProfile({ allowPendingPasswordChange: true }))?.profile.id).toBe('profile-1');
    expect(getCurrentAuthenticatedProfile).toHaveBeenCalledTimes(2);
    expect(setCookie).toHaveBeenCalledOnce();
  });

  it('pins a dedicated transaction, disables idle expiry and uses one namespace/account key', async () => {
    const result = await withCredentialLock('PROFILE-1', async (lock) => {
      lock.assertHeld();
      expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'SET LOCAL idle_in_transaction_session_timeout = 0', lockSql]);
      expect(end).not.toHaveBeenCalled();
      return 'completed';
    });
    expect(result).toBe('completed');
    expect(query).toHaveBeenNthCalledWith(3, lockSql, ['ffts:account-credentials', 'profile-1']);
    expect(query).toHaveBeenLastCalledWith('COMMIT', undefined);
    expect(end).toHaveBeenCalledExactlyOnceWith();
    expect(Client).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      host: 'db.example.test', port: 6543, database: 'postgres', user: 'account@demo', password: 'p@ss:word',
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000,
    }));
  });

  it('does not release or commit while protected work awaits another service', async () => {
    const entered = deferred();
    const finish = deferred();
    const work = withCredentialLock('profile-1', async () => { entered.resolve(); await finish.promise; });
    await entered.promise;
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(end).not.toHaveBeenCalled();
    finish.resolve();
    await work;
    expect(query).toHaveBeenLastCalledWith('COMMIT', undefined);
    expect(end).toHaveBeenCalledOnce();
  });

  it('fails fast when busy without invoking protected work and rolls back/closes', async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql === lockSql ? [{ locked: false }] : [] }));
    const operation = vi.fn();
    await expect(withCredentialLock('profile-1', operation)).rejects.toMatchObject({ status: 409, code: 'CREDENTIAL_CHANGE_BUSY' });
    expect(operation).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(end).toHaveBeenCalledOnce();
  });

  it('rolls back and closes on callback failure without masking the callback error', async () => {
    const failure = new Error('callback failed');
    await expect(withCredentialLock('profile-1', async () => { throw failure; })).rejects.toBe(failure);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(end).toHaveBeenCalledOnce();
  });

  it.each(['connect', 'BEGIN', 'SET LOCAL idle_in_transaction_session_timeout = 0', lockSql, 'COMMIT', 'end'])('sanitizes %s failures and always closes the client', async (step) => {
    const sensitive = new Error('driver failure with private connection details');
    if (step === 'connect') connect.mockRejectedValueOnce(sensitive);
    else if (step === 'end') end.mockRejectedValueOnce(sensitive);
    else query.mockImplementation(async (sql: string) => {
      if (sql === step) throw sensitive;
      return { rows: sql === lockSql ? [{ locked: true }] : [] };
    });
    const operation = vi.fn(async () => 'result');
    await expect(withCredentialLock('profile-1', operation)).rejects.toMatchObject({
      status: 503, code: 'CREDENTIAL_CHANGE_UNAVAILABLE', message: 'Credential changes are temporarily unavailable. Please retry.',
    });
    if (!['COMMIT', 'end'].includes(step)) expect(operation).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
  });

  it('fails closed if rollback itself fails', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('driver failure');
      return { rows: sql === lockSql ? [{ locked: true }] : [] };
    });
    await expect(withCredentialLock('profile-1', async () => { throw new Error('callback failed'); }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_CHANGE_UNAVAILABLE' });
    expect(end).toHaveBeenCalledOnce();
  });

  it.each(['error', 'end'])('detects connection %s during protected awaits before allowing another mutation', async (event) => {
    const mutation = vi.fn();
    await expect(withCredentialLock('profile-1', async (lock) => {
      listeners.get(event)?.();
      await Promise.resolve();
      lock.assertHeld();
      mutation();
    })).rejects.toBeInstanceOf(CredentialLockError);
    expect(mutation).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(end).toHaveBeenCalledOnce();
  });

  it('rejects a missing lock result rather than running unprotected', async () => {
    query.mockResolvedValue({ rows: [] });
    const operation = vi.fn();
    await expect(withCredentialLock('profile-1', operation)).rejects.toMatchObject({ status: 503 });
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects missing configuration before constructing a client', async () => {
    vi.stubEnv('POSTGRES_URL_NON_POOLING', '');
    await expect(withCredentialLock('profile-1', vi.fn())).rejects.toMatchObject({ status: 503 });
    expect(Client).not.toHaveBeenCalled();
  });

  it('uses the POSTGRES_URL fallback without accepting URL TLS overrides', async () => {
    vi.stubEnv('POSTGRES_URL_NON_POOLING', '');
    vi.stubEnv('POSTGRES_URL', connection + '?sslmode=disable');
    await withCredentialLock('profile-1', async () => undefined);
    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ ssl: { rejectUnauthorized: false } }));
  });

  it('allows plaintext only through the verified development target', async () => {
    vi.stubEnv('FFTS_DATA_ENVIRONMENT', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55321');
    vi.stubEnv('POSTGRES_URL_NON_POOLING', 'postgresql://postgres:fictional@127.0.0.1:55322/postgres');
    await withCredentialLock('profile-1', async () => undefined);
    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 55322, ssl: false }));
  });

  it('fails closed for an unverified development destination', async () => {
    vi.stubEnv('FFTS_DATA_ENVIRONMENT', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55321');
    await expect(withCredentialLock('profile-1', vi.fn())).rejects.toMatchObject({ status: 503 });
    expect(Client).not.toHaveBeenCalled();
  });
});
