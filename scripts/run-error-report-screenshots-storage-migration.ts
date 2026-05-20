import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const SQL_FILE = 'supabase/migrations/20260511_error_report_screenshots_storage.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const targetProjectRef = process.env.DEMO_SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

if (targetProjectRef && !connectionString.includes(targetProjectRef)) {
  console.error('Database connection string does not target the approved Supabase project.');
  console.error(`Expected project ref: ${targetProjectRef}`);
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString!);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration() {
  const client = createClient();

  try {
    console.log('Running error report screenshots storage migration...');
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), SQL_FILE), 'utf-8');
    await client.query(migrationSql);

    const { rows: bucketRows } = await client.query<{ id: string; public: boolean }>(`
      SELECT id, public
      FROM storage.buckets
      WHERE id = 'error-report-screenshots'
    `);

    if (bucketRows.length !== 1 || bucketRows[0].public) {
      throw new Error('Private error-report-screenshots bucket was not created correctly.');
    }

    const { rows: policyRows } = await client.query<{ policyname: string }>(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname IN (
          'Users can upload own error report screenshots',
          'Users can view own error report screenshots',
          'Admins can view error report screenshots'
        )
      ORDER BY policyname
    `);

    if (policyRows.length !== 3) {
      throw new Error(`Expected 3 screenshot storage policies, found ${policyRows.length}.`);
    }

    console.log('Verified private bucket and screenshot storage policies.');
    console.log('Error report screenshots storage migration completed.');
  } catch (error) {
    console.error('Error report screenshots storage migration failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
