import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260604_training_module.sql';

if (!connectionString) {
  console.error('Missing database connection string');
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
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{
      training_tables: string;
      permission_module_exists: boolean;
      training_minimum_role_name: string | null;
      training_minimum_role_rank: number | null;
      team_permission_rows: string;
      user_permission_rows: string;
    }>(`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'training_import_batches',
              'training_people',
              'training_qualifications',
              'training_records',
              'training_workbook_notes'
            )
        ) AS training_tables,
        EXISTS (
          SELECT 1
          FROM public.permission_modules
          WHERE module_name = 'training'
        ) AS permission_module_exists,
        (
          SELECT roles.name
          FROM public.permission_modules
          JOIN public.roles ON roles.id = permission_modules.minimum_role_id
          WHERE permission_modules.module_name = 'training'
        ) AS training_minimum_role_name,
        (
          SELECT roles.hierarchy_rank
          FROM public.permission_modules
          JOIN public.roles ON roles.id = permission_modules.minimum_role_id
          WHERE permission_modules.module_name = 'training'
        ) AS training_minimum_role_rank,
        (
          SELECT COUNT(*)::text
          FROM public.team_module_permissions
          WHERE module_name = 'training'
        ) AS team_permission_rows,
        (
          SELECT COUNT(*)::text
          FROM public.user_module_permissions
          WHERE module_name = 'training'
        ) AS user_permission_rows
    `);

    const verification = rows[0];
    if (
      verification?.training_tables !== '5' ||
      verification.permission_module_exists !== true ||
      verification.training_minimum_role_name !== 'manager' ||
      verification.training_minimum_role_rank !== 4 ||
      verification.team_permission_rows === '0' ||
      verification.user_permission_rows === '0'
    ) {
      throw new Error('Training module migration verification failed');
    }

    console.log('Training module migration completed');
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
