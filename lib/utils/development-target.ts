export type DevelopmentEnvironment = Readonly<Record<string, string | undefined>>;

export interface DevelopmentTarget {
  environment: 'development';
  projectId: 'ffts-development';
  apiOrigin: string;
  database: { host: string; port: number; name: 'postgres' };
  appOrigin: string;
}

export class DevelopmentTargetError extends Error {
  constructor(reason: string) {
    super(`Development target required: ${reason} Hosted/client data is protected; production confirmations and sample allowlists cannot override this guard.`);
    this.name = 'DevelopmentTargetError';
  }
}

function fail(reason: string): never {
  throw new DevelopmentTargetError(reason);
}

function parseUrl(value: string | undefined, label: string): URL {
  if (!value || value !== value.trim() || /[\\\s]/u.test(value)) {
    return fail(`${label} is missing or invalid.`);
  }
  try {
    const url = new URL(value);
    const authority = value.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu)?.[1];
    const address = authority?.slice(authority.lastIndexOf('@') + 1);
    if (!address || address.toLowerCase() !== url.host.toLowerCase()) {
      return fail(`${label} must use an exact, unambiguous host and port.`);
    }
    return url;
  } catch {
    return fail(`${label} is not a valid URL.`);
  }
}

function host(url: URL): string {
  return url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
}

function requirePlainOrigin(url: URL, label: string): void {
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    fail(`${label} must be a plain HTTP development origin without userinfo, path, query or fragment.`);
  }
}

function validateCredential(value: string | undefined, role: 'anon' | 'service_role'): void {
  if (!value) return;
  if (/supabase\.(co|com)|zzwyffbzymvotcmxvhyf/iu.test(value)) {
    fail('A configured credential identifies a hosted target.');
  }
  if (value.split('.').length !== 3 || value.split('.').some((part) => !part)) fail('Development API credentials must be project-specific JWTs; opaque or unknown keys are not accepted.');
  let claims: unknown;
  try {
    const payload = value.split('.')[1].replace(/-/gu, '+').replace(/_/gu, '/');
    claims = JSON.parse(atob(payload));
  } catch {
    return fail('A configured JWT credential is invalid.');
  }
  if (!claims || typeof claims !== 'object') fail('A configured JWT credential is invalid.');
  if (!('ref' in claims) || claims.ref !== 'ffts-development') {
    fail('A configured JWT credential identifies a different project.');
  }
  if (!('iss' in claims) || claims.iss !== 'supabase-demo' || !('role' in claims) || claims.role !== role) {
    fail('A configured JWT credential has an unexpected development issuer or role.');
  }
}

/** Pure, fail-closed validation; no environment loading, clients or network access. */
export function requireDevelopmentTarget(env: DevelopmentEnvironment): DevelopmentTarget {
  if (env.FFTS_DATA_ENVIRONMENT !== 'development') {
    fail('Set FFTS_DATA_ENVIRONMENT=development for a dedicated development database.');
  }
  const api = parseUrl(env.NEXT_PUBLIC_SUPABASE_URL, 'Supabase API URL');
  requirePlainOrigin(api, 'Supabase API URL');
  const apiHost = host(api);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(apiHost);
  const nas = apiHost === '192.168.0.14' && env.FFTS_DEVELOPMENT_HOST === '192.168.0.14';
  if ((!loopback && !nas) || api.port !== (loopback ? '55321' : '54321')) {
    fail('Supabase API must use loopback port 55321 or the explicitly enabled NAS port 54321.');
  }
  const connections = [env.POSTGRES_URL_NON_POOLING, env.POSTGRES_URL, env.POSTGRES_PRISMA_URL].filter((value): value is string => Boolean(value));
  if (connections.length === 0) fail('A development PostgreSQL URL is required.');
  const pgPort = loopback ? 55322 : 54322;
  for (const connection of connections) {
    const db = parseUrl(connection, 'PostgreSQL URL');
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || host(db) !== apiHost || db.port !== String(pgPort)
      || db.pathname !== '/postgres' || db.username !== 'postgres' || db.search || db.hash) {
      fail('Every PostgreSQL URL must match the API host, designated development port, postgres user and postgres database (no connection options).');
    }
  }
  if (env.SUPABASE_URL && env.SUPABASE_URL !== api.origin) {
    fail('SUPABASE_URL conflicts with the development API.');
  }
  for (const name of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY']) {
    validateCredential(env[name], 'anon');
  }
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']) validateCredential(env[name], 'service_role');
  for (const [name, expected] of Object.entries({ POSTGRES_HOST: apiHost, PGHOST: apiHost, POSTGRES_PORT: String(pgPort), PGPORT: String(pgPort), POSTGRES_DATABASE: 'postgres', PGDATABASE: 'postgres', POSTGRES_USER: 'postgres', PGUSER: 'postgres' })) {
    if (env[name] && env[name] !== expected) fail(name + ' conflicts with the verified development database.');
  }
  for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR']) if (env[name]) fail(name + ' can override the verified database and is not supported.');
  const app = parseUrl(env.TESTSUITE_BASE_URL || 'http://127.0.0.1:4000', 'Testsuite application URL');
  requirePlainOrigin(app, 'Testsuite application URL');
  const appPort = env.FFTS_DEVELOPMENT_APP_PORT || '4000';
  if (!/^\d{4,5}$/u.test(appPort) || Number(appPort) > 65535
    || !['127.0.0.1', 'localhost', '::1'].includes(host(app)) || app.port !== appPort) {
    fail('Testsuite application must use a loopback development port (default 4000).');
  }
  return {
    environment: 'development', projectId: 'ffts-development', apiOrigin: api.origin,
    database: { host: apiHost, port: pgPort, name: 'postgres' }, appOrigin: app.origin,
  };
}

export function getDevelopmentTargetAvailabilityReason(env: DevelopmentEnvironment): string | null {
  try {
    requireDevelopmentTarget(env);
    return null;
  } catch (error) {
    if (error instanceof DevelopmentTargetError) return error.message;
    throw error;
  }
}
