import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260619_inventory_require_item_locations.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory require item locations migration...');

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

    const [{ rows: nullLocationRows }, { rows: nullableColumnRows }] = await Promise.all([
      client.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM public.inventory_items
        WHERE location_id IS NULL
      `),
      client.query<{ is_nullable: string }>(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory_items'
          AND column_name = 'location_id'
      `),
    ]);

    const nullLocationCount = Number.parseInt(nullLocationRows[0]?.count || '0', 10);
    const isNullable = nullableColumnRows[0]?.is_nullable === 'YES';
    if (nullLocationCount !== 0 || isNullable) {
      throw new Error('inventory_items.location_id is still nullable or has null values');
    }

    console.log('Inventory require item locations migration completed.');
  } catch (error) {
    console.error(
      'Inventory require item locations migration failed:',
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
