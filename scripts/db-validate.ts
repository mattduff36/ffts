/**
 * DB Validate — Post-Migration Schema Health Check
 *
 * Catches the class of bugs where a DB migration renames a column/table but
 * trigger functions (PL/pgSQL) still reference the old names.  PostgreSQL does
 * NOT validate trigger function bodies at definition time, so broken references
 * are only discovered when the trigger fires in production.
 *
 * What this script checks:
 *   1. Trigger functions — scans every TRIGGER function body for NEW.col / OLD.col
 *      patterns and verifies those columns exist in the tables the trigger is
 *      attached to.
 *   2. Trigger functions — checks UPDATE OF col_list in trigger definitions for
 *      stale column names.
 *   3. Key FK relationships used by application queries (e.g. plant → van_categories).
 *   4. Critical columns expected by the application on core tables.
 *
 * Usage:
 *   npm run db:validate
 *
 * Run this immediately after any migration that renames columns, tables, or
 * drops columns.  It exits non-zero if any issue is found.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { AutomationRun } from './automation/logger';

config({ path: resolve(process.cwd(), '.env.local') });

// ─────────────────────────────────────────────────────────────────────────────
// Column expectations: tables → columns that MUST exist for the app to work.
// Extend this list whenever a migration introduces a new critical column.
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_COLUMNS: Record<string, string[]> = {
  van_inspections:    ['id', 'van_id', 'user_id', 'inspection_date', 'status', 'current_mileage'],
  plant_inspections:  ['id', 'plant_id', 'user_id', 'inspection_date', 'status'],
  vehicle_maintenance:['id', 'van_id', 'plant_id', 'current_mileage', 'current_hours'],
  vans:               ['id', 'reg_number', 'category_id', 'status'],
  plant:              ['id', 'plant_id', 'category_id', 'status'],
  van_categories:     ['id', 'name'],
  actions:            ['id', 'van_id', 'status'],
  profiles:           ['id', 'full_name'],
  inventory_locations: [
    'id',
    'name',
    'is_active',
    'linked_van_id',
    'linked_hgv_id',
    'linked_plant_id',
    'location_type',
    'source_type',
    'source_id',
    'external_reference',
    'sync_status',
    'source_synced_at',
  ],
  inventory_items: [
    'id',
    'item_number',
    'item_number_normalized',
    'category',
    'location_id',
    'status',
    'check_interval_days',
    'retired_at',
    'retire_reason',
  ],
  inventory_item_movements: ['id', 'item_id', 'from_location_id', 'to_location_id', 'movement_batch_id', 'moved_by'],
  inventory_user_locations: ['user_id', 'location_id', 'change_reason', 'updated_by'],
  inventory_user_site_locations: ['user_id', 'location_id', 'assigned_by', 'assigned_at', 'note'],
  inventory_item_categories: ['id', 'slug', 'name', 'is_active', 'sort_order'],
  inventory_minor_plant_details: ['id', 'inventory_item_id', 'source_plant_id', 'serial_number'],
  profile_fleet_assignments: [
    'id',
    'user_id',
    'linked_van_id',
    'linked_hgv_id',
    'linked_plant_id',
    'source_location_id',
    'assigned_by',
    'ended_by',
    'assigned_at',
    'ended_at',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// FK expectations: table → column → expected referenced table.
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_FKS: Array<{ table: string; column: string; referencesTable: string }> = [
  { table: 'plant',              column: 'category_id', referencesTable: 'van_categories' },
  { table: 'van_inspections',    column: 'van_id',      referencesTable: 'vans' },
  { table: 'vehicle_maintenance', column: 'van_id',     referencesTable: 'vans' },
  { table: 'actions',            column: 'van_id',      referencesTable: 'vans' },
  { table: 'inventory_locations', column: 'linked_van_id', referencesTable: 'vans' },
  { table: 'inventory_locations', column: 'linked_hgv_id', referencesTable: 'hgvs' },
  { table: 'inventory_locations', column: 'linked_plant_id', referencesTable: 'plant' },
  { table: 'inventory_items', column: 'location_id', referencesTable: 'inventory_locations' },
  { table: 'inventory_items', column: 'category', referencesTable: 'inventory_item_categories' },
  { table: 'inventory_item_movements', column: 'item_id', referencesTable: 'inventory_items' },
  { table: 'inventory_item_movements', column: 'from_location_id', referencesTable: 'inventory_locations' },
  { table: 'inventory_item_movements', column: 'to_location_id', referencesTable: 'inventory_locations' },
  { table: 'inventory_user_locations', column: 'user_id', referencesTable: 'profiles' },
  { table: 'inventory_user_locations', column: 'location_id', referencesTable: 'inventory_locations' },
  { table: 'inventory_user_site_locations', column: 'user_id', referencesTable: 'profiles' },
  { table: 'inventory_user_site_locations', column: 'location_id', referencesTable: 'inventory_locations' },
  { table: 'inventory_user_site_locations', column: 'assigned_by', referencesTable: 'profiles' },
  { table: 'inventory_minor_plant_details', column: 'inventory_item_id', referencesTable: 'inventory_items' },
  { table: 'inventory_minor_plant_details', column: 'source_plant_id', referencesTable: 'plant' },
  { table: 'profile_fleet_assignments', column: 'user_id', referencesTable: 'profiles' },
  { table: 'profile_fleet_assignments', column: 'linked_van_id', referencesTable: 'vans' },
  { table: 'profile_fleet_assignments', column: 'linked_hgv_id', referencesTable: 'hgvs' },
  { table: 'profile_fleet_assignments', column: 'linked_plant_id', referencesTable: 'plant' },
  { table: 'profile_fleet_assignments', column: 'source_location_id', referencesTable: 'inventory_locations' },
];

type Issue = { severity: 'ERROR' | 'WARN'; message: string };

async function main(): Promise<number> {
  const run = new AutomationRun({
    scriptName: 'db-validate',
    mode: 'schema-health',
    args: process.argv.slice(2),
  });

  console.log('🔍 DB Validate — Post-Migration Schema Health Check\n');
  let client: pg.Client | null = null;
  let hasDisconnected = false;
  try {
  const connectionString: string | undefined = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    const error = new Error('POSTGRES_URL_NON_POOLING not found in .env.local');
    console.error('❌ POSTGRES_URL_NON_POOLING not found in .env.local');
    await run.finish('failed', error);
    return 1;
  }

  const url = new URL(connectionString);
  const dbClient = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
  client = dbClient;

  await run.step('Connect to database', () => dbClient.connect(), {
    database: url.pathname.slice(1),
    host: url.hostname,
  });

  const issues: Issue[] = [];

  // ── 1. Trigger function body scan ──────────────────────────────────────────
  console.log('Checking trigger function bodies against live schema...');

  // Get all trigger functions with their attached tables
  const triggerRows = await run.step('Load public trigger functions', () => dbClient.query<{
    fn_name: string;
    fn_body: string;
    table_name: string;
  }>(`
    SELECT DISTINCT
      p.proname          AS fn_name,
      p.prosrc           AS fn_body,
      c.relname          AS table_name
    FROM pg_trigger t
    JOIN pg_class   c ON c.oid = t.tgrelid
    JOIN pg_proc    p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
    ORDER BY p.proname, c.relname
  `));

  // Get all columns for all tables in public schema
  const colRows = await run.step('Load public table columns', () => dbClient.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `));
  const colsByTable = new Map<string, Set<string>>();
  for (const r of colRows.rows) {
    if (!colsByTable.has(r.table_name)) colsByTable.set(r.table_name, new Set());
    colsByTable.get(r.table_name)!.add(r.column_name);
  }

  for (const { fn_name, fn_body, table_name } of triggerRows.rows) {
    const tableCols = colsByTable.get(table_name);
    if (!tableCols) continue; // table might be a view — skip

    // Extract NEW.col and OLD.col references (case-insensitive: PL/pgSQL allows new/old/New/etc.)
    const refs = new Set<string>();
    for (const m of fn_body.matchAll(/\b(?:NEW|OLD)\.(\w+)/gi)) {
      refs.add(m[1].toLowerCase());
    }

    for (const col of refs) {
      if (!tableCols.has(col)) {
        issues.push({
          severity: 'ERROR',
          message: `Trigger fn "${fn_name}" on table "${table_name}" references column "${col}" which does not exist.`,
        });
      }
    }
  }

  // ── 2. UPDATE OF column list in trigger definitions ────────────────────────
  const tgColRows = await run.step('Load trigger update column lists', () => dbClient.query<{
    trigger_name: string;
    table_name: string;
    col_name: string;
  }>(`
    SELECT
      t.tgname           AS trigger_name,
      c.relname          AS table_name,
      a.attname          AS col_name
    FROM pg_trigger t
    JOIN pg_class   c  ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- tgattr contains the attribute numbers of UPDATE OF columns (0 = all columns)
    JOIN pg_attribute a ON a.attrelid = c.oid
      AND a.attnum = ANY(
        ARRAY(SELECT unnest(t.tgattr::int2[]))
      )
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND array_length(t.tgattr, 1) > 0
  `));

  for (const { trigger_name, table_name, col_name } of tgColRows.rows) {
    const tableCols = colsByTable.get(table_name);
    if (tableCols && !tableCols.has(col_name)) {
      issues.push({
        severity: 'ERROR',
        message: `Trigger "${trigger_name}" on "${table_name}" has UPDATE OF column "${col_name}" which does not exist.`,
      });
    }
  }

  // ── 3. Required columns check ──────────────────────────────────────────────
  console.log('Checking required columns on core tables...');
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const existing = colsByTable.get(table);
    if (!existing) {
      issues.push({ severity: 'ERROR', message: `Required table "${table}" does not exist.` });
      continue;
    }
    for (const col of cols) {
      if (!existing.has(col)) {
        issues.push({
          severity: 'ERROR',
          message: `Required column "${table}.${col}" does not exist.`,
        });
      }
    }
  }

  // ── 4. FK expectations check ───────────────────────────────────────────────
  console.log('Checking critical FK relationships...');
  const fkRows = await run.step('Load public foreign keys', () => dbClient.query<{
    table_name: string;
    column_name: string;
    foreign_table_name: string;
  }>(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
  `));

  for (const expected of REQUIRED_FKS) {
    const found = fkRows.rows.find(
      (r) =>
        r.table_name === expected.table &&
        r.column_name === expected.column
    );
    if (!found) {
      issues.push({
        severity: 'ERROR',
        message: `Expected FK ${expected.table}.${expected.column} → ${expected.referencesTable} not found (column may not exist or FK was dropped).`,
      });
    } else if (found.foreign_table_name !== expected.referencesTable) {
      issues.push({
        severity: 'ERROR',
        message: `FK ${expected.table}.${expected.column} points to "${found.foreign_table_name}" but expected "${expected.referencesTable}".`,
      });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  await run.step('Disconnect from database', async () => {
    await dbClient.end();
    hasDisconnected = true;
  });
  console.log('');

  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warns  = issues.filter((i) => i.severity === 'WARN');

  if (issues.length === 0) {
    console.log('✅ All checks passed — DB schema is healthy.\n');
    await run.finish('passed');
    return 0;
  }

  if (errors.length > 0) {
    console.log(`❌ Found ${errors.length} error(s):\n`);
    for (const e of errors) console.log(`  [ERROR] ${e.message}`);
  }
  if (warns.length > 0) {
    console.log(`\n⚠️  Found ${warns.length} warning(s):\n`);
    for (const w of warns) console.log(`  [WARN]  ${w.message}`);
  }
  console.log('');

  if (errors.length > 0) {
    console.log('Run "npm run db:validate" after fixing the issues above.\n');
    await run.finish('failed', `${errors.length} schema validation error(s) found`);
    return 1;
  }

  await run.finish('passed');
  return 0;
  } catch (error) {
    if (client && !hasDisconnected) {
      await client.end().catch(() => undefined);
    }
    await run.finish('failed', error);
    throw error;
  }
}

main().catch((err: unknown) => {
  console.error('💥 Unexpected error:', err);
  process.exit(1);
}).then((exitCode) => {
  if (typeof exitCode === 'number') process.exit(exitCode);
});
