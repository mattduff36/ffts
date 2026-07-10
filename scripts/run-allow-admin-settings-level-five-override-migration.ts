import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260528_allow_admin_settings_level_five_override.sql';

if (!connectionString) {
  console.error('Missing database connection string. Set POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local.');
  process.exit(1);
}

async function runMigration(conn: string) {
  const url = new URL(conn);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running allow admin settings Level 5 override migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT
        public.module_enforced_minimum_access_level('admin-settings') AS settings_min,
        public.module_requires_full_access_role('admin-settings') AS settings_full_only
    `);

    const result = rows[0];
    if (Number(result?.settings_min || 0) !== 4 || result?.settings_full_only !== false) {
      throw new Error('Admin Settings access verification failed.');
    }

    console.log('Allow admin settings Level 5 override migration complete.');
  } finally {
    await client.end();
  }
}

runMigration(connectionString).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
