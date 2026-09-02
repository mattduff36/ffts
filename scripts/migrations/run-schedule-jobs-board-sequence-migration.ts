import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260902130000_schedule_jobs_board_sequence.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function runScheduleJobsBoardSequenceMigration() {
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
    console.log('Running schedule jobs board_sequence migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf8'));

    const { rows } = await client.query<{
      column_name: string | null;
      is_nullable: string | null;
      attidentity: string | null;
      index_name: string | null;
      trigger_name: string | null;
      null_count: string | null;
      duplicate_count: string | null;
      max_sequence: string | null;
      last_value: string | null;
    }>(`
      SELECT
        cols.column_name,
        cols.is_nullable,
        attrs.attidentity,
        idx.indexname AS index_name,
        tg.tgname AS trigger_name,
        (
          SELECT COUNT(*)::text
          FROM public.schedule_jobs
          WHERE board_sequence IS NULL
        ) AS null_count,
        (
          SELECT COUNT(*)::text
          FROM (
            SELECT board_sequence
            FROM public.schedule_jobs
            GROUP BY board_sequence
            HAVING COUNT(*) > 1
          ) duplicates
        ) AS duplicate_count,
        (SELECT MAX(board_sequence)::text FROM public.schedule_jobs) AS max_sequence,
        (SELECT last_value::text FROM public.schedule_jobs_board_sequence_seq) AS last_value
      FROM information_schema.columns AS cols
      JOIN pg_attribute AS attrs
        ON attrs.attrelid = 'public.schedule_jobs'::regclass
        AND attrs.attname = cols.column_name
      LEFT JOIN pg_indexes AS idx
        ON idx.schemaname = 'public'
        AND idx.tablename = 'schedule_jobs'
        AND idx.indexname = 'schedule_jobs_board_sequence_uidx'
      LEFT JOIN pg_trigger AS tg
        ON tg.tgrelid = 'public.schedule_jobs'::regclass
        AND tg.tgname = 'protect_schedule_job_board_sequence'
        AND NOT tg.tgisinternal
      WHERE cols.table_schema = 'public'
        AND cols.table_name = 'schedule_jobs'
        AND cols.column_name = 'board_sequence'
    `);

    const verification = rows[0];
    const maxSequence = Number(verification?.max_sequence || 0);
    const lastValue = Number(verification?.last_value || 0);
    if (
      verification?.column_name !== 'board_sequence'
      || verification.is_nullable !== 'NO'
      || verification.attidentity !== 'a'
      || verification.index_name !== 'schedule_jobs_board_sequence_uidx'
      || verification.trigger_name !== 'protect_schedule_job_board_sequence'
      || verification.null_count !== '0'
      || verification.duplicate_count !== '0'
      || lastValue < maxSequence
    ) {
      throw new Error('Schedule jobs board_sequence migration verification failed.');
    }

    console.log('Migration complete.');
    console.log('Verified column: board_sequence');
  } catch (error) {
    const normalizedError = error as { message?: string };
    console.error(
      'Schedule jobs board_sequence migration failed:',
      normalizedError.message || error
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runScheduleJobsBoardSequenceMigration().catch((error) => {
  console.error('Unexpected migration runner failure:', error);
  process.exit(1);
});
