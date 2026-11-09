import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientOptions: [] as Array<Record<string, unknown>>,
  developmentPgOptions: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/utils/development-pg-options', () => ({
  developmentPgOptions: mocks.developmentPgOptions,
}));
vi.mock('pg', () => ({
  default: {
    Client: class {
      constructor(options: Record<string, unknown>) {
        mocks.clientOptions.push(options);
      }
      async connect() {}
      async query() { return { rows: [{ ok: 1 }] }; }
      async end() {}
    },
  },
}));

describe('database health PostgreSQL connection options', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.clientOptions.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the guarded plaintext NAS PostgreSQL options in development', async () => {
    vi.stubEnv('FFTS_DATA_ENVIRONMENT', 'development');
    const guarded = {
      host: '127.0.0.1',
      port: 55322,
      database: 'postgres',
      user: 'postgres',
      password: 'fictional',
      ssl: false,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
      statement_timeout: 3000,
    };
    mocks.developmentPgOptions.mockReturnValue(guarded);

    const { probeDatabaseHealth } = await import('@/lib/server/database-health');
    await expect(probeDatabaseHealth({
      connectionString: 'postgresql://postgres:fictional@127.0.0.1:55322/postgres',
    })).resolves.toMatchObject({ ok: true });

    expect(mocks.developmentPgOptions).toHaveBeenCalledOnce();
    expect(mocks.developmentPgOptions).toHaveBeenCalledWith(
      process.env,
      expect.objectContaining({
        connectionString: 'postgresql://postgres:fictional@127.0.0.1:55322/postgres',
        connectionTimeoutMillis: 3000,
        query_timeout: 3000,
        statement_timeout: 3000,
      })
    );
    expect(mocks.clientOptions).toEqual([guarded]);
  });

  it('retains TLS for non-development database health probes', async () => {
    vi.stubEnv('FFTS_DATA_ENVIRONMENT', 'hosted');

    const { probeDatabaseHealth } = await import('@/lib/server/database-health');
    await expect(probeDatabaseHealth({
      connectionString: 'postgresql://postgres:fictional@db.example.test:5432/postgres',
    })).resolves.toMatchObject({ ok: true });

    expect(mocks.developmentPgOptions).not.toHaveBeenCalled();
    expect(mocks.clientOptions[0]).toMatchObject({
      host: 'db.example.test',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
      statement_timeout: 3000,
    });
  });
});
