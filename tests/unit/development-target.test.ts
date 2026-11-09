import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDevelopmentTargetAvailabilityReason, requireDevelopmentTarget, type DevelopmentEnvironment } from '@/lib/utils/development-target';

const mocks = vi.hoisted(() => ({ pg: vi.fn(), admin: vi.fn(), supabase: vi.fn(), config: vi.fn() }));
vi.mock('pg', () => ({ default: { Client: mocks.pg } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.supabase }));
vi.mock('dotenv', () => ({ config: mocks.config }));

const jwt = (claims: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fictional`;
const local = {
  FFTS_DATA_ENVIRONMENT: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
  POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@127.0.0.1:55322/postgres',
  TESTSUITE_BASE_URL: 'http://127.0.0.1:4000',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ iss: 'supabase-demo', ref: 'ffts-development', role: 'anon' }),
  SUPABASE_SERVICE_ROLE_KEY: jwt({ iss: 'supabase-demo', ref: 'ffts-development', role: 'service_role' }),
};
function environment(overrides: Record<string, string | undefined> = {}): DevelopmentEnvironment { return { ...local, ...overrides }; }
function setEnv(env: DevelopmentEnvironment) { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value); }

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('pure development target guard', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])('accepts exact loopback tunnel targets (%s)', (host) => {
    const result = requireDevelopmentTarget(environment({
      NEXT_PUBLIC_SUPABASE_URL: `http://${host}:55321`,
      POSTGRES_URL_NON_POOLING: `postgresql://postgres:fictional@${host}:55322/postgres`,
      TESTSUITE_BASE_URL: `http://${host}:4000`,
    }));
    expect(result.projectId).toBe('ffts-development');
    expect(result.database.port).toBe(55322);
    expect(result.database.host).toBe(host.replace(/^\[|\]$/gu, ''));
  });

  it('accepts production-mode local builds and explicitly enabled NAS targets', () => {
    expect(requireDevelopmentTarget(environment({ NODE_ENV: 'production' })).environment).toBe('development');
    expect(requireDevelopmentTarget(environment({
      FFTS_DEVELOPMENT_HOST: '192.168.0.14',
      NEXT_PUBLIC_SUPABASE_URL: 'http://192.168.0.14:54321',
      POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@192.168.0.14:54322/postgres',
    })).database.host).toBe('192.168.0.14');
  });

  it.each([
    { FFTS_DATA_ENVIRONMENT: undefined },
    { FFTS_DATA_ENVIRONMENT: 'production' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://zzwyffbzymvotcmxvhyf.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://other.supabase.com:55321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost.evil.test:55321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.1:55321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://2130706433:55321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://user@127.0.0.1:55321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321@evil.test:55321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321/path' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://192.168.0.14:54321' },
    { POSTGRES_URL_NON_POOLING: undefined },
    { POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@localhost:55322/postgres' },
    { POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@127.0.0.1:54322/postgres' },
    { POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@127.0.0.1:55322/ffts' },
    { POSTGRES_URL_NON_POOLING: 'postgresql://postgres.zzwyffbzymvotcmxvhyf:fictional@127.0.0.1:55322/postgres' },
    { POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@db.zzwyffbzymvotcmxvhyf.supabase.co:55322/postgres' },
    { POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@127.0.0.1:55322/postgres?host=evil.test' },
    { POSTGRES_URL: 'postgresql://postgres:fictional@db.other.supabase.co:5432/postgres' },
    { SUPABASE_URL: 'https://other.supabase.co' },
    { SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: 'zzwyffbzymvotcmxvhyf', iss: 'supabase' }) },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ iss: 'https://other.supabase.co/auth/v1' }) },
    { SUPABASE_ANON_KEY: 'invalid.jwt.credential' },
    { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque_hosted_key' },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_opaque_key' },
    { SUPABASE_SERVICE_ROLE_KEY: jwt({}) },
    { SUPABASE_SERVICE_ROLE_KEY: jwt({ iss: 'supabase-demo', ref: 'ffts-development', role: 'anon' }) },
    { POSTGRES_PRISMA_URL: 'postgresql://postgres:fictional@cloud.example:5432/postgres' },
    { POSTGRES_HOST: 'cloud.example' },
    { PGSERVICE: 'production' },
    { TESTSUITE_BASE_URL: 'https://ffts.example.com' },
    { TESTSUITE_BASE_URL: 'http://127.0.0.1:3000' },
    { TESTSUITE_BASE_URL: 'http://user@localhost:4000' },
  ])('rejects hosted, mixed, missing and misleading configuration %#', (overrides) => {
    expect(() => requireDevelopmentTarget(environment(overrides))).toThrow(/Development target required/u);
    expect(getDevelopmentTargetAvailabilityReason(environment(overrides))).toMatch(/protected/u);
  });

  it('does not let legacy allowlists or confirmations re-enable hosted fixtures', () => {
    expect(() => requireDevelopmentTarget(environment({
      FFTS_DATA_ENVIRONMENT: 'production',
      SCHEDULING_SAMPLE_PRODUCTION_PROJECT_REF: 'zzwyffbzymvotcmxvhyf',
      FLEET_INVENTORY_SAMPLE_PRODUCTION_PROJECT_REF: 'zzwyffbzymvotcmxvhyf',
    }))).toThrow(/cannot override/u);
  });
});

