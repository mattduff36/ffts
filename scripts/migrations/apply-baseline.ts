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

function getSqlSteps(): SqlStep[] {
  const baselinePath = resolve(process.cwd(), 'supabase', 'schema.sql');
  const foundationPath = resolve(process.cwd(), 'supabase', 'baseline');
  const migrationsPath = resolve(process.cwd(), 'supabase', 'migrations');

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

  if (!existsSync(migrationsPath)) return steps;

  const priorityMigrationFiles = [
    '20251218_create_vehicle_maintenance_system.sql',
    '20260122_workshop_attachments.sql',
    '20260126_notification_preferences.sql',
    '20260202_create_plant_table.sql',
    '20260301_split_inspections.sql',
    '20260228_vehicles_to_vans_hgvs.sql',
    '20260302_big_bang_vehicle_to_van_rename.sql',
    '20260320_org_hierarchy_core_tables.sql',
    '20260320_org_hierarchy_functions.sql',
    '20260322_team_permission_matrix.sql',
    '20260401_workshop_attachments_schema_v2.sql',
    '20260404_account_switch_device_pin_model.sql',
    'add-project-document-types-and-favourites.sql',
  ];
  const migrationFiles = readdirSync(migrationsPath)
    .filter((file) => file.endsWith('.sql'))
    .filter((file) => !priorityMigrationFiles.includes(file))
    .sort((a, b) => a.localeCompare(b));

  for (const file of [...priorityMigrationFiles, ...migrationFiles]) {
    const path = resolve(migrationsPath, file);
    if (!existsSync(path)) continue;

    steps.push({
      key: file,
      label: file,
      path,
    });
  }

  return steps;
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

async function applyStep(client: Client, step: SqlStep): Promise<'applied' | 'skipped'> {
  if (await hasAppliedStep(client, step.key)) return 'skipped';

  const sql = readFileSync(step.path, 'utf8');
  await client.query(sql);
  await recordAppliedStep(client, step.key);
  return 'applied';
}

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('POSTGRES_URL_NON_POOLING is required to bootstrap the database.');
    process.exit(1);
  }

  const steps = getSqlSteps();
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
