import { describe, expect, it } from 'vitest';
import { developmentPgOptions } from '@/lib/utils/development-pg-options';

const env = {
  FFTS_DATA_ENVIRONMENT: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
  POSTGRES_URL_NON_POOLING: 'postgresql://postgres:fictional@127.0.0.1:55322/postgres',
};

describe('integration PostgreSQL connection options', () => {
  it('constructs only the verified destination for clients and pools', () => {
    expect(developmentPgOptions(env, { max: 2, ssl: true })).toMatchObject({
      host: '127.0.0.1', port: 55322, database: 'postgres', user: 'postgres',
      password: 'fictional', ssl: false, max: 2,
    });
    expect(developmentPgOptions(env, env.POSTGRES_URL_NON_POOLING).connectionString).toBeUndefined();
  });

  it.each([
    { connectionString: env.POSTGRES_URL_NON_POOLING + '?host=cloud.example' },
    { connectionString: env.POSTGRES_URL_NON_POOLING, host: 'cloud.example' },
    { connectionString: 'postgresql://postgres:fictional@cloud.example:5432/postgres' },
    { stream: () => ({}) },
    { connection: {} },
    { user: 'another_project' },
    { password: () => 'from-external-provider' },
  ])('rejects destination overrides before constructing a driver %#', (options) => {
    expect(() => developmentPgOptions(env, options)).toThrow(/Development target required/);
  });
});
