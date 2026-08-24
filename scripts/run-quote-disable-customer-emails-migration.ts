import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260824_quote_disable_customer_emails.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Running quote disable-customer-emails migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const result = await client.query<{ column_name: string; column_default: string | null; is_nullable: string }>(`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'quote_module_settings'
        AND column_name = 'customer_emails_disabled'
    `);

    if (result.rowCount !== 1) {
      throw new Error('quote_module_settings.customer_emails_disabled was not created');
    }

    console.log('Migration complete');
    console.log(`customer_emails_disabled nullable=${result.rows[0].is_nullable} default=${result.rows[0].column_default}`);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
