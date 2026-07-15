import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260715_scheduling_module.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function runSchedulingModuleMigration() {
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
    console.log('Running scheduling module migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf8'));

    const { rows } = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'schedule_jobs',
          'schedule_employee_assignments',
          'schedule_plant_assignments',
          'schedule_plant_unavailability'
        )
      ORDER BY table_name
    `);

    console.log('Migration complete.');
    console.log('Verified tables:', rows.map((row) => row.table_name).join(', '));
  } catch (error) {
    const normalizedError = error as { message?: string };
    console.error('Scheduling module migration failed:', normalizedError.message || error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSchedulingModuleMigration().catch((error) => {
  console.error('Unexpected migration runner failure:', error);
  process.exit(1);
});
