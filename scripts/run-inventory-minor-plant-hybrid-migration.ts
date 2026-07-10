import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260526_inventory_minor_plant_hybrid.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory Minor Plant hybrid migration...');

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
      SELECT slug
      FROM public.inventory_item_categories
      WHERE LOWER(BTRIM(name)) = 'van stock'
        AND is_active = TRUE
      ORDER BY sort_order, name
      LIMIT 1
    `);

    const vanStockSlug = rows[0]?.slug;
    if (!vanStockSlug) {
      throw new Error('Active Van Stock category was not found after migration');
    }

    const detailTableResult = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'inventory_minor_plant_details'
      ) AS exists
    `);

    if (!detailTableResult.rows[0]?.exists) {
      throw new Error('inventory_minor_plant_details table was not created');
    }

    const remainingMinorPlantResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.inventory_items
      WHERE category = 'minor_plant'
        AND status = 'active'
        AND source IS DISTINCT FROM 'fleet_plant'
    `);

    console.log(`Van Stock category slug: ${vanStockSlug}`);
    console.log(`Existing active non-Fleet Plant minor_plant rows remaining: ${remainingMinorPlantResult.rows[0]?.count ?? 0}`);
    console.log('Inventory Minor Plant hybrid migration completed.');
  } catch (error) {
    console.error('Inventory Minor Plant hybrid migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
