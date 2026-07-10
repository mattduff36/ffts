import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260601_service_health_events.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Service Health Events migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows: tableRows } = await client.query(`
      SELECT to_regclass('public.service_health_events') AS table_name
    `);

    if (tableRows[0]?.table_name !== 'service_health_events') {
      throw new Error('service_health_events table was not created');
    }

    const { rows: columnRows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'service_health_events'
        AND column_name IN (
          'id',
          'service',
          'status',
          'outage_started_at',
          'outage_last_seen_at',
          'recovered_at',
          'recovery_error_log_id',
          'created_at',
          'updated_at'
        )
    `);

    if (columnRows.length !== 9) {
      throw new Error(`Expected 9 service_health_events columns, found ${columnRows.length}`);
    }

    const { rows: rlsRows } = await client.query(`
      SELECT rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = 'service_health_events'
    `);

    if (!rlsRows[0]?.rowsecurity) {
      throw new Error('service_health_events RLS is not enabled');
    }

    console.log('Service Health Events migration completed.');
  } catch (error) {
    console.error(
      'Service Health Events migration failed:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
