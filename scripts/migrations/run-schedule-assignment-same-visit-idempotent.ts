import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260914233000_schedule_assignment_same_visit_idempotent.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

function describeTarget(urlString: string): { host: string; database: string; local: boolean } {
  const url = new URL(urlString);
  const host = url.hostname;
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres';
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return { host, database, local };
}

async function runMigration() {
  const target = describeTarget(connectionString as string);
  if (!target.local) {
    console.error(
      `Refusing to apply schedule assignment overlap migration to non-local host ${target.host} (database ${target.database}). Production apply requires explicit authorisation.`
    );
    process.exit(2);
  }

  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(
      `Applying same-visit assignment idempotency on ${target.host}/${target.database}...`
    );
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf8'));

    const { rows } = await client.query<{ definition: string | null }>(`
      SELECT pg_get_functiondef(
        'public.create_schedule_assignment_v1(uuid, uuid, text, uuid, date, text, boolean, text[], uuid)'::regprocedure
      ) AS definition
    `);
    const definition = rows[0]?.definition || '';
    if (
      !definition.includes('assignment.visit_id IS DISTINCT FROM p_visit_id')
      || !definition.includes('AND assignment.visit_id = p_visit_id')
      || !definition.includes('RESOURCE_OVERLAP')
    ) {
      throw new Error('create_schedule_assignment_v1 same-visit predicate verification failed.');
    }

    console.log('Migration complete.');
  } catch (error) {
    const normalizedError = error as { message?: string };
    console.error('Same-visit assignment migration failed:', normalizedError.message || error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error('Unexpected migration runner failure:', error);
  process.exit(1);
});
