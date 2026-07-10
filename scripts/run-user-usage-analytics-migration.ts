import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260528_user_usage_analytics.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Running user usage analytics migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const [tablesResult, functionsResult] = await Promise.all([
      client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'user_usage_sessions',
            'user_usage_events',
            'user_usage_daily_rollups',
            'user_usage_retention_runs'
          )
        ORDER BY table_name
      `),
      client.query(`
        SELECT proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND proname IN (
            'refresh_user_usage_daily_rollups',
            'run_user_usage_retention'
          )
        ORDER BY proname
      `),
    ]);

    const tableNames = tablesResult.rows.map((row: { table_name: string }) => row.table_name);
    const functionNames = functionsResult.rows.map((row: { proname: string }) => row.proname);

    console.log('Migration complete');
    console.log(`analytics tables: ${tableNames.length === 4 ? 'OK' : `MISSING (${tableNames.join(', ')})`}`);
    console.log(`retention functions: ${functionNames.length === 2 ? 'OK' : `MISSING (${functionNames.join(', ')})`}`);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
