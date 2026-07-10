import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260601_van_draft_submission_reminders.sql';
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Van Draft Submission Reminders migration...');

  const url = new URL(connectionString!);
  const client = new pg.Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();

    const preflight = await client.query<{
      draft_count: string;
      pending_reminder_count: string;
      missing_reminder_count: string;
    }>(`
      WITH draft_candidates AS (
        SELECT
          vi.id,
          vi.user_id,
          CASE
            WHEN LOWER(COALESCE(vc.name, v.vehicle_type, 'Truck')) = 'van' THEN 15
            ELSE 26
          END AS expected_item_count,
          COUNT(DISTINCT ii.item_number) FILTER (
            WHERE ii.day_of_week = EXTRACT(ISODOW FROM vi.inspection_date)::int
              AND ii.status IN ('ok', 'attention', 'defect', 'na')
          ) AS completed_item_count
        FROM public.van_inspections vi
        JOIN public.vans v ON v.id = vi.van_id
        LEFT JOIN public.van_categories vc ON vc.id = v.category_id
        LEFT JOIN public.inspection_items ii ON ii.inspection_id = vi.id
        WHERE vi.status = 'draft'
          AND vi.van_id IS NOT NULL
          AND vi.submitted_at IS NULL
          AND vi.signed_at IS NULL
          AND vi.signature_data IS NULL
        GROUP BY vi.id, vi.user_id, vi.inspection_date, vc.name, v.vehicle_type
      ),
      pending_draft_reminders AS (
        SELECT dc.id
        FROM draft_candidates dc
        JOIN public.reminder_actions ra
          ON ra.workflow_key = 'van_draft_submission'
          AND ra.status = 'open'
          AND ra.dedupe_key = 'van_draft_submission:' || dc.id::text
        JOIN public.reminders r
          ON r.action_id = ra.id
          AND r.assigned_to = dc.user_id
          AND r.status = 'pending'
      )
      SELECT
        COUNT(*)::text AS draft_count,
        (SELECT COUNT(*)::text FROM pending_draft_reminders) AS pending_reminder_count,
        (
          SELECT COUNT(*)::text
          FROM draft_candidates dc
          WHERE NOT EXISTS (
            SELECT 1
            FROM pending_draft_reminders pdr
            WHERE pdr.id = dc.id
          )
        ) AS missing_reminder_count
      FROM draft_candidates;
    `);

    const before = preflight.rows[0];
    const beforePendingCount = Number(before?.pending_reminder_count || '0');
    console.log(`Eligible draft van inspections: ${before?.draft_count || '0'}`);
    console.log(`Existing pending draft submission reminders: ${before?.pending_reminder_count || '0'}`);
    console.log(`Drafts missing pending submission reminders: ${before?.missing_reminder_count || '0'}`);

    const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    await client.query(migrationSQL);

    const verification = await client.query<{
      draft_count: string;
      pending_reminder_count: string;
      missing_reminder_count: string;
      duplicate_open_action_count: string;
      duplicate_pending_reminder_count: string;
      submitted_inspection_action_count: string;
      submitted_open_pending_count: string;
      cta_mismatch_count: string;
      stale_open_action_count: string;
      stale_open_pending_count: string;
    }>(`
      WITH draft_candidates AS (
        SELECT
          vi.id,
          vi.user_id
        FROM public.van_inspections vi
        JOIN public.vans v ON v.id = vi.van_id
        WHERE vi.status = 'draft'
          AND vi.van_id IS NOT NULL
          AND vi.submitted_at IS NULL
          AND vi.signed_at IS NULL
          AND vi.signature_data IS NULL
      ),
      pending_draft_reminders AS (
        SELECT
          dc.id AS draft_id,
          ra.id AS action_id,
          r.id AS reminder_id,
          ra.metadata
        FROM draft_candidates dc
        JOIN public.reminder_actions ra
          ON ra.workflow_key = 'van_draft_submission'
          AND ra.status = 'open'
          AND ra.dedupe_key = 'van_draft_submission:' || dc.id::text
        JOIN public.reminders r
          ON r.action_id = ra.id
          AND r.assigned_to = dc.user_id
          AND r.status = 'pending'
      )
      SELECT
        (SELECT COUNT(*)::text FROM draft_candidates) AS draft_count,
        (
          SELECT COUNT(*)::text
          FROM pending_draft_reminders
        ) AS pending_reminder_count,
        (
          SELECT COUNT(*)::text
          FROM draft_candidates dc
          WHERE NOT EXISTS (
            SELECT 1
            FROM pending_draft_reminders pdr
            WHERE pdr.draft_id = dc.id
          )
        ) AS missing_reminder_count,
        (
          SELECT COUNT(*)::text
          FROM (
            SELECT dedupe_key
            FROM public.reminder_actions
            WHERE workflow_key = 'van_draft_submission'
              AND status = 'open'
            GROUP BY dedupe_key
            HAVING COUNT(*) > 1
          ) duplicates
        ) AS duplicate_open_action_count,
        (
          SELECT COUNT(*)::text
          FROM (
            SELECT draft_id
            FROM pending_draft_reminders
            GROUP BY draft_id
            HAVING COUNT(*) > 1
          ) duplicates
        ) AS duplicate_pending_reminder_count,
        (
          SELECT COUNT(*)::text
          FROM public.reminder_actions ra
          JOIN public.van_inspections vi
            ON ra.dedupe_key = 'van_draft_submission:' || vi.id::text
          WHERE ra.workflow_key = 'van_draft_submission'
            AND ra.status = 'open'
            AND vi.status <> 'draft'
        ) AS submitted_inspection_action_count,
        (
          SELECT COUNT(*)::text
          FROM public.reminder_actions ra
          JOIN public.van_inspections vi
            ON ra.dedupe_key = 'van_draft_submission:' || vi.id::text
          JOIN public.reminders r ON r.action_id = ra.id
          WHERE ra.workflow_key = 'van_draft_submission'
            AND ra.status = 'open'
            AND r.status = 'pending'
            AND vi.status <> 'draft'
        ) AS submitted_open_pending_count,
        (
          SELECT COUNT(*)::text
          FROM pending_draft_reminders pdr
          WHERE pdr.metadata->>'draft_inspection_id' IS DISTINCT FROM pdr.draft_id::text
             OR pdr.metadata->>'draft_href' IS DISTINCT FROM '/van-inspections/new?id=' || pdr.draft_id::text
        ) AS cta_mismatch_count,
        (
          SELECT COUNT(*)::text
          FROM public.reminder_actions ra
          LEFT JOIN public.van_inspections vi
            ON vi.id::text = ra.metadata->>'draft_inspection_id'
          WHERE ra.workflow_key = 'van_draft_submission'
            AND ra.status = 'open'
            AND (
              vi.id IS NULL
              OR vi.status <> 'draft'
              OR vi.submitted_at IS NOT NULL
              OR vi.signed_at IS NOT NULL
              OR vi.signature_data IS NOT NULL
            )
        ) AS stale_open_action_count,
        (
          SELECT COUNT(*)::text
          FROM public.reminder_actions ra
          JOIN public.reminders r
            ON r.action_id = ra.id
            AND r.status = 'pending'
          LEFT JOIN public.van_inspections vi
            ON vi.id::text = ra.metadata->>'draft_inspection_id'
          WHERE ra.workflow_key = 'van_draft_submission'
            AND ra.status = 'open'
            AND (
              vi.id IS NULL
              OR vi.status <> 'draft'
              OR vi.submitted_at IS NOT NULL
              OR vi.signed_at IS NOT NULL
              OR vi.signature_data IS NOT NULL
            )
        ) AS stale_open_pending_count;
    `);

    const result = verification.rows[0];
    const createdCount = Number(result.pending_reminder_count) - beforePendingCount;
    console.log(`New pending draft submission reminders created: ${createdCount}`);
    console.log(`Eligible draft van inspections after migration: ${result.draft_count}`);
    console.log(`Pending draft submission reminders: ${result.pending_reminder_count}`);
    console.log(`Drafts missing pending submission reminders: ${result.missing_reminder_count}`);
    console.log(`Duplicate open draft actions: ${result.duplicate_open_action_count}`);
    console.log(`Duplicate pending draft reminders: ${result.duplicate_pending_reminder_count}`);
    console.log(`Submitted-inspection draft actions: ${result.submitted_inspection_action_count}`);
    console.log(`Submitted-inspection pending draft reminders: ${result.submitted_open_pending_count}`);
    console.log(`Draft reminder CTA mismatches: ${result.cta_mismatch_count}`);
    console.log(`Stale open draft actions: ${result.stale_open_action_count}`);
    console.log(`Stale open pending draft reminders: ${result.stale_open_pending_count}`);

    if (
      Number(result.missing_reminder_count) > 0 ||
      Number(result.duplicate_open_action_count) > 0 ||
      Number(result.duplicate_pending_reminder_count) > 0 ||
      Number(result.submitted_inspection_action_count) > 0 ||
      Number(result.submitted_open_pending_count) > 0 ||
      Number(result.cta_mismatch_count) > 0 ||
      Number(result.stale_open_action_count) > 0 ||
      Number(result.stale_open_pending_count) > 0
    ) {
      throw new Error('Van draft submission reminder migration verification failed.');
    }

    console.log('Van Draft Submission Reminders migration completed.');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
