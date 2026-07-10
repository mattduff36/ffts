import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

function getMigrationFiles(): string[] {
  const files = process.argv.slice(2).filter((argument) => argument !== '--');
  if (files.length === 0) {
    throw new Error('Pass at least one migration filename.');
  }

  for (const file of files) {
    if (basename(file) !== file || !file.endsWith('.sql')) {
      throw new Error(`Invalid migration filename: ${file}`);
    }
  }

  return files;
}

function removeOuterTransaction(sql: string): string {
  return sql
    .replace(/^\s*BEGIN;\s*/iu, '')
    .replace(/\s*COMMIT;\s*$/iu, '')
    .trim();
}

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

  const files = getMigrationFiles();

  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.template_migration_runs (
        migration_key TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const alreadyApplied = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM public.template_migration_runs WHERE migration_key = $1) AS exists',
        [file]
      );
      if (alreadyApplied.rows[0]?.exists) {
        console.log(`Skipped ${file} (already applied)`);
        continue;
      }

      const sql = removeOuterTransaction(
        readFileSync(resolve(migrationsDirectory, file), 'utf8')
      );

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.template_migration_runs (migration_key) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
