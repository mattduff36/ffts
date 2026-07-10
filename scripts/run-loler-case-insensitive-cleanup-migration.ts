import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260515_case_insensitive_loler_typo_cleanup.sql';
const LEGACY_LOLER_TYPO = ['LOLO', 'R'].join('');

interface DbColumn {
  table_schema: string;
  table_name: string;
  column_name: string;
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function countRemainingLegacyLolerTypo(client: pg.Client) {
  const { rows: columns } = await client.query<DbColumn>(`
    SELECT c.table_schema, c.table_name, c.column_name
    FROM information_schema.columns c
    INNER JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
      AND c.is_generated = 'NEVER'
    ORDER BY c.table_name, c.column_name;
  `);

  let total = 0;
  const hits: string[] = [];

  for (const column of columns) {
    const tableName = `${quoteIdentifier(column.table_schema)}.${quoteIdentifier(column.table_name)}`;
    const columnName = quoteIdentifier(column.column_name);
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE ${columnName}::text ILIKE $1`,
      [`%${LEGACY_LOLER_TYPO}%`],
    );
    const count = Number(rows[0]?.count || '0');
    if (count > 0) {
      total += count;
      hits.push(`${column.table_schema}.${column.table_name}.${column.column_name}: ${count}`);
    }
  }

  return { total, hits };
}

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const migrationSql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(migrationSql);

    const remaining = await countRemainingLegacyLolerTypo(client);
    if (remaining.total > 0) {
      throw new Error(`Verification failed: remaining legacy LOLER typo values found:\n${remaining.hits.join('\n')}`);
    }

    console.log('Case-insensitive LOLER typo cleanup verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
