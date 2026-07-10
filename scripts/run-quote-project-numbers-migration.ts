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
    password: url.password,
    ssl: { rejectUnauthorized: false },
  };
}

async function main() {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20260614_quote_project_numbers.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const client = new Client(getConnectionConfig());

  await client.connect();
  try {
    await client.query(sql);
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('quote_project_numbers', 'quote_project_costs')
      ORDER BY table_name
    `);

    const tables = result.rows.map((row: { table_name: string }) => row.table_name);
    if (!tables.includes('quote_project_numbers') || !tables.includes('quote_project_costs')) {
      throw new Error(`Project number tables were not created correctly: ${tables.join(', ')}`);
    }

    console.log('Quote project numbers migration applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Quote project numbers migration failed:', error);
  process.exit(1);
});
