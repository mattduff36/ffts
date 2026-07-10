import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

interface SqlStep {
  key: string;
  label: string;
  path: string;
}

const migrationTable = 'template_migration_runs';

/**
 * Hard prerequisites that pure filename order gets wrong on a fresh database.
 * Keys are dependents; values are migration files that must already be applied.
 */
const HARD_PREREQUISITES: Record<string, string[]> = {
  '20251218_add_tracker_id_remove_cambelt_done.sql': [
    '20251218_create_vehicle_maintenance_system.sql',
  ],
  '20251218_add_vehicle_maintenance_audit_trigger.sql': [
    '20251218_create_vehicle_maintenance_system.sql',
  ],
  '20260122_fix_workshop_attachment_cascade.sql': ['20260122_workshop_attachments.sql'],
  '20260126_fix_notification_preferences_admin_insert.sql': [
    '20260126_notification_preferences.sql',
  ],
  '20260126_fix_notification_preferences_admin_insert_v2.sql': [
    '20260126_notification_preferences.sql',
  ],
  '20260126_fix_notification_preferences_admin_insert_v3.sql': [
    '20260126_notification_preferences.sql',
  ],
  '20260126_sync_notification_preferences.sql': ['20260126_notification_preferences.sql'],
  '20260202_add_reg_number_to_plant.sql': ['20260202_create_plant_table.sql'],
  '20260228_fix_vehicle_inspection_update_with_check.sql': [
    '20260301_split_inspections.sql',
  ],
  '20260228_vehicles_to_vans_hgvs.sql': ['20260301_split_inspections.sql'],
  '20260302_big_bang_vehicle_to_van_rename.sql': ['20260228_vehicles_to_vans_hgvs.sql'],
  '20260320_org_hierarchy_absence_rls.sql': ['20260320_org_hierarchy_core_tables.sql'],
  '20260404_account_switch_app_session_redesign.sql': [
    '20260404_account_switch_device_pin_model.sql',
  ],
};

function getFoundationSteps(): SqlStep[] {
  const baselinePath = resolve(process.cwd(), 'supabase', 'schema.sql');
  const foundationPath = resolve(process.cwd(), 'supabase', 'baseline');

  const steps: SqlStep[] = [
    {
      key: '00000000_baseline_schema.sql',
      label: 'baseline schema',
      path: baselinePath,
    },
  ];

  const foundationFiles = [
    'create-roles-and-permissions.sql',
    'create-rbac-helper-functions.sql',
    'create-actions-table.sql',
    'create-messages-tables.sql',
    'create-rams-tables.sql',
    'add-absence-system.sql',
    'faq-and-suggestions.sql',
    'add-password-reset-flag.sql',
    'add-phone-number-column.sql',
    'add-job-number-column.sql',
    'add-day-of-week-column.sql',
    'add-did-not-work-column.sql',
    'add-shift-type-columns.sql',
    'add-processed-status-to-timesheets.sql',
    'add-adjusted-status-to-timesheets.sql',
    'add-pdf-to-toolbox-talks.sql',
    'add-rams-action-taken.sql',
    'add-vehicle-categories.sql',
    'enable-audit-logging.sql',
    'enable-audit-log-access.sql',
  ];

  for (const file of foundationFiles) {
    const path = resolve(foundationPath, file);
    if (!existsSync(path)) continue;

    steps.push({
      key: `foundation/${file}`,
      label: `foundation ${file}`,
      path,
    });
  }

  return steps;
}

function getMigrationSteps(): SqlStep[] {
  const migrationsPath = resolve(process.cwd(), 'supabase', 'migrations');
  if (!existsSync(migrationsPath)) return [];

  return readdirSync(migrationsPath)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      key: file,
      label: file,
      path: resolve(migrationsPath, file),
    }));
}

