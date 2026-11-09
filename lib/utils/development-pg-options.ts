import type { ClientConfig, PoolConfig } from 'pg';
import { DevelopmentTargetError, requireDevelopmentTarget, type DevelopmentEnvironment } from './development-target';

type PgOptions = ClientConfig & PoolConfig;
const allowedOptions = new Set([
  'connectionString', 'host', 'port', 'database', 'user', 'password', 'ssl',
  'application_name', 'fallback_application_name', 'connectionTimeoutMillis',
  'query_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout',
  'keepAlive', 'keepAliveInitialDelayMillis', 'max', 'min', 'maxUses',
  'idleTimeoutMillis', 'allowExitOnIdle', 'maxLifetimeSeconds', 'types',
]);

/** Validate caller options and construct a connection that cannot override the development destination. */
export function developmentPgOptions(env: DevelopmentEnvironment, input?: unknown): PgOptions {
  const target = requireDevelopmentTarget(env);
  if (input !== undefined && typeof input !== 'string' && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new DevelopmentTargetError('Unsupported PostgreSQL client options.');
  }
  const options = (typeof input === 'string' ? { connectionString: input } : input || {}) as Record<string, unknown>;
  for (const key of Object.keys(options)) {
    if (!allowedOptions.has(key)) throw new DevelopmentTargetError('Unsupported PostgreSQL connection option: ' + key + '.');
  }
  const connectionString = options.connectionString;
  if (connectionString !== undefined) {
    if (typeof connectionString !== 'string') throw new DevelopmentTargetError('PostgreSQL connectionString must be a URL.');
    requireDevelopmentTarget({ ...env, POSTGRES_URL_NON_POOLING: connectionString, POSTGRES_URL: undefined, POSTGRES_PRISMA_URL: undefined });
  }
  const expected: Record<string, string | number> = { host: target.database.host, port: target.database.port, database: 'postgres', user: 'postgres' };
  for (const [key, value] of Object.entries(expected)) {
    if (options[key] === undefined) continue;
    const requested = key === 'port' ? Number(options[key]) : key === 'host' ? String(options[key]).replace(/^\[|\]$/gu, '').toLowerCase() : options[key];
    if (requested !== value) throw new DevelopmentTargetError('PostgreSQL ' + key + ' conflicts with the verified development target.');
  }
  if (options.password !== undefined && typeof options.password !== 'string') {
    throw new DevelopmentTargetError('PostgreSQL password callbacks are not supported in integration tests.');
  }
  const url = new URL(typeof connectionString === 'string' ? connectionString : env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL!);
  return {
    ...options,
    connectionString: undefined,
    host: target.database.host,
    port: target.database.port,
    database: 'postgres',
    user: 'postgres',
    password: typeof options.password === 'string' ? options.password : decodeURIComponent(url.password),
    ssl: false,
  } as PgOptions;
}
