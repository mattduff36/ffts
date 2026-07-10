/**
 * Migration Runner: Align HGV maintenance categories
 *
 * Usage:
 *   npx tsx scripts/run-align-hgv-maintenance-categories-migration.ts
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260430_align_hgv_maintenance_categories.sql';
const REQUIRED_CATEGORIES = [
  'Tax Due Date',
  'MOT Due Date',
  'Service Due',
  'First Aid Kit Expiry',
  '6 Weekly Inspection Due',
  'Fire Extinguisher Due',
  'Taco Calibration Due',
] as const;
const REQUIRED_CATEGORY_NAMES = REQUIRED_CATEGORIES.map(name => name.toLowerCase());

async function runMigration() {
  console.log('Running Align HGV Maintenance Categories Migration');

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

    console.log('Verifying maintenance categories...');
    const { rows } = await client.query<{
      name: string;
      applies_to: string[];
      is_active: boolean;
      show_on_overview: boolean;
    }>(
      `
        SELECT name, applies_to, is_active, show_on_overview
        FROM public.maintenance_categories
        WHERE LOWER(name) = ANY($1::text[])
        ORDER BY name
      `,
      [REQUIRED_CATEGORY_NAMES]
    );

    const foundNames = new Set(rows.map(row => row.name.toLowerCase()));
    const missingCategories = REQUIRED_CATEGORY_NAMES.filter(name => !foundNames.has(name));
    if (missingCategories.length > 0) {
      console.error(`Verification failed: missing categories ${missingCategories.join(', ')}`);
      process.exit(1);
    }

    const hiddenCategories = rows.filter(row => !row.is_active || !row.show_on_overview);
    if (hiddenCategories.length > 0) {
      console.error(`Verification failed: categories hidden from overview ${hiddenCategories.map(row => row.name).join(', ')}`);
      process.exit(1);
    }

    const categoriesMissingHgv = rows.filter(row => !row.applies_to.includes('hgv'));
    if (categoriesMissingHgv.length > 0) {
      console.error(`Verification failed: categories missing HGV applicability ${categoriesMissingHgv.map(row => row.name).join(', ')}`);
      process.exit(1);
    }

    console.log('Verified: HGV maintenance categories are present and visible');
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
