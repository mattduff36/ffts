import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260527_hide_copied_minor_plant_source_assets.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running hide copied Minor Plant source assets migration...');

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
      SELECT COUNT(*)::int AS overlap_count
      FROM public.plant p
      JOIN public.inventory_minor_plant_details d
        ON d.source_plant_id = p.id
      JOIN public.inventory_items i
        ON i.id = d.inventory_item_id
      WHERE p.status = 'active'
        AND i.status = 'active'
        AND i.category = 'minor_plant'
    `);

    const overlapCount = rows[0]?.overlap_count ?? 0;
    if (overlapCount !== 0) {
      throw new Error(`Expected no active Plant/Minor Plant overlap, found ${overlapCount}`);
    }

    console.log('Active Plant/Minor Plant overlap count: 0');
    console.log('Hide copied Minor Plant source assets migration completed.');
  } catch (error) {
    console.error('Hide copied Minor Plant source assets migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
