import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFiles = [
  'supabase/migrations/20260910120000_required_staff_and_quote_create.sql',
  'supabase/migrations/20260910123000_quote_create_atomic_and_staff_tx.sql',
];

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
    console.log('Running required staff and quote create migrations...');
    await client.connect();

    for (const sqlFile of sqlFiles) {
      try {
        const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
        await client.query(sql);
        console.log(`Applied ${sqlFile}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('already exists')) {
          console.log(`Already present: ${sqlFile}`);
          continue;
        }
        throw error;
      }
    }

    const columns = await client.query(`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'quotes'
            AND column_name = 'required_staff_count'
        ) AS quotes_col,
        (
          SELECT COUNT(*)::int
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'schedule_jobs'
            AND column_name = 'required_staff_count'
        ) AS jobs_col,
        (
          SELECT COUNT(*)::int
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'quote_create_requests'
            AND column_name = 'reserved_quote_id'
        ) AS reserved_col,
        (
          SELECT COUNT(*)::int
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN (
              'quote_create_request_claim_v1',
              'quote_create_request_complete_v1',
              'set_schedule_job_required_staff_v1',
              'quick_add_schedule_project_with_staff_v1'
            )
        ) AS rpc_count
    `);
    const row = columns.rows[0];
    if (!row?.quotes_col || !row?.jobs_col || !row?.reserved_col || Number(row.rpc_count) < 4) {
      throw new Error('required staff columns or atomic quote-create RPCs were not created');
    }

    console.log('Migration complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Migration failed:', message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
