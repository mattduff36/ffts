import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const migrationPath = 'supabase/migrations/20260525_biometric_webauthn_login.sql';

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

    const { rows } = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'webauthn_credentials',
          'webauthn_challenges',
          'webauthn_prompt_preferences'
        )
      ORDER BY table_name
    `);

    if (rows.length !== 3) {
      throw new Error('Biometric WebAuthn tables were not created successfully');
    }

    console.log('Biometric WebAuthn migration completed');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Biometric WebAuthn migration failed');
  process.exit(1);
});
