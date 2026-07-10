import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260604_message_module_keys.sql';

if (!connectionString) {
  console.error('Missing database connection string');
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
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{
      module_key_exists: boolean;
      null_module_keys: string;
      legacy_web_reminders: string;
      message_constraint: string | null;
      preferences_constraint: string | null;
    }>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'messages'
            AND column_name = 'module_key'
        ) AS module_key_exists,
        (SELECT COUNT(*)::text FROM public.messages WHERE module_key IS NULL) AS null_module_keys,
        (
          SELECT COUNT(*)::text
          FROM public.messages
          WHERE type = 'REMINDER'
            AND created_via = 'web'
        ) AS legacy_web_reminders,
        (
          SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
          WHERE conrelid = 'public.messages'::regclass
            AND conname = 'messages_module_key_check'
        ) AS message_constraint,
        (
          SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
          WHERE conrelid = 'public.notification_preferences'::regclass
            AND conname = 'notification_preferences_module_key_check'
        ) AS preferences_constraint
    `);

    const verification = rows[0];
    if (
      !verification?.module_key_exists
      || verification.null_module_keys !== '0'
      || verification.legacy_web_reminders !== '0'
      || !verification.message_constraint?.includes('processed_absence')
      || !verification.preferences_constraint?.includes('processed_absence')
    ) {
      throw new Error('Message module key migration verification failed');
    }

    console.log('Message module key migration completed');
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
