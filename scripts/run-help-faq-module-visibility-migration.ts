import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const SQL_FILE = 'supabase/migrations/20260520_help_faq_module_visibility.sql';

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
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration() {
  const client = createClient();

  try {
    console.log('Running Help FAQ module visibility migration...');
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), SQL_FILE), 'utf-8');
    await client.query(migrationSql);

    const { rows: columnRows } = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'faq_categories'
        AND column_name = 'module_name'
    `);

    if (columnRows.length !== 1) {
      throw new Error('FAQ category module_name column was not created.');
    }

    console.log('Help FAQ module visibility migration completed.');
  } catch (error) {
    console.error('Help FAQ module visibility migration failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
