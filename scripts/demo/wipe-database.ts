/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { Client } from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

function getProjectRef(supabaseUrl: string): string | null {
  return supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1] ?? null;
}

function assertWipeAllowed(): { supabaseUrl: string; connectionString: string; serviceRoleKey: string } {
  const appMode = process.env.APP_MODE || process.env.NEXT_PUBLIC_APP_MODE;
  const confirmed = process.env.DEMO_RESET_CONFIRM === 'RESET_DEMO_DATABASE';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const expectedProjectRef = process.env.DEMO_SUPABASE_PROJECT_REF || '';
  const actualProjectRef = getProjectRef(supabaseUrl);
  const isLocalProject = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1');

  if (appMode !== 'demo') {
    throw new Error('demo:wipe-database can only run when APP_MODE or NEXT_PUBLIC_APP_MODE is demo.');
  }

  if (!confirmed) {
    throw new Error('Set DEMO_RESET_CONFIRM=RESET_DEMO_DATABASE to confirm this destructive database wipe.');
  }

  if (!supabaseUrl || !connectionString || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL, POSTGRES_URL_NON_POOLING, and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  if (!isLocalProject && (!actualProjectRef || actualProjectRef !== expectedProjectRef)) {
    throw new Error('Refusing to wipe database because DEMO_SUPABASE_PROJECT_REF does not match NEXT_PUBLIC_SUPABASE_URL.');
  }

  return { supabaseUrl, connectionString, serviceRoleKey };
}

async function wipePublicSchema(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;

      GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
      GRANT ALL ON SCHEMA public TO postgres, service_role;

      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role;
    `);
  } finally {
    await client.end();
  }
}

async function deleteAuthUsers(supabaseUrl: string, serviceRoleKey: string): Promise<void> {
  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let page = 1;
  let deleted = 0;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    if (data.users.length === 0) break;

    for (const user of data.users) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) throw deleteError;
      deleted += 1;
    }

    if (data.users.length < 1000) break;
    page += 1;
  }

  console.log(`Deleted ${deleted} auth user(s).`);
}

async function main() {
  const { supabaseUrl, connectionString, serviceRoleKey } = assertWipeAllowed();

  console.log('Wiping public schema for dedicated demo database...');
  await wipePublicSchema(connectionString);

  console.log('Deleting auth users for dedicated demo database...');
  await deleteAuthUsers(supabaseUrl, serviceRoleKey);

  console.log('Demo database wipe complete. Next: npm run db:baseline && npm run db:validate');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
