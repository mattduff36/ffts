import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function main(): Promise<void> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING is required.');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const [tables, columns, constraints, indexes, triggers, functions] = await Promise.all([
      client.query(`
        SELECT schemaname, relname AS table_name, n_live_tup::BIGINT AS estimated_rows
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY relname
      `),
      client.query(`
        SELECT table_schema, table_name, ordinal_position, column_name, data_type,
               udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `),
      client.query(`
        SELECT conrelid::regclass::TEXT AS table_name, conname AS constraint_name,
               contype AS constraint_type, pg_get_constraintdef(oid, TRUE) AS definition
        FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
        ORDER BY conrelid::regclass::TEXT, conname
      `),
      client.query(`
        SELECT schemaname, tablename AS table_name, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
      `),
      client.query(`
        SELECT event_object_table AS table_name, trigger_name, action_timing,
               event_manipulation, action_statement
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY event_object_table, trigger_name, event_manipulation
      `),
      client.query(`
        SELECT p.proname AS function_name,
               pg_get_function_identity_arguments(p.oid) AS arguments,
               pg_get_functiondef(p.oid) AS definition
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY p.proname, arguments
      `),
    ]);

    const snapshot = {
      capturedAt: new Date().toISOString(),
      schema: 'public',
      tables: tables.rows,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      triggers: triggers.rows,
      functions: functions.rows,
    };

    const backupDirectory = resolve(process.cwd(), 'backups');
    mkdirSync(backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const outputPath = resolve(backupDirectory, `forest-schema-before-parity-${timestamp}.json`);
    writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    console.log(`Schema inventory written to ${outputPath}`);
    console.log(
      `Captured ${tables.rowCount} tables, ${columns.rowCount} columns, ` +
        `${constraints.rowCount} constraints, and ${functions.rowCount} functions.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
