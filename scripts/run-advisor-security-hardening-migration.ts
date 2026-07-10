import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260601_advisor_security_hardening.sql';

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const migrationSql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(migrationSql);

    const { rows } = await client.query<{
      rls_table_count: string;
      hardened_function_count: string;
      public_storage_select_policies: string;
      anon_archive_execute: boolean;
      authenticated_archive_execute: boolean;
    }>(`
      WITH advisor_tables AS (
        SELECT COUNT(*)::text AS rls_table_count
        FROM unnest(ARRAY[
          'public.van_inspection_daily_split_map',
          'public.van_inspection_daily_duplicate_archive',
          'public.inspection_orphan_children_archive'
        ]) AS target_table(table_name)
        JOIN pg_class c ON c.oid = to_regclass(target_table.table_name)
        WHERE c.relrowsecurity
      ),
      hardened_functions AS (
        SELECT COUNT(*)::text AS hardened_function_count
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY (ARRAY[
            'archive_closed_financial_year_absences',
            'update_workshop_attachment_field_responses_updated_at',
            'update_workshop_attachment_template_versions_updated_at',
            'update_work_calendar_entries_updated_at'
          ])
          AND EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
            WHERE setting = 'search_path=public, pg_temp'
          )
      ),
      storage_public_select AS (
        SELECT COUNT(*)::text AS public_storage_select_policies
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND cmd = 'SELECT'
          AND 'public' = ANY(roles)
          AND policyname IN (
            'Anyone can view inspection photos',
            'Public can view user avatars'
          )
      )
      SELECT
        advisor_tables.rls_table_count,
        hardened_functions.hardened_function_count,
        storage_public_select.public_storage_select_policies,
        has_function_privilege(
          'anon',
          'public.archive_closed_financial_year_absences(integer, uuid, text, text, boolean)',
          'EXECUTE'
        ) AS anon_archive_execute,
        has_function_privilege(
          'authenticated',
          'public.archive_closed_financial_year_absences(integer, uuid, text, text, boolean)',
          'EXECUTE'
        ) AS authenticated_archive_execute
      FROM advisor_tables, hardened_functions, storage_public_select;
    `);

    const result = rows[0];
    if (!result) {
      throw new Error('Verification failed: no verification row returned');
    }

    if (Number(result.rls_table_count) !== 3) {
      throw new Error(`Verification failed: expected 3 RLS-enabled advisor tables, found ${result.rls_table_count}`);
    }
    if (Number(result.hardened_function_count) !== 4) {
      throw new Error(`Verification failed: expected 4 hardened functions, found ${result.hardened_function_count}`);
    }
    if (Number(result.public_storage_select_policies) !== 0) {
      throw new Error('Verification failed: public storage SELECT policies still exist');
    }
    if (result.anon_archive_execute || !result.authenticated_archive_execute) {
      throw new Error('Verification failed: archive RPC execute grants are incorrect');
    }

    console.log('Advisor security hardening verification passed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
