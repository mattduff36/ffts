import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260614_timesheet_user_choice_override.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL in .env.local');
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString as string);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration() {
  const client = createClient();

  try {
    console.log('Running timesheet user choice override migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const result = await client.query<{ constraint_definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'public.timesheet_type_exceptions'::regclass
        AND conname = 'timesheet_type_exceptions_timesheet_type_check'
      LIMIT 1
    `);

    const definition = result.rows[0]?.constraint_definition || '';
    if (!definition.includes('user_choice')) {
      throw new Error('Verification failed: user_choice is not allowed by the timesheet type exception check constraint');
    }

    console.log('Migration complete');
    console.log(`Verified constraint: ${definition}`);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
