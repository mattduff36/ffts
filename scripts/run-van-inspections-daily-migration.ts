import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260601_van_inspections_daily_split.sql';
const TARGET_ACTION_ID = '1579a56c-2baa-4168-a59e-3e921a78588c';
const TARGET_OLD_INSPECTION_ID = 'e26747ef-1ef0-4fef-a6f9-4e6810f9d058';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Error: POSTGRES_URL_NON_POOLING or POSTGRES_URL not found in .env.local');
  process.exit(1);
}

const resolvedConnectionString = connectionString;

async function runMigration() {
  console.log('Running Van Inspections Daily Split Migration\n');

  const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
  const url = new URL(resolvedConnectionString);

  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected\n');

    const preflight = await client.query<{
      weekly_count: string;
      active_day_count: string;
      item_count: string;
      duplicate_target_count: string;
    }>(`
      WITH weekly AS (
        SELECT id, van_id, user_id, inspection_date
        FROM public.van_inspections
        WHERE inspection_end_date IS NOT NULL
          AND inspection_end_date::date <> inspection_date::date
      ),
      targets AS (
        SELECT w.id, w.van_id, w.user_id, (w.inspection_date::date + (ii.day_of_week - 1))::date AS target_date
        FROM weekly w
        JOIN public.inspection_items ii ON ii.inspection_id = w.id
        WHERE ii.day_of_week BETWEEN 1 AND 7
        GROUP BY w.id, w.van_id, w.user_id, target_date
      ),
      existing_daily AS (
        SELECT id, van_id, user_id, inspection_date::date AS target_date
        FROM public.van_inspections
        WHERE van_id IS NOT NULL
          AND (inspection_end_date IS NULL OR inspection_end_date::date = inspection_date::date)
      ),
      combined AS (
        SELECT van_id, user_id, target_date, id FROM targets
        UNION ALL
        SELECT van_id, user_id, target_date, id FROM existing_daily
      )
      SELECT
        (SELECT COUNT(*) FROM weekly)::text AS weekly_count,
        (SELECT COUNT(*) FROM targets)::text AS active_day_count,
        (SELECT COUNT(*) FROM public.inspection_items ii JOIN weekly w ON w.id = ii.inspection_id)::text AS item_count,
        (
          SELECT COUNT(*)
          FROM (
            SELECT van_id, user_id, target_date
            FROM combined
            GROUP BY van_id, user_id, target_date
            HAVING COUNT(*) > 1
          ) duplicates
        )::text AS duplicate_target_count;
    `);

    const preflightRow = preflight.rows[0];
    console.log(`Weekly van inspections to split: ${preflightRow.weekly_count}`);
    console.log(`Target daily rows from active days: ${preflightRow.active_day_count}`);
    console.log(`Inspection items in weekly rows: ${preflightRow.item_count}`);
    console.log(`Duplicate target groups to archive: ${preflightRow.duplicate_target_count}\n`);

    console.log('Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('Migration executed successfully\n');

    const verification = await client.query<{
      remaining_weekly_count: string;
      orphaned_item_count: string;
      orphaned_photo_count: string;
      duplicate_daily_group_count: string;
      mapped_item_count: string;
      mapped_day_count: string;
      duplicate_archive_count: string;
      target_action_ok: boolean;
    }>(`
      WITH mapped_action AS (
        SELECT EXISTS (
          SELECT 1
          FROM public.actions a
          JOIN public.van_inspection_daily_split_map m
            ON m.new_inspection_id = a.inspection_id
          WHERE a.id = $1::uuid
            AND m.old_inspection_id = $2::uuid
            AND m.original_day_of_week = 2
            AND (a.inspection_item_id IS NULL OR m.new_item_id = a.inspection_item_id)
        ) OR NOT EXISTS (
          SELECT 1 FROM public.actions WHERE id = $1::uuid
        ) AS ok
      )
      SELECT
        (
          SELECT COUNT(*)
          FROM public.van_inspections
          WHERE inspection_end_date IS NOT NULL
            AND inspection_end_date::date <> inspection_date::date
        )::text AS remaining_weekly_count,
        (
          SELECT COUNT(*)
          FROM public.inspection_items ii
          LEFT JOIN public.van_inspections vi ON vi.id = ii.inspection_id
          LEFT JOIN public.plant_inspections pi ON pi.id = ii.inspection_id
          LEFT JOIN public.hgv_inspections hi ON hi.id = ii.inspection_id
          WHERE vi.id IS NULL AND pi.id IS NULL AND hi.id IS NULL
        )::text AS orphaned_item_count,
        (
          SELECT COUNT(*)
          FROM public.inspection_photos ip
          LEFT JOIN public.van_inspections vi ON vi.id = ip.inspection_id
          LEFT JOIN public.plant_inspections pi ON pi.id = ip.inspection_id
          LEFT JOIN public.hgv_inspections hi ON hi.id = ip.inspection_id
          WHERE vi.id IS NULL AND pi.id IS NULL AND hi.id IS NULL
        )::text AS orphaned_photo_count,
        (
          SELECT COUNT(*)
          FROM (
            SELECT van_id, user_id, inspection_date
            FROM public.van_inspections
            WHERE van_id IS NOT NULL
            GROUP BY van_id, user_id, inspection_date
            HAVING COUNT(*) > 1
          ) duplicates
        )::text AS duplicate_daily_group_count,
        (SELECT COUNT(*) FROM public.van_inspection_daily_split_map)::text AS mapped_item_count,
        (
          SELECT COALESCE(to_regclass('public.van_inspection_daily_duplicate_archive') IS NOT NULL, false)
        ) AS has_duplicate_archive,
        (
          SELECT COUNT(*)
          FROM (
            SELECT old_inspection_id, original_day_of_week, new_inspection_id
            FROM public.van_inspection_daily_split_map
            GROUP BY old_inspection_id, original_day_of_week, new_inspection_id
          ) mapped_days
        )::text AS mapped_day_count,
        CASE
          WHEN to_regclass('public.van_inspection_daily_duplicate_archive') IS NULL THEN '0'
          ELSE (SELECT COUNT(*) FROM public.van_inspection_daily_duplicate_archive)::text
        END AS duplicate_archive_count,
        (SELECT ok FROM mapped_action) AS target_action_ok;
    `, [TARGET_ACTION_ID, TARGET_OLD_INSPECTION_ID]);

    const result = verification.rows[0];
    console.log(`Remaining weekly van inspections: ${result.remaining_weekly_count}`);
    console.log(`Orphaned inspection items: ${result.orphaned_item_count}`);
    console.log(`Orphaned inspection photos: ${result.orphaned_photo_count}`);
    console.log(`Duplicate daily van/user/date groups: ${result.duplicate_daily_group_count}`);
    console.log(`Mapped inspection items: ${result.mapped_item_count}`);
    console.log(`Mapped active days: ${result.mapped_day_count}`);
    console.log(`Archived duplicate day records: ${result.duplicate_archive_count}`);
    console.log(`Target completed action relinked: ${result.target_action_ok ? 'yes' : 'no'}\n`);

    const failures = [
      Number(result.remaining_weekly_count) === 0,
      Number(result.orphaned_item_count) === 0,
      Number(result.orphaned_photo_count) === 0,
      Number(result.duplicate_daily_group_count) === 0,
      result.target_action_ok,
    ].filter((passed) => !passed);

    if (failures.length > 0) {
      throw new Error('Migration verification failed. See counts above.');
    }

    console.log('Van inspections daily migration verified successfully.');
  } finally {
    await client.end();
    console.log('\nDisconnected from database');
  }
}

runMigration().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
