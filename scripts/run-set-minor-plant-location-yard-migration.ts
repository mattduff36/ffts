import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260527_set_minor_plant_location_yard.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running set Minor Plant location to Yard migration...');

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
        COUNT(*)::int AS active_minor_plant_count,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(l.name)) = 'yard')::int AS yard_count
      FROM public.inventory_items i
      LEFT JOIN public.inventory_locations l
        ON l.id = i.location_id
      WHERE i.status = 'active'
        AND i.category = 'minor_plant'
    `);

    const activeMinorPlantCount = rows[0]?.active_minor_plant_count ?? 0;
    const yardCount = rows[0]?.yard_count ?? 0;
    if (activeMinorPlantCount !== yardCount) {
      throw new Error(`Expected all active Minor Plant rows in Yard, found ${yardCount}/${activeMinorPlantCount}`);
    }

    console.log(`Minor Plant rows in Yard: ${yardCount}/${activeMinorPlantCount}`);
    console.log('Set Minor Plant location to Yard migration completed.');
  } catch (error) {
    console.error('Set Minor Plant location to Yard migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
