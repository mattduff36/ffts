import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260619_zz_inventory_yard_check_logic.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory Yard check logic migration...');

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

    const [{ rows: itemRows }, { rows: categoryRows }] = await Promise.all([
      client.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM public.inventory_items
        WHERE category = 'check_on_demand'
      `),
      client.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM public.inventory_item_categories
        WHERE slug = 'check_on_demand'
      `),
    ]);

    const itemCount = Number.parseInt(itemRows[0]?.count || '0', 10);
    const categoryCount = Number.parseInt(categoryRows[0]?.count || '0', 10);
    if (itemCount !== 0 || categoryCount !== 0) {
      throw new Error('Check on Demand category data was not fully removed');
    }

    console.log('Inventory Yard check logic migration completed.');
  } catch (error) {
    console.error(
      'Inventory Yard check logic migration failed:',
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
