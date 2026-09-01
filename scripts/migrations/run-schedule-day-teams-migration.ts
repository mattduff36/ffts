import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260901170000_schedule_day_teams.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function runScheduleDayTeamsMigration() {
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
    console.log('Running schedule day teams migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf8'));

    const { rows } = await client.query<{
      table_name: string | null;
      add_fn: string | null;
      remove_fn: string | null;
    }>(`
      SELECT
        to_regclass('public.schedule_day_team_members')::text AS table_name,
        to_regprocedure('public.add_schedule_day_team_member_v1(date, smallint, uuid, uuid)')::text AS add_fn,
        to_regprocedure('public.remove_schedule_day_team_member_v1(date, smallint, uuid, uuid)')::text AS remove_fn
    `);

    const verification = rows[0];
    if (
      verification?.table_name !== 'schedule_day_team_members'
      || !verification.add_fn
      || !verification.remove_fn
    ) {
      throw new Error('Schedule day teams migration verification failed.');
    }

    console.log('Migration complete.');
    console.log('Verified table:', verification.table_name);
  } catch (error) {
    const normalizedError = error as { message?: string };
    console.error('Schedule day teams migration failed:', normalizedError.message || error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runScheduleDayTeamsMigration().catch((error) => {
  console.error('Unexpected migration runner failure:', error);
  process.exit(1);
});
