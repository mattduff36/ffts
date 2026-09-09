/**
 * Quick Add replay hash/actor checks against the real wrapper SQL.
 * Requires POSTGRES_URL_NON_POOLING. Uses an ephemeral schema, never public production tables.
 */
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const { Client } = pg;
const SCHEMA = `ffts_quick_add_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;

function createClient() {
  if (!connectionString) {
    throw new Error('quick-add-staff-replay-pg requires POSTGRES_URL_NON_POOLING');
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.replace(/^\/+/u, '') || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

function extractFunction(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = sql.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing ${name} in migration`);
  }
  const end = sql.indexOf('\n$$;', start);
  if (end === -1) {
    throw new Error(`Could not close ${name}`);
  }
  return sql
    .slice(start, end + 4)
    .replace(/\bpublic\./gu, `${SCHEMA}.`);
}

describe('quick add staff wrapper replay', () => {
  it('fails closed without POSTGRES_URL_NON_POOLING', () => {
    expect(connectionString, 'quick-add-staff-replay-pg requires POSTGRES_URL_NON_POOLING').toBeTruthy();
  });

  if (!connectionString) {
    return;
  }

  const client = createClient();
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const managerId = randomUUID();
  const customerId = randomUUID();
  const requestId = randomUUID();
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260910123000_quote_create_atomic_and_staff_tx.sql'),
    'utf8'
  );

  async function callQuickAdd(title: string, actor: string, staff: number | null = 3) {
    return client.query(
      `SELECT *
       FROM ${SCHEMA}.quick_add_schedule_project_with_staff_v1(
         $1::uuid, $2::uuid, $3, NULL, NULL, $4::uuid, NULL, 'Site',
         'scheduled', '2026-07-27', '2026-07-27', 480, FALSE, ARRAY[]::uuid[],
         $5::uuid, '2026-07-27T08:00:00Z'::timestamptz, '2026-07-27T12:00:00Z'::timestamptz,
         $6::smallint
       )`,
      [requestId, managerId, title, customerId, actor, staff]
    );
  }

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`
      CREATE TABLE ${SCHEMA}.schedule_jobs (
        id UUID PRIMARY KEY,
        quote_id UUID,
        required_staff_count SMALLINT,
        updated_by UUID,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${SCHEMA}.quotes (
        id UUID PRIMARY KEY,
        required_staff_count SMALLINT,
        updated_by UUID,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${SCHEMA}.schedule_quick_add_requests (
        request_id UUID PRIMARY KEY,
        actor_user_id UUID NOT NULL,
        project_number_id UUID NOT NULL,
        schedule_job_id UUID NOT NULL,
        schedule_visit_id UUID NOT NULL,
        project_reference TEXT NOT NULL,
        was_project_created BOOLEAN NOT NULL DEFAULT TRUE,
        input_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE FUNCTION ${SCHEMA}.quick_add_schedule_project_v1(
        p_request_id UUID,
        p_manager_profile_id UUID,
        p_project_title TEXT,
        p_project_description TEXT,
        p_project_notes TEXT,
        p_customer_id UUID,
        p_customer_site_id UUID,
        p_site_address TEXT,
        p_job_status TEXT,
        p_start_date DATE,
        p_end_date DATE,
        p_estimated_duration_minutes INTEGER,
        p_is_drop_on_ready BOOLEAN,
        p_tag_ids UUID[],
        p_actor_user_id UUID,
        p_visit_starts_at TIMESTAMPTZ,
        p_visit_ends_at TIMESTAMPTZ
      )
      RETURNS TABLE (
        project_number_id UUID,
        schedule_job_id UUID,
        schedule_visit_id UUID,
        project_reference TEXT,
        was_project_created BOOLEAN
      )
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_job UUID := gen_random_uuid();
        v_visit UUID := gen_random_uuid();
        v_project UUID := gen_random_uuid();
      BEGIN
        INSERT INTO ${SCHEMA}.schedule_jobs (id) VALUES (v_job);
        INSERT INTO ${SCHEMA}.schedule_quick_add_requests (
          request_id, actor_user_id, project_number_id, schedule_job_id,
          schedule_visit_id, project_reference, was_project_created
        ) VALUES (
          p_request_id, p_actor_user_id, v_project, v_job, v_visit, '60001-MD', TRUE
        );
        RETURN QUERY SELECT v_project, v_job, v_visit, '60001-MD'::TEXT, TRUE;
      END;
      $$;
    `);
    await client.query(extractFunction(migration, 'set_schedule_job_required_staff_v1'));
    await client.query(extractFunction(migration, 'quick_add_schedule_project_with_staff_v1'));
    await client.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await client.end();
    }
  });

  it('replays the same payload and rejects a changed title or actor', async () => {
    const first = await callQuickAdd('Emergency works', actorId);
    const replay = await callQuickAdd('Emergency works', actorId);
    expect(replay.rows[0].schedule_job_id).toBe(first.rows[0].schedule_job_id);
    const staff = await client.query<{ required_staff_count: number | null }>(
      `SELECT required_staff_count FROM ${SCHEMA}.schedule_jobs WHERE id = $1`,
      [first.rows[0].schedule_job_id]
    );
    expect(staff.rows[0].required_staff_count).toBe(3);

    await expect(callQuickAdd('Changed title', actorId)).rejects.toThrow(/REQUEST_ID_REUSED/);
    await expect(callQuickAdd('Emergency works', otherActorId)).rejects.toThrow(/REQUEST_ID_ACTOR_MISMATCH/);

    const jobs = await client.query(`SELECT COUNT(*)::int AS count FROM ${SCHEMA}.schedule_jobs`);
    expect(jobs.rows[0].count).toBe(1);
    expect(staff.rows[0].required_staff_count).toBe(3);
  });
});
