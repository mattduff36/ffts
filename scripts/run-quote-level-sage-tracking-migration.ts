import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260605_quote_level_sage_tracking.sql';

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
    console.log('Running quote-level Sage tracking migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const quoteColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'quotes'
        AND column_name IN ('sage_posted_at', 'sage_posted_by')
      ORDER BY column_name
    `);

    if (quoteColumns.rowCount !== 2) {
      throw new Error('quotes Sage tracking columns were not created');
    }

    const invoiceColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'quote_invoices'
        AND column_name IN ('sage_posted_at', 'sage_posted_by')
    `);

    if ((invoiceColumns.rowCount ?? 0) > 0) {
      throw new Error('quote_invoices Sage tracking columns were not removed');
    }

    console.log('Migration complete');
    console.log('quotes Sage tracking columns: OK');
    console.log('quote_invoices Sage tracking columns removed: OK');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
