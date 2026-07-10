import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260601_inventory_retirement.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory Retirement migration...');

  const url = new URL(connectionString!);
  const client = new Client({
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
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows: columnRows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'inventory_items'
        AND column_name IN ('retired_at', 'retire_reason', 'retired_by')
      ORDER BY column_name
    `);

    if (columnRows.length !== 3) {
      throw new Error(`Expected 3 inventory retirement columns, found ${columnRows.length}`);
    }

    const { rows: inactiveRows } = await client.query(`
      SELECT COUNT(*)::int AS inactive_count
      FROM public.inventory_items
      WHERE status = 'inactive'
    `);

    if ((inactiveRows[0]?.inactive_count || 0) > 0) {
      throw new Error(`Expected no inactive inventory items after migration, found ${inactiveRows[0].inactive_count}`);
    }

    console.log('Inventory Retirement migration completed.');
  } catch (error) {
    console.error(
      'Inventory Retirement migration failed:',
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
