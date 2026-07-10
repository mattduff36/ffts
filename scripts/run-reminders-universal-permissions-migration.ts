import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260604_reminders_universal_permissions.sql';

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
    console.log('Running reminders universal permissions migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);

    const { rows } = await client.query<{
      level_helper_ready: boolean;
      has_helper_ready: boolean;
      permission_levels_ready: boolean;
      reminders_level_for_profile: number | null;
      level_definition: string;
      effective_definition: string;
    }>(`
      WITH sample_profile AS (
        SELECT p.id, p.role_id, p.team_id
        FROM public.profiles p
        WHERE COALESCE(p.full_name, '') NOT ILIKE '%(Deleted User)%'
        ORDER BY p.full_name NULLS LAST, p.id
        LIMIT 1
      )
      SELECT
        to_regprocedure('public.user_module_access_level(uuid,uuid,text,text)') IS NOT NULL AS level_helper_ready,
        to_regprocedure('public.effective_has_module_permission(text)') IS NOT NULL AS has_helper_ready,
        to_regprocedure('public.get_user_permission_levels(uuid)') IS NOT NULL AS permission_levels_ready,
        (
          SELECT public.user_module_access_level(id, role_id, team_id, 'reminders')
          FROM sample_profile
        ) AS reminders_level_for_profile,
        pg_get_functiondef('public.user_module_access_level(uuid,uuid,text,text)'::regprocedure) AS level_definition,
        pg_get_functiondef('public.effective_module_access_level(text)'::regprocedure) AS effective_definition
    `);

    const result = rows[0];
    if (
      !result?.level_helper_ready ||
      !result.has_helper_ready ||
      !result.permission_levels_ready ||
      result.reminders_level_for_profile !== 5 ||
      !result.level_definition.includes("target_module = 'reminders'") ||
      !result.effective_definition.includes("module = 'reminders'")
    ) {
      throw new Error('Reminders universal permissions migration verification failed.');
    }

    console.log('Reminders universal permissions migration complete.');
  } finally {
    await client.end();
  }
}

runMigration(connectionString).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
