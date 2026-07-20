import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const allowedProjectRef = process.env.SCHEDULING_SAMPLE_PRODUCTION_PROJECT_REF;
const sqlFile = 'supabase/migrations/20260720_quote_scheduling_visits.sql';

if (!connectionString || !allowedProjectRef || !connectionString.includes(allowedProjectRef)) {
  console.error('Missing or mismatched scheduling production migration target.');
  console.error(
    'Set POSTGRES_URL_NON_POOLING and SCHEDULING_SAMPLE_PRODUCTION_PROJECT_REF to the approved project.'
  );
  process.exit(1);
}

async function runQuoteSchedulingVisitsMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running quote scheduling visits migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf8'));

    const { rows } = await client.query<{
      visits_table: string | null;
      quotes_minutes: string | null;
      jobs_minutes: string | null;
      quote_sync_trigger: string | null;
    }>(`
      SELECT
        to_regclass('public.schedule_visits')::text AS visits_table,
        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'quotes'
            AND column_name = 'estimated_duration_minutes'
        ) AS quotes_minutes,
        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'schedule_jobs'
            AND column_name = 'estimated_duration_minutes'
        ) AS jobs_minutes,
        (
          SELECT trigger_name
          FROM information_schema.triggers
          WHERE event_object_schema = 'public'
            AND event_object_table = 'quotes'
            AND trigger_name = 'sync_operational_quote_schedule_job_trigger'
          LIMIT 1
        ) AS quote_sync_trigger
    `);

    const verification = rows[0];
    if (
      verification?.visits_table !== 'schedule_visits'
      || verification.quotes_minutes !== 'estimated_duration_minutes'
      || verification.jobs_minutes !== 'estimated_duration_minutes'
      || verification.quote_sync_trigger !== 'sync_operational_quote_schedule_job_trigger'
    ) {
      throw new Error('Quote scheduling visits migration verification failed.');
    }

    console.log('Migration complete.');
    console.log('Verified timed visits, duration columns, and Quote synchronization trigger.');
  } catch (error) {
    const normalizedError = error as { message?: string };
    console.error('Quote scheduling visits migration failed:', normalizedError.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runQuoteSchedulingVisitsMigration();
