import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260527_sensitive_module_pin_stepup.sql';

if (!connectionString) {
  console.error('Missing database connection string. Set POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local.');
  process.exit(1);
}

async function runMigration(conn: string) {
  const url = new URL(conn);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running sensitive module PIN step-up migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'permission_modules'
            AND column_name = 'requires_sensitive_pin'
        ) AS module_flag_ready,
        to_regclass('public.profile_sensitive_pins') IS NOT NULL AS pins_ready,
        to_regclass('public.sensitive_pin_unlocks') IS NOT NULL AS unlocks_ready,
        EXISTS (
          SELECT 1
          FROM public.permission_modules
          WHERE module_name IN ('customers', 'quotes')
            AND requires_sensitive_pin = TRUE
          HAVING COUNT(*) = 2
        ) AS default_modules_ready
    `);

    const result = rows[0];
    if (
      !result?.module_flag_ready ||
      !result?.pins_ready ||
      !result?.unlocks_ready ||
      !result?.default_modules_ready
    ) {
      throw new Error('Sensitive module PIN migration verification failed.');
    }

    console.log('Sensitive module PIN step-up migration complete.');
  } finally {
    await client.end();
  }
}

runMigration(connectionString).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
