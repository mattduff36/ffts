/**
 * Migration Runner: Category-driven fleet columns
 *
 * Usage:
 *   npx tsx scripts/run-category-driven-fleet-columns-migration.ts
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260430_category_driven_fleet_columns.sql';

async function runMigration() {
  console.log('Running Category-Driven Fleet Columns Migration');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected');

    console.log('Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('Migration executed successfully');

    console.log('Verifying category metadata and HGV service split...');
    const metadataResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'maintenance_categories'
        AND column_name IN ('field_key', 'is_system', 'is_delete_protected')
    `);

    if (metadataResult.rows.length !== 3) {
      console.error('Verification failed: maintenance category metadata columns missing');
      process.exit(1);
    }

    const valueTableResult = await client.query(`
      SELECT to_regclass('public.asset_maintenance_category_values') AS table_name
    `);

    if (!valueTableResult.rows[0]?.table_name) {
      console.error('Verification failed: asset_maintenance_category_values table missing');
      process.exit(1);
    }

    const categoriesResult = await client.query<{
      name: string;
      applies_to: string[];
      period_value: number;
      is_delete_protected: boolean;
    }>(`
      SELECT name, applies_to, period_value, is_delete_protected
      FROM public.maintenance_categories
      WHERE LOWER(name) IN ('service due', 'engine service', 'full service', 'mot due date', 'tax due date')
    `);

    const categoriesByName = new Map(categoriesResult.rows.map(row => [row.name.toLowerCase(), row]));
    const serviceDue = categoriesByName.get('service due');
    const engineService = categoriesByName.get('engine service');
    const fullService = categoriesByName.get('full service');

    if (!serviceDue || serviceDue.applies_to.includes('hgv')) {
      console.error('Verification failed: Service Due still applies to HGVs');
      process.exit(1);
    }

    if (!engineService || !engineService.applies_to.includes('hgv') || engineService.period_value !== 25000) {
      console.error('Verification failed: Engine Service is not configured for 25,000 KM HGV service');
      process.exit(1);
    }

    if (!fullService || !fullService.applies_to.includes('hgv') || fullService.period_value !== 100000) {
      console.error('Verification failed: Full Service is not configured for 100,000 KM HGV service');
      process.exit(1);
    }

    const protectedSystemCategories = categoriesResult.rows.filter(row =>
      ['mot due date', 'tax due date'].includes(row.name.toLowerCase()) && row.is_delete_protected
    );

    if (protectedSystemCategories.length !== 2) {
      console.error('Verification failed: expected API-backed categories are not delete-protected');
      process.exit(1);
    }

    console.log('Verified: category metadata, value table, and HGV service split are present');
    console.log('Migration completed successfully');
  } catch (error: unknown) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Disconnected from database');
  }
}

runMigration().catch((error: unknown) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
