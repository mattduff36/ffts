import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260527_restore_fleet_plant_minor_inventory.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running restore Fleet Plant Minor Plant inventory migration...');

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
      SELECT
        COUNT(*) FILTER (
          WHERE i.status = 'active'
            AND i.category = 'minor_plant'
            AND i.source = 'fleet_plant'
        )::int AS active_minor_plant_fleet_count,
        COUNT(*) FILTER (
          WHERE i.status = 'active'
            AND i.category = 'minor_plant'
            AND i.source = 'fleet_plant'
            AND LOWER(BTRIM(l.name)) = 'yard'
        )::int AS yard_minor_plant_fleet_count,
        COUNT(*) FILTER (
          WHERE i.status = 'active'
            AND i.category = 'van_stock'
            AND i.source = 'fleet_plant'
        )::int AS active_van_stock_fleet_count
      FROM public.inventory_items i
      LEFT JOIN public.inventory_locations l
        ON l.id = i.location_id
    `);

    const counts = rows[0] || {};
    if ((counts.active_van_stock_fleet_count ?? 0) !== 0) {
      throw new Error(`Expected no active fleet_plant rows in Van Stock, found ${counts.active_van_stock_fleet_count}`);
    }
    if (counts.active_minor_plant_fleet_count !== counts.yard_minor_plant_fleet_count) {
      throw new Error(`Expected all active fleet_plant Minor Plant rows in Yard, found ${counts.yard_minor_plant_fleet_count}/${counts.active_minor_plant_fleet_count}`);
    }

    console.log(`Fleet Plant Minor Plant rows restored: ${counts.active_minor_plant_fleet_count}`);
    console.log(`Fleet Plant Minor Plant rows in Yard: ${counts.yard_minor_plant_fleet_count}`);
    console.log('Restore Fleet Plant Minor Plant inventory migration completed.');
  } catch (error) {
    console.error('Restore Fleet Plant Minor Plant inventory migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
