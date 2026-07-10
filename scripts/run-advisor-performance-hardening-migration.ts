import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260601_advisor_performance_hardening.sql';

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
      targeted_policy_count: string;
      targeted_index_count: string;
    }>(`
      WITH targeted_policies AS (
        SELECT COUNT(*)::text AS targeted_policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
          AND roles = ARRAY['authenticated']::name[]
          AND (
            (tablename = 'timesheets' AND policyname IN ('Users can view own timesheets','Users can create own timesheets','Users can update own timesheets'))
            OR (tablename = 'timesheet_entries' AND policyname IN ('Users can view own timesheet entries','Users can insert own timesheet entries','Users can update own timesheet entries','Users can delete own timesheet entries'))
            OR (tablename = 'workshop_attachment_template_versions' AND policyname IN ('Managers and admins can create template versions','Managers and admins can update template versions','Managers and admins can delete template versions'))
            OR (tablename = 'workshop_attachment_template_sections' AND policyname = 'Managers and admins can manage template sections')
            OR (tablename = 'workshop_attachment_template_fields' AND policyname = 'Managers and admins can manage template fields')
            OR (tablename = 'workshop_attachment_schema_snapshots' AND policyname IN ('Workshop users can read schema snapshots','Workshop users can create schema snapshots'))
            OR (tablename = 'workshop_attachment_field_responses' AND policyname IN ('Workshop users can read field responses v2','Workshop users can create field responses v2','Workshop users can update field responses v2'))
            OR (tablename = 'user_module_permissions' AND policyname IN ('Users can view own user module permissions','Only admins insert user module permissions','Only admins update user module permissions','Only admins delete user module permissions'))
          )
      ),
      targeted_indexes AS (
        SELECT COUNT(*)::text AS targeted_index_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY (ARRAY[
            'idx_absence_fy_archives_archived_by',
            'idx_absences_archive_approved_by',
            'idx_absences_archive_archived_by',
            'idx_absences_archive_created_by',
            'idx_absences_archive_processed_by',
            'idx_absences_archive_archive_run_id',
            'idx_inventory_item_movement_batches_destination_location_id',
            'idx_inventory_item_movement_batches_moved_by',
            'idx_inventory_item_movements_from_location_id',
            'idx_inventory_item_movements_moved_by',
            'idx_inventory_items_category',
            'idx_inventory_items_created_by',
            'idx_inventory_items_updated_by',
            'idx_inventory_location_requests_resolved_by',
            'idx_inventory_location_requests_resolved_location_id',
            'idx_inventory_locations_created_by',
            'idx_inventory_locations_updated_by',
            'idx_inventory_minor_plant_details_created_by',
            'idx_inventory_minor_plant_details_updated_by',
            'idx_quote_attachments_uploaded_by',
            'idx_quote_invoice_allocations_quote_line_item_id',
            'idx_quote_invoice_requests_fulfilled_by',
            'idx_quote_invoice_requests_requested_by',
            'idx_quote_invoices_created_by',
            'idx_quote_timeline_events_actor_user_id',
            'idx_quotes_approved_by',
            'idx_quotes_created_by',
            'idx_quotes_customer_sent_by',
            'idx_quotes_duplicate_source_quote_id',
            'idx_quotes_updated_by',
            'idx_reminder_actions_created_by',
            'idx_reminder_actions_ignored_by',
            'idx_reminder_actions_resolved_by',
            'idx_reminders_actioned_by',
            'idx_reminders_assigned_by',
            'idx_user_usage_daily_rollups_role_id',
            'idx_user_usage_daily_rollups_team_id',
            'idx_user_usage_events_app_session_id',
            'idx_user_usage_events_error_log_id'
          ])
      )
      SELECT targeted_policy_count, targeted_index_count
      FROM targeted_policies, targeted_indexes;
    `);

    const result = rows[0];
    if (!result) {
      throw new Error('Verification failed: no verification row returned');
    }
    if (Number(result.targeted_policy_count) !== 21) {
      throw new Error(`Verification failed: expected 21 targeted policies, found ${result.targeted_policy_count}`);
    }
    if (Number(result.targeted_index_count) !== 39) {
      throw new Error(`Verification failed: expected 39 targeted indexes, found ${result.targeted_index_count}`);
    }

    console.log('Advisor performance hardening verification passed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