async function ensureMigrationTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${migrationTable} (
      id BIGSERIAL PRIMARY KEY,
      migration_key TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasAppliedStep(client: Client, key: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${migrationTable} WHERE migration_key = $1)`,
    [key]
  );

  return result.rows[0]?.exists === true;
}

async function recordAppliedStep(client: Client, key: string): Promise<void> {
  await client.query(
    `INSERT INTO ${migrationTable} (migration_key) VALUES ($1) ON CONFLICT (migration_key) DO NOTHING`,
    [key]
  );
}

function isIgnorableIdempotencyError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('already exists') ||
    normalized.includes('duplicate key value') ||
    normalized.includes('already a policy')
  );
}

async function prerequisitesSatisfied(client: Client, stepKey: string): Promise<boolean> {
  const required = HARD_PREREQUISITES[stepKey] ?? [];
  for (const key of required) {
    if (!(await hasAppliedStep(client, key))) return false;
  }
  return true;
}

async function applyStep(client: Client, step: SqlStep): Promise<'applied' | 'skipped'> {
  if (await hasAppliedStep(client, step.key)) return 'skipped';

  const sql = readFileSync(step.path, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await recordAppliedStep(client, step.key);
    await client.query('COMMIT');
    return 'applied';
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    if (isIgnorableIdempotencyError(message)) {
      await recordAppliedStep(client, step.key);
      console.log(`Treated ${step.label} as applied (idempotent): ${message}`);
      return 'applied';
    }
    throw error;
  }
}

async function applyStrictSteps(
  client: Client,
  steps: SqlStep[]
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;

  for (const step of steps) {
    const result = await applyStep(client, step);
    if (result === 'applied') {
      applied += 1;
      console.log(`Applied ${step.label}`);
    } else {
      skipped += 1;
      console.log(`Skipped ${step.label} (already applied)`);
    }
  }

  return { applied, skipped };
}

async function applyMigrationsWithRetry(
  client: Client,
  steps: SqlStep[]
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;
  let pending = [...steps];
  const maxPasses = pending.length + 5;

  for (let pass = 1; pass <= maxPasses && pending.length > 0; pass += 1) {
    console.log(`Migration pass ${pass}: ${pending.length} pending`);
    const stillPending: SqlStep[] = [];
    let progress = 0;

    for (const step of pending) {
      if (await hasAppliedStep(client, step.key)) {
        skipped += 1;
        progress += 1;
        console.log(`Skipped ${step.label} (already applied)`);
        continue;
      }

      if (!(await prerequisitesSatisfied(client, step.key))) {
        stillPending.push(step);
        console.log(`Waiting on prerequisites for ${step.label}`);
        continue;
      }

      try {
        const result = await applyStep(client, step);
        if (result === 'applied') {
          applied += 1;
          console.log(`Applied ${step.label}`);
        } else {
          skipped += 1;
          console.log(`Skipped ${step.label} (already applied)`);
        }
        progress += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stillPending.push(step);
        console.log(`Deferred ${step.label}: ${message}`);
      }
    }

    pending = stillPending;
    if (pending.length === 0) break;
    if (progress === 0) {
      throw new Error(
        `Unable to apply remaining migrations after ${pass} passes with no progress: ${pending
          .map((step) => step.label)
          .join(', ')}`
      );
    }
  }

  if (pending.length > 0) {
    throw new Error(
      `Migrations still pending after retry passes: ${pending.map((step) => step.label).join(', ')}`
    );
  }

  return { applied, skipped };
}

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('POSTGRES_URL_NON_POOLING is required to bootstrap the database.');
    process.exit(1);
  }

  const foundationSteps = getFoundationSteps();
  const migrationSteps = getMigrationSteps();
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await ensureMigrationTable(client);

    const foundationResult = await applyStrictSteps(client, foundationSteps);
    const migrationResult = await applyMigrationsWithRetry(client, migrationSteps);

    const applied = foundationResult.applied + migrationResult.applied;
    const skipped = foundationResult.skipped + migrationResult.skipped;

    console.log(`Database bootstrap complete: ${applied} applied, ${skipped} skipped.`);
    console.log('Next: run npm run db:validate');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
