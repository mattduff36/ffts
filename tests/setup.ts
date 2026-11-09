// tests/setup.ts
import { vi } from 'vitest';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { requireDevelopmentTarget } from '../lib/utils/development-target';
import { developmentPgOptions } from '../lib/utils/development-pg-options';

vi.mock('server-only', () => ({}));

const integrationEnabled = process.env.FFTS_INTEGRATION_TESTS === 'development';
function requireIntegrationTarget() {
  if (!integrationEnabled) throw new Error('Real integration tests require FFTS_INTEGRATION_TESTS=development and a verified development target.');
  return requireDevelopmentTarget(process.env);
}

if (integrationEnabled) {
  dotenv.config({ path: resolve(process.cwd(), '.env.development.local') });
  requireIntegrationTarget();
  const { verifyDevelopmentAppTarget } = await import('../testsuite/helpers/preflight');
  await verifyDevelopmentAppTarget();
} else {
  for (const key of Object.keys(process.env)) {
    if (/SUPABASE|POSTGRES|^PG(HOST|PORT|DATABASE|USER|PASSWORD|SERVICE)|FFTS_DATA_ENVIRONMENT|TESTSUITE/u.test(key)) delete process.env[key];
  }
}

// Legacy test-level dotenv calls must never reload the protected hosted file.
vi.doMock('dotenv', () => {
  const config = () => { requireIntegrationTarget(); return { parsed: {} }; };
  return { ...dotenv, config, default: { ...dotenv, config } };
});
vi.doMock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: new Proxy(actual.createClient, {
    apply(target, receiver, args) {
      const development = requireIntegrationTarget();
      if (args[0] !== development.apiOrigin) throw new Error('Integration client must use the verified development API.');
      return Reflect.apply(target, receiver, args);
    },
  }) };
});
vi.doMock('pg', async () => {
  const actual = await vi.importActual<typeof import('pg')>('pg');
  const guard = <T extends typeof actual.Client | typeof actual.Pool>(Constructor: T): T => new Proxy(Constructor, {
    construct(target, args) {
      requireIntegrationTarget();
      return Reflect.construct(target, [developmentPgOptions(process.env, args[0])]);
    },
  });
  const Client = guard(actual.Client);
  const Pool = guard(actual.Pool);
  return { ...actual, Client, Pool, default: { ...actual.default, Client, Pool } };
});

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const development = requireIntegrationTarget();
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (![development.apiOrigin, development.appOrigin].includes(url.origin)) {
    throw new Error('Integration requests must use the verified development API or app.');
  }
  return originalFetch(input, { ...init, redirect: 'error' });
};
