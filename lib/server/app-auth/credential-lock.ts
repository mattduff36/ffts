import 'server-only';

import pg from 'pg';
import { cookies } from 'next/headers';
import { developmentPgOptions } from '@/lib/utils/development-pg-options';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';

const TIMEOUT_MS = 5_000;
const LOCK_NAMESPACE = 'ffts:account-credentials';

export class CredentialLockError extends Error {
  readonly code: 'CREDENTIAL_CHANGE_BUSY' | 'CREDENTIAL_CHANGE_UNAVAILABLE';
  readonly status: 409 | 503;

  constructor(reason: 'busy' | 'unavailable') {
    super(reason === 'busy'
      ? 'Another credential change is in progress for this account. Please retry.'
      : 'Credential changes are temporarily unavailable. Please retry.');
    this.name = 'CredentialLockError';
    this.code = reason === 'busy' ? 'CREDENTIAL_CHANGE_BUSY' : 'CREDENTIAL_CHANGE_UNAVAILABLE';
    this.status = reason === 'busy' ? 409 : 503;
  }
}

export interface CredentialLock {
  assertHeld(): void;
}

export async function getCredentialChangeProfile(
  options: Parameters<typeof getCurrentAuthenticatedProfile>[0] = {}
) {
  const current = await getCurrentAuthenticatedProfile(options);
  if (current?.validation.cookieValue && current.validation.cookieExpiresAt) {
    // Validation can rotate the secret. Fresh reads in this request must see it too.
    setAppSessionCookieInResponse(
      { cookies: await cookies() }, current.validation.cookieValue, current.validation.cookieExpiresAt
    );
  }
  return current;
}

function createClient(): pg.Client {
  try {
    const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    if (!connectionString) throw new CredentialLockError('unavailable');
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new CredentialLockError('unavailable');
    const options: pg.ClientConfig = {
      host: url.hostname,
      port: Number.parseInt(url.port || '5432', 10),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: TIMEOUT_MS,
      query_timeout: TIMEOUT_MS,
      statement_timeout: TIMEOUT_MS,
      keepAlive: true,
    };
    return new pg.Client(process.env.FFTS_DATA_ENVIRONMENT === 'development'
      ? developmentPgOptions(process.env, options)
      : options);
  } catch {
    // Driver/configuration errors may contain credentials. Never propagate them.
    throw new CredentialLockError('unavailable');
  }
}

export async function withCredentialLock<T>(
  profileId: string,
  operation: (lock: CredentialLock) => Promise<T>
): Promise<T> {
  const client = createClient();
  let transactionStarted = false;
  let connectionLost = false;
  const markConnectionLost = () => { connectionLost = true; };
  client.on('error', markConnectionLost);
  client.on('end', markConnectionLost);
  const lock: CredentialLock = {
    assertHeld() {
      if (connectionLost) throw new CredentialLockError('unavailable');
    },
  };
  async function query(sql: string, values?: string[]) {
    lock.assertHeld();
    try {
      const result = await client.query<{ locked: boolean }>(sql, values);
      lock.assertHeld();
      return result;
    } catch {
      throw new CredentialLockError('unavailable');
    }
  }

  try {
    try {
      await client.connect();
    } catch {
      throw new CredentialLockError('unavailable');
    }
    await query('BEGIN');
    transactionStarted = true;
    // Auth/email awaits are intentionally idle SQL time; never expire their lock.
    await query('SET LOCAL idle_in_transaction_session_timeout = 0');
    const { rows } = await query(
      'SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2::uuid::text)) AS locked',
      [LOCK_NAMESPACE, profileId.toLowerCase()]
    );
    if (rows[0]?.locked === false) throw new CredentialLockError('busy');
    if (rows[0]?.locked !== true) throw new CredentialLockError('unavailable');

    const result = await operation(lock);
    lock.assertHeld();
    await query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        connectionLost = true;
      }
    }
    if (connectionLost) throw new CredentialLockError('unavailable');
    throw error;
  } finally {
    try {
      await client.end();
    } catch {
      throw new CredentialLockError('unavailable');
    }
  }
}
