import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260619_inventory_special_statuses.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory special statuses migration...');

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

    const { rows } = await client.query(`
      SELECT 'location' AS kind, name AS value
      FROM public.inventory_locations
      WHERE LOWER(BTRIM(name)) = 'unknown'
        AND is_active = TRUE
      UNION ALL
      SELECT 'category' AS kind, slug AS value
      FROM public.inventory_item_categories
      WHERE slug = 'check_on_demand'
        AND is_active = TRUE
      ORDER BY kind
    `);

    if (rows.length !== 2) {
      throw new Error('Inventory special location/category records were not verified');
    }

    console.log('Inventory special statuses migration completed.');
  } catch (error) {
    console.error(
      'Inventory special statuses migration failed:',
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
