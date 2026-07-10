/**
 * Force Sign-Out User
 *
 * Uses the Supabase Admin API to invalidate ALL active sessions for a given
 * user email. Run this when a user has left a stale browser tab open running
 * an old deployment — their next page interaction will redirect to login,
 * where they'll load the current bundle.
 *
 * Usage:
 *   npx tsx scripts/force-signout-user.ts user@example.test
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const TARGET_EMAIL = process.argv[2]?.trim();
if (!TARGET_EMAIL || !TARGET_EMAIL.includes('@')) {
  throw new Error(
    'Provide the user email explicitly: npx tsx scripts/force-signout-user.ts user@example.test'
  );
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function forceSignOut() {
  console.log(`\n🔍 Looking up user: ${TARGET_EMAIL}\n`);

  const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  const user = data.users.find((u) => u.email?.toLowerCase() === TARGET_EMAIL.toLowerCase());
  if (!user) {
    console.error(`❌ No user found with email: ${TARGET_EMAIL}`);
    process.exit(1);
  }

  console.log(`✅ Found user:`);
  console.log(`   ID:           ${user.id}`);
  console.log(`   Email:        ${user.email}`);
  console.log(`   Last sign-in: ${user.last_sign_in_at || 'never'}\n`);

  // admin.signOut(jwt) requires an active JWT, not a user ID.
  // Instead we delete the user's sessions and refresh tokens directly from
  // the auth schema via a service-role DB connection.
  const url = new URL(process.env.POSTGRES_URL_NON_POOLING!);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`🔌 Connected to database\n`);

  // Count active sessions first
  const { rows: sessions } = await client.query(
    `SELECT id, created_at, updated_at FROM auth.sessions WHERE user_id = $1`,
    [user.id]
  );
  console.log(`   Active sessions found: ${sessions.length}`);
  for (const s of sessions) {
    console.log(`     session ${s.id}  created=${s.created_at}  updated=${s.updated_at}`);
  }

  const { rows: tokens } = await client.query(
    `SELECT id, created_at, updated_at, revoked FROM auth.refresh_tokens WHERE user_id = $1 AND revoked = false`,
    [user.id]
  );
  console.log(`   Active refresh tokens: ${tokens.length}\n`);

  if (sessions.length === 0 && tokens.length === 0) {
    console.log('ℹ️  No active sessions or tokens — user is already signed out on the server.');
    await client.end();
    return;
  }

  console.log(`🔒 Revoking all sessions and refresh tokens for ${TARGET_EMAIL}…`);

  // Revoke refresh tokens first (cascade-safe order)
  await client.query(
    `UPDATE auth.refresh_tokens SET revoked = true, updated_at = NOW() WHERE user_id = $1 AND revoked = false`,
    [user.id]
  );

  // Delete sessions
  const { rowCount } = await client.query(
    `DELETE FROM auth.sessions WHERE user_id = $1`,
    [user.id]
  );

  await client.end();

  console.log(`✅ Done:`);
  console.log(`   Sessions deleted:        ${rowCount}`);
  console.log(`   Refresh tokens revoked:  ${tokens.length}`);
  console.log(`\n   ${TARGET_EMAIL}'s next page interaction will redirect to login,`);
  console.log(`   where the current bundle will be loaded fresh.\n`);
}

forceSignOut().catch((err) => {
  console.error('💥 Unexpected error:', err);
  process.exit(1);
});
