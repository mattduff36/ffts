import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260904120000_schedule_team_settings.sql';

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
    console.log('Running schedule team settings migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const settings = await client.query(`
      SELECT visible_slot_count
      FROM public.schedule_team_settings
      WHERE id = TRUE
    `);
    if (settings.rowCount !== 1) {
      throw new Error('schedule_team_settings singleton was not created');
    }

    const check = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'schedule_day_team_members_slot_check'
    `);
    const definition = String(check.rows[0]?.definition || '');
    if (!definition.includes('1') || !definition.includes('10')) {
      throw new Error('slot check was not widened to 1-10');
    }

    console.log('Migration complete');
    console.log(`visible_slot_count=${settings.rows[0].visible_slot_count}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('already exists')) {
      console.log('Already applied');
      process.exit(0);
    }
    console.error('Migration failed:', message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
