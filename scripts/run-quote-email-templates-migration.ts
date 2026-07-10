import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260603_quote_email_templates.sql';

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
    console.log('Running quote email templates migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const tableResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'quote_email_templates'
      ORDER BY ordinal_position
    `);

    const templateResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.quote_email_templates
    `);

    if (tableResult.rowCount === 0) {
      throw new Error('quote_email_templates table was not created');
    }

    if (Number(templateResult.rows[0]?.count || 0) < 9) {
      throw new Error('quote_email_templates default rows were not seeded');
    }

    console.log('Migration complete');
    console.log(`quote_email_templates columns: ${tableResult.rows.length}`);
    console.log(`quote_email_templates default rows: ${templateResult.rows[0]?.count}`);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
