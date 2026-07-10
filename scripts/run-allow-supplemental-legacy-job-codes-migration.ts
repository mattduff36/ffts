import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const { Client } = pg;

function getConnectionConfig() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  }

  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  };
}

async function main() {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20260615_allow_supplemental_legacy_job_codes.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const client = new Client(getConnectionConfig());

  await client.connect();
  try {
    await client.query(sql);
    const result = await client.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.legacy_quotes'::regclass
        AND conname = 'legacy_quotes_reference_format_check'
    `);

    if (result.rowCount !== 1) {
      throw new Error('legacy_quotes_reference_format_check was not recreated');
    }

    console.log('Supplemental legacy job-code migration applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Supplemental legacy job-code migration failed:', error);
  process.exit(1);
});
