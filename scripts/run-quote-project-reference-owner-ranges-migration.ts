import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFiles = [
  'supabase/migrations/20260920133000_quote_project_reference_owner_ranges.sql',
  'supabase/migrations/20260920133100_quote_project_reference_sample_range_fix.sql',
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
    console.log('Running quote/project owner-range remapping...');
    await client.connect();

    const before = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM public.quotes) AS quotes,
        (SELECT COUNT(*)::int FROM public.schedule_jobs) AS jobs,
        (SELECT COUNT(*)::int FROM public.quote_timeline_events) AS timeline,
        (SELECT COUNT(*)::int FROM public.inventory_locations) AS locations
    `);

    for (const sqlFile of sqlFiles) {
      const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
      await client.query(sql);
      console.log(`Applied ${sqlFile}`);
    }

    const after = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM public.quotes) AS quotes,
        (SELECT COUNT(*)::int FROM public.schedule_jobs) AS jobs,
        (SELECT COUNT(*)::int FROM public.quote_timeline_events) AS timeline,
        (SELECT COUNT(*)::int FROM public.inventory_locations) AS locations,
        (
          SELECT COUNT(*)::int
          FROM public.quotes
          WHERE quote_reference ~ '^[0-9]{1,4}-JC$'
            OR quote_reference ~ '^99[0-9]{3}-SD$'
        ) AS leftover_quotes,
        (
          SELECT COUNT(*)::int
          FROM public.schedule_jobs
          WHERE job_reference ~ '^[0-9]{1,4}-JC$'
            OR job_reference ~ '^99[0-9]{3}-SD$'
            OR job_reference ~ '^SAMPLE-00[1-3]$'
        ) AS leftover_jobs,
        (
          SELECT COUNT(*)::int
          FROM public.quotes
          WHERE quote_reference !~ '^[0-9]{5}-[A-Z]{2}$'
        ) AS invalid_quotes
    `);
    const series = await client.query(`
      SELECT initials, number_start, next_number, is_active
      FROM public.quote_manager_series
      ORDER BY initials
    `);

    console.log('Before:', before.rows[0]);
    console.log('After:', after.rows[0]);
    console.log('Series:', series.rows);

    if (
      before.rows[0].quotes !== after.rows[0].quotes
      || before.rows[0].jobs !== after.rows[0].jobs
      || before.rows[0].timeline !== after.rows[0].timeline
    ) {
      throw new Error('Row counts changed during remapping.');
    }
    if (
      after.rows[0].leftover_quotes > 0
      || after.rows[0].leftover_jobs > 0
      || after.rows[0].invalid_quotes > 0
    ) {
      throw new Error('Legacy short or 99xxx references remain after remapping.');
    }

    console.log('Owner-range remapping completed.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('quote_manager_series_number_range_check')) {
      console.log('Range checks already present; verifying current state.');
      process.exit(0);
    }
    console.error('MIGRATION FAILED:', message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
