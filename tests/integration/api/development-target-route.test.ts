import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/development/target/route';

const env = {
  FFTS_DATA_ENVIRONMENT: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
  POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@127.0.0.1:55322/postgres',
  TESTSUITE_BASE_URL: 'http://127.0.0.1:4000',
};

afterEach(() => vi.unstubAllEnvs());

describe('development target identity', () => {
  it('is unavailable by default and for hosted targets', async () => {
    expect((await GET()).status).toBe(404);
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://zzwyffbzymvotcmxvhyf.supabase.co');
    const response = await GET();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('returns only a nonsecret, noncached identity for verified development', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicmVmIjoiZmZ0cy1kZXZlbG9wbWVudCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.fictional');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      environment: 'development', projectId: 'ffts-development',
      apiOrigin: env.NEXT_PUBLIC_SUPABASE_URL,
      database: { host: '127.0.0.1', port: 55322, name: 'postgres' },
      appOrigin: env.TESTSUITE_BASE_URL,
    });
  });
});
