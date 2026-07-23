import 'server-only';

import pg, { type Client } from 'pg';

const { Client: PgClient } = pg;

export type SampleDataDbClient = Client;

export function getSampleDataConnectionString(): string | null {
  return process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || null;
}

export function createSampleDataDbClient(): SampleDataDbClient {
  const connectionString = getSampleDataConnectionString();
  if (!connectionString) {
    throw new Error('Sample-data database access is not configured.');
  }

  const url = new URL(connectionString);
  return new PgClient({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
}

export async function withSampleDataClient<T>(
  callback: (client: SampleDataDbClient) => Promise<T>
): Promise<T> {
  const client = createSampleDataDbClient();
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function acquireFixtureTransactionLock(
  client: SampleDataDbClient,
  fixtureKey: string
): Promise<void> {
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
    [`ffts:sample-data:${fixtureKey}`]
  );
  if (result.rows[0]?.locked !== true) {
    throw new Error('Another sample-data operation is already running.');
  }
}
