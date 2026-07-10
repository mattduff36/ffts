import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260604_toolbox_talk_priorities.sql';

if (!connectionString) {
  console.error('Missing database connection string');
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
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{
      acceptance_delay_exists: boolean;
      priority_constraint: string | null;
    }>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'messages'
            AND column_name = 'acceptance_delay_minutes'
        ) AS acceptance_delay_exists,
        (
          SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
          WHERE conrelid = 'public.messages'::regclass
            AND conname = 'messages_priority_check'
        ) AS priority_constraint
    `);

    const verification = rows[0];
    if (!verification?.acceptance_delay_exists || !verification.priority_constraint?.includes('URGENT')) {
      throw new Error('Toolbox talk priority migration verification failed');
    }

    console.log('Toolbox talk priority migration completed');
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
