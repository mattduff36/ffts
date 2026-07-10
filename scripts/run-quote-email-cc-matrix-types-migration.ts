import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260623_quote_email_cc_matrix_types.sql';

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
    console.log('Running quote email CC matrix types migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const verification = await client.query<{ notification_type: string; recipient_count: string }>(`
      SELECT notification_type, count(*)::text AS recipient_count
      FROM public.quote_invoice_notification_recipients
      WHERE notification_type IN (
        'quote_customer_email_copy',
        'quote_po_request_copy',
        'quote_rams_request_copy',
        'quote_start_alert_copy',
        'quote_invoice_request_copy',
        'quote_invoice_added_copy'
      )
      GROUP BY notification_type
      ORDER BY notification_type
    `);

    console.log('Migration complete');
    console.table(verification.rows);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
