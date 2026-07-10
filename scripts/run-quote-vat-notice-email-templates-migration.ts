import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260609_quote_vat_notice_email_templates.sql';
const vatNotice = 'All prices are subject to the current V.A.T. rates applicable at the time of invoice.';
const targetTemplates = ['customer_quote', 'po_request'];

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
    console.log('Running quote VAT notice email templates migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const { rows } = await client.query<{
      template_key: string;
      has_vat_notice: boolean;
    }>(
      `
      SELECT
        template_key,
        body_template LIKE $1 AS has_vat_notice
      FROM public.quote_email_templates
      WHERE template_key = ANY($2::text[])
      ORDER BY template_key
      `,
      [`%${vatNotice}%`, targetTemplates]
    );

    const foundKeys = new Set(rows.map(row => row.template_key));
    const missingRows = targetTemplates.filter(templateKey => !foundKeys.has(templateKey));
    if (missingRows.length > 0) {
      throw new Error(`Missing quote email template rows: ${missingRows.join(', ')}`);
    }

    console.log('Migration complete');
    for (const row of rows) {
      console.log(`${row.template_key}: ${row.has_vat_notice ? 'VAT notice present' : 'custom wording preserved'}`);
    }
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
