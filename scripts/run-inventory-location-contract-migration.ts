import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260702_inventory_location_contract.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory location contract migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const [{ rows: locationColumnRows }, { rows: assignmentTableRows }, { rows: categoryRows }] = await Promise.all([
      client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory_locations'
          AND column_name IN ('location_type', 'source_type', 'source_id', 'external_reference', 'sync_status', 'source_synced_at')
      `),
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'profile_fleet_assignments'
      `),
      client.query<{ slug: string }>(`
        SELECT slug
        FROM public.inventory_item_categories
        WHERE slug = 'site_items'
      `),
    ]);

    if (locationColumnRows.length !== 6) {
      throw new Error('inventory_locations metadata columns were not fully created');
    }
    if (assignmentTableRows.length !== 1) {
      throw new Error('profile_fleet_assignments table was not created');
    }
    if (categoryRows.length !== 1) {
      throw new Error('site_items inventory category was not created');
    }

    console.log('Inventory location contract migration completed.');
  } catch (error) {
    console.error(
      'Inventory location contract migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
