import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const parityCutoff = '20260430';
const intentionallySupersededMigrations = new Set([
  '20260612_questionnaire_submissions.sql',
]);

const requiredTables = [
  'display_board_configs',
  'inventory_minor_plant_details',
  'inventory_user_site_locations',
  'profile_fleet_assignments',
  'profile_sensitive_pins',
  'quote_invoice_requests',
  'reminder_actions',
  'training_records',
  'user_module_permissions',
  'user_usage_events',
  'webauthn_credentials',
];

const removedTables = [
  'account_switch_device_credentials',
  'account_switch_settings',
  'questionnaire_submissions',
];

async function main(): Promise<void> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING is required.');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const localMigrations = readdirSync(resolve(process.cwd(), 'supabase', 'migrations'))
      .filter((file) => file.endsWith('.sql') && file >= parityCutoff)
      .sort();
    const appliedResult = await client.query<{ migration_key: string }>(
      'SELECT migration_key FROM public.template_migration_runs'
    );
    const applied = new Set(appliedResult.rows.map((row) => row.migration_key));
    const pending = localMigrations.filter(
      (file) => !applied.has(file) && !intentionallySupersededMigrations.has(file)
    );

    const tableResult = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::TEXT[])`,
      [[...requiredTables, ...removedTables]]
    );
    const presentTables = new Set(tableResult.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !presentTables.has(table));
    const obsoleteTables = removedTables.filter((table) => presentTables.has(table));

    const cleanupResult = await client.query<{
      template_customers: string;
      placeholder_managers: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::TEXT
         FROM public.customers
         WHERE contact_phone LIKE '01onal 55500_') AS template_customers,
        (SELECT COUNT(*)::TEXT
         FROM public.quote_manager_series
         WHERE manager_email LIKE '%@example.com') AS placeholder_managers
    `);
    const cleanup = cleanupResult.rows[0];

    const superAdminResult = await client.query<{ count: string }>(`
      SELECT COUNT(*)::TEXT AS count
      FROM public.profiles AS profile
      JOIN public.roles AS role ON role.id = profile.role_id
      JOIN auth.users AS auth_user ON auth_user.id = profile.id
      WHERE LOWER(auth_user.email) = LOWER('admin@mpdee.co.uk')
        AND role.is_super_admin = TRUE
    `);

    const errors = [
      ...(pending.length > 0 ? [`Pending migrations: ${pending.join(', ')}`] : []),
      ...(missingTables.length > 0 ? [`Missing tables: ${missingTables.join(', ')}`] : []),
      ...(obsoleteTables.length > 0 ? [`Obsolete tables remain: ${obsoleteTables.join(', ')}`] : []),
      ...(cleanup?.template_customers !== '0'
        ? [`Template customer rows remain: ${cleanup?.template_customers ?? 'unknown'}`]
        : []),
      ...(cleanup?.placeholder_managers !== '0'
        ? [`Placeholder quote managers remain: ${cleanup?.placeholder_managers ?? 'unknown'}`]
        : []),
      ...(superAdminResult.rows[0]?.count !== '1'
        ? ['Forest SuperAdmin profile is missing or ambiguous.']
        : []),
    ];

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    console.log(`Verified ${localMigrations.length} parity-era migration files.`);
    console.log(`Verified ${requiredTables.length} required tables and ${removedTables.length} removals.`);
    console.log('Verified template cleanup and Forest SuperAdmin state.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
