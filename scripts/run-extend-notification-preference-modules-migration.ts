import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const migrationPath = 'supabase/migrations/20260526_extend_notification_preference_modules.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

const databaseUrl = connectionString;

function buildClient(): pg.Client {
  const url = new URL(databaseUrl);

  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration(): Promise<void> {
  const client = buildClient();

  try {
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), migrationPath), 'utf8');
    await client.query(sql);

    const { rows } = await client.query<{ constraint_definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'public.notification_preferences'::regclass
        AND conname = 'notification_preferences_module_key_check'
    `);

    const constraintDefinition = rows[0]?.constraint_definition || '';
    for (const moduleKey of ['toolbox_talks', 'reminders', 'general_notifications']) {
      if (!constraintDefinition.includes(moduleKey)) {
        throw new Error(`Notification preference constraint is missing ${moduleKey}`);
      }
    }

    console.log('Notification preference modules migration completed');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Notification preference modules migration failed'
  );
  process.exit(1);
});
