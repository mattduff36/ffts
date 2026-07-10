import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260527_user_module_permission_levels.sql';

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
    console.log('Running user module permission levels migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT
        to_regclass('public.user_module_permissions') IS NOT NULL AS table_ready,
        to_regprocedure('public.effective_module_access_level(text)') IS NOT NULL AS level_helper_ready,
        to_regprocedure('public.get_user_permission_levels(uuid)') IS NOT NULL AS levels_snapshot_ready,
        COUNT(*) FILTER (WHERE access_level = 5) AS level_five_rows,
        COUNT(*) AS permission_rows
      FROM public.user_module_permissions
    `);

    const result = rows[0];
    if (
      !result?.table_ready ||
      !result?.level_helper_ready ||
      !result?.levels_snapshot_ready ||
      Number(result.permission_rows || 0) === 0
    ) {
      throw new Error('User module permission levels migration verification failed.');
    }

    console.log(
      `User module permission levels migration complete (${result.permission_rows} rows, ${result.level_five_rows} locked admin rows).`
    );
  } finally {
    await client.end();
  }
}

runMigration(connectionString).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
