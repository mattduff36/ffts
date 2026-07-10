import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260705_inventory_user_site_locations.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory user site locations migration...');

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

    const [{ rows: tableRows }, { rows: columnRows }, { rows: triggerRows }] = await Promise.all([
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'inventory_user_site_locations'
      `),
      client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory_user_site_locations'
          AND column_name IN ('user_id', 'location_id', 'assigned_by', 'assigned_at', 'note')
      `),
      client.query<{ trigger_name: string }>(`
        SELECT DISTINCT trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
          AND event_object_table = 'inventory_user_site_locations'
          AND trigger_name = 'validate_inventory_user_site_locations'
      `),
    ]);

    if (tableRows.length !== 1) {
      throw new Error('inventory_user_site_locations table was not created');
    }
    if (columnRows.length !== 5) {
      throw new Error('inventory_user_site_locations columns were not fully created');
    }
    if (triggerRows.length !== 1) {
      throw new Error('inventory_user_site_locations validation trigger was not created');
    }

    console.log('Inventory user site locations migration completed.');
  } catch (error) {
    console.error(
      'Inventory user site locations migration failed:',
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
