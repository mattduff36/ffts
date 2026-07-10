import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260623_sync_quote_revision_sage_status.sql';

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
    console.log('Running quote revision Sage status sync migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const verification = await client.query<{ inconsistent_threads: string }>(`
      WITH original_sage AS (
        SELECT
          quote_thread_id,
          sage_posted_at,
          sage_posted_by
        FROM public.quotes
        WHERE quote_thread_id IS NOT NULL
          AND revision_number = 0
      )
      SELECT count(DISTINCT revision.quote_thread_id)::text AS inconsistent_threads
      FROM public.quotes AS revision
      INNER JOIN original_sage
        ON original_sage.quote_thread_id = revision.quote_thread_id
      WHERE revision.revision_number > 0
        AND (
          revision.sage_posted_at IS DISTINCT FROM original_sage.sage_posted_at
          OR revision.sage_posted_by IS DISTINCT FROM original_sage.sage_posted_by
        )
    `);

    const inconsistentThreads = Number(verification.rows[0]?.inconsistent_threads || 0);
    if (inconsistentThreads !== 0) {
      throw new Error(`Found ${inconsistentThreads} quote revision thread(s) with inconsistent Sage status`);
    }

    console.log('Migration complete');
    console.log('Quote revision Sage status sync: OK');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
