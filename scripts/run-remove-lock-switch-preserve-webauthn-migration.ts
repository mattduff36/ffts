import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const migrationPath = 'supabase/migrations/20260526_remove_lock_switch_preserve_webauthn.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

const databaseUrl = connectionString;

function buildClient(): pg.Client {
  const url = new URL(databaseUrl);

  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration(): Promise<void> {
  const client = buildClient();

  try {
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), migrationPath), 'utf8');
    await client.query(sql);

    const { rows } = await client.query<{
      webauthn_devices_exists: boolean;
      pin_table_exists: boolean;
      locked_column_exists: boolean;
    }>(`
      SELECT
        to_regclass('public.webauthn_devices') IS NOT NULL AS webauthn_devices_exists,
        to_regclass('public.account_switch_device_credentials') IS NOT NULL AS pin_table_exists,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'app_auth_sessions'
            AND column_name = 'locked_at'
        ) AS locked_column_exists
    `);

    const result = rows[0];
    if (!result?.webauthn_devices_exists || result.pin_table_exists || result.locked_column_exists) {
      throw new Error('Lock/Switch schema cleanup verification failed');
    }

    console.log('Lock/Switch schema cleanup migration completed');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Lock/Switch schema cleanup migration failed'
  );
  process.exit(1);
});
