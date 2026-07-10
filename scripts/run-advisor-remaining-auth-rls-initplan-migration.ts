import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260407_optimize_remaining_auth_rls_initplan_policies.sql';

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

    const { rows: anchorRows } = await client.query<{ anchor_count: string }>(`
      SELECT COUNT(*)::text AS anchor_count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname = ANY (ARRAY[
          'Users can view own account switch settings',
          'Super admins can view all error notification preferences',
          'Managers can update document types',
          'Managers can view all assignments',
          'Users can view own timesheet entries',
          'Users can view own timesheets',
          'Users can view own page visits',
          'Users can view own absence carryovers',
          'Users can view own error reports',
          'Managers can read org teams',
          'Managers and admins can manage template sections'
        ]);
    `);

    const anchorCount = Number(anchorRows[0]?.anchor_count || '0');
    if (anchorCount !== 11) {
      throw new Error(`Verification failed: expected 11 anchor policies, found ${anchorCount}`);
    }

    const { rows: patternRows } = await client.query<{
      direct_auth_uid: string;
      direct_mgr_helper: string;
      direct_super_admin_helper: string;
      direct_supervisor_helper: string;
      direct_workshop_helper: string;
      direct_module_helper: string;
      direct_role_helper: string;
      direct_actor_admin_helper: string;
    }>(`
      WITH target_policies AS (
        SELECT lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) AS expr
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY (ARRAY[
            'absence_module_settings',
            'admin_error_notification_prefs',
            'inspection_photos',
            'message_recipients',
            'notification_preferences',
            'project_document_types',
            'project_favourites',
            'rams_assignments',
            'timesheet_entries',
            'timesheets',
            'user_page_visits',
            'workshop_attachment_template_versions',
            'workshop_task_comments',
            'absence_allowance_carryovers',
            'absence_secondary_permission_exceptions',
            'absences_archive',
            'error_report_updates',
            'error_reports',
            'hgv_categories',
            'hgvs',
            'org_hierarchy_change_log',
            'org_team_feature_modes',
            'org_teams',
            'permission_modules',
            'profile_reporting_lines',
            'profile_team_memberships',
            'team_module_permissions',
            'timesheet_type_exceptions',
            'vans',
            'workshop_attachment_schema_snapshots',
            'workshop_attachment_template_fields',
            'workshop_attachment_template_sections'
          ])
      )
      SELECT
        COUNT(*) FILTER (
          WHERE expr ~ 'auth\\.uid\\(\\)'
            AND expr !~ '\\(\\s*select\\s+auth\\.uid\\(\\)'
        )::text AS direct_auth_uid,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_is_manager_admin\\(\\)'
            AND expr !~ '\\(\\s*select\\s+effective_is_manager_admin\\(\\)'
        )::text AS direct_mgr_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_is_super_admin\\(\\)'
            AND expr !~ '\\(\\s*select\\s+effective_is_super_admin\\(\\)'
        )::text AS direct_super_admin_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_is_supervisor\\(\\)'
            AND expr !~ '\\(\\s*select\\s+effective_is_supervisor\\(\\)'
        )::text AS direct_supervisor_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_is_workshop_team\\(\\)'
            AND expr !~ '\\(\\s*select\\s+effective_is_workshop_team\\(\\)'
        )::text AS direct_workshop_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_has_module_permission\\('
            AND expr !~ '\\(\\s*select\\s+effective_has_module_permission\\('
        )::text AS direct_module_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_has_role_name\\('
            AND expr !~ '\\(\\s*select\\s+effective_has_role_name\\('
        )::text AS direct_role_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'is_actor_admin\\('
            AND expr !~ '\\(\\s*select\\s+is_actor_admin\\('
        )::text AS direct_actor_admin_helper
      FROM target_policies;
    `);

    const patternRow = patternRows[0];
    const remainingDirectCalls = [
      Number(patternRow?.direct_auth_uid || '0'),
      Number(patternRow?.direct_mgr_helper || '0'),
      Number(patternRow?.direct_super_admin_helper || '0'),
      Number(patternRow?.direct_supervisor_helper || '0'),
      Number(patternRow?.direct_workshop_helper || '0'),
      Number(patternRow?.direct_module_helper || '0'),
      Number(patternRow?.direct_role_helper || '0'),
      Number(patternRow?.direct_actor_admin_helper || '0'),
    ].reduce((sum, value) => sum + value, 0);

    if (remainingDirectCalls !== 0) {
      throw new Error(
        `Verification failed: found ${remainingDirectCalls} remaining direct auth/helper patterns in remaining initplan policies`
      );
    }

    console.log('Remaining RLS initplan policy anchors verified.');
    console.log('Direct auth/helper patterns remaining in target tables: 0');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