describe('rejection precedes clients, authentication and network', () => {
  it('blocks SQL client construction and registry mutations, and exposes unavailable status without inspection', async () => {
    const { createSampleDataDbClient } = await import('@/lib/server/sample-data/database');
    const { executeSampleDataOperation, getManagedSampleDataStatus } = await import('@/lib/server/sample-data/registry');
    expect(() => createSampleDataDbClient()).toThrow(/Development target required/u);
    await expect(executeSampleDataOperation({
      fixtureKey: 'fleet-inventory-sample-v1', action: 'create', actorProfileId: 'fictional',
      confirmation: 'CREATE FLEET INVENTORY SAMPLE', fingerprint: 'fictional',
    })).rejects.toThrow(/Development target required/u);
    const status = await getManagedSampleDataStatus();
    expect(status.clearAll.canRemove).toBe(false);
    expect(status.fixtures.every((fixture) => !fixture.available && fixture.state === 'unavailable')).toBe(true);
    expect(mocks.pg).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('blocks standalone Auth helpers and fixture inspection before clients or queries', async () => {
    const scheduling = await import('@/lib/server/sample-data/scheduling-fixture');
    const fleet = await import('@/lib/server/sample-data/fleet-inventory-fixture');
    await expect(scheduling.createSchedulingAuthUser()).rejects.toThrow(/Development target required/u);
    await expect(scheduling.deleteSchedulingAuthUser('fictional')).rejects.toThrow(/Development target required/u);
    const query = vi.fn();
    expect((await scheduling.inspectSchedulingFixture({ query } as never)).available).toBe(false);
    expect((await fleet.inspectFleetInventoryFixture({ query } as never)).available).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('uses SSL false only after validating development, including IPv6 normalization', async () => {
    setEnv(environment({ NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:55321', POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@[::1]:55322/postgres' }));
    mocks.pg.mockImplementation(function () {});
    const { createSampleDataDbClient } = await import('@/lib/server/sample-data/database');
    createSampleDataDbClient();
    expect(mocks.pg).toHaveBeenCalledWith(expect.objectContaining({ host: '::1', port: 55322, ssl: false }));
  });

  it('keeps imported CLI fixture builders pure and blocks both CLI plans without clients', async () => {
    const scheduling = await import('@/scripts/testing/scheduling-sample');
    const fleet = await import('@/scripts/testing/fleet-inventory-sample');
    expect(mocks.config).not.toHaveBeenCalled();
    await expect(scheduling.main()).rejects.toThrow(/Development target required/u);
    await expect(fleet.main()).rejects.toThrow(/Development target required/u);
    expect(mocks.pg).not.toHaveBeenCalled();
    expect(mocks.supabase).not.toHaveBeenCalled();
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('.env.development.local') }));
  });

  it('blocks test-user setup before creating an admin client', async () => {
    await expect(import('@/scripts/setup-test-users')).rejects.toThrow(/Development target required/u);
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it('blocks testsuite hosted/mixed app targets before any fetch or client', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { runTestsuitePreflight } = await import('@/testsuite/helpers/preflight');
    setEnv(environment({ TESTSUITE_BASE_URL: 'https://ffts.example.com' }));
    await expect(runTestsuitePreflight()).rejects.toThrow(/Development target required/u);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it('rejects a locally reachable app that still points at hosted data before client construction', async () => {
    setEnv(local);
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }); vi.stubGlobal('fetch', fetch);
    const { runTestsuitePreflight } = await import('@/testsuite/helpers/preflight');
    await expect(runTestsuitePreflight()).rejects.toThrow(/verified development app/u);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4000/api/development/target', expect.objectContaining({ redirect: 'error' }));
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it('accepts a matching nonsecret running-app identity', async () => {
    setEnv(local);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => requireDevelopmentTarget(local) }));
    const { verifyDevelopmentAppTarget } = await import('@/testsuite/helpers/preflight');
    expect(await verifyDevelopmentAppTarget()).toEqual(requireDevelopmentTarget(local));
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it('rejects a different development app identity before client construction', async () => {
    setEnv(local);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ environment: 'development', projectId: 'ffts-development', apiOrigin: 'http://localhost:55321' }) }));
    const { runTestsuitePreflight } = await import('@/testsuite/helpers/preflight');
    await expect(runTestsuitePreflight()).rejects.toThrow(/do not match/u);
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it('ordinary test setup blocks legacy credential loading, real clients and network without opt-in', async () => {
    vi.stubEnv('FFTS_INTEGRATION_TESTS', undefined);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await import('@/tests/setup');
    const dotenv = await import('dotenv');
    expect(() => dotenv.config({ path: '.env.local' })).toThrow(/Real integration tests require/u);
    const { createClient } = await import('@supabase/supabase-js');
    expect(() => createClient(local.NEXT_PUBLIC_SUPABASE_URL, 'fictional')).toThrow(/Real integration tests require/u);
    const pg = await import('pg');
    expect(() => new pg.Client()).toThrow(/Real integration tests require/u);
    expect(() => globalThis.fetch('https://hosted.example.com')).toThrow(/Real integration tests require/u);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
