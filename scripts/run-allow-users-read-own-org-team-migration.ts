import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260505_allow_users_read_own_org_team.sql';

interface VerificationProfileRow {
  id: string;
  team_id: string;
}

interface PolicyRow {
  policyname: string;
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

    const { rows: policyRows } = await client.query<PolicyRow>(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'org_teams'
        AND policyname = 'Users can read own org team';
    `);

    if (policyRows.length !== 1) {
      throw new Error('Verification failed: own-team org_teams read policy was not created');
    }

    const { rows: profileRows } = await client.query<VerificationProfileRow>(`
      SELECT id, team_id
      FROM public.profiles
      WHERE team_id IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1;
    `);

    const sampleProfile = profileRows[0];
    if (!sampleProfile) {
      console.log('Policy created; skipped RLS sample because no profiles have a team_id.');
      return;
    }

    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", ['authenticated']);
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sampleProfile.id]);

      const { rows: visibleTeamRows } = await client.query<{ id: string }>(`
        SELECT id
        FROM public.org_teams
        WHERE id = $1;
      `, [sampleProfile.team_id]);

      if (visibleTeamRows.length !== 1) {
        throw new Error('Verification failed: authenticated users still cannot read their own org team');
      }
    } finally {
      await client.query('ROLLBACK');
    }

    console.log('Own-team org_teams read policy applied and verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
