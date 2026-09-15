/**
 * Proves create_schedule_assignments_bulk_v2 binds request IDs for exact same-visit rows.
 * Requires POSTGRES_URL_NON_POOLING. Never mutates public scheduling tables.
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
const SCHEMA = `ffts_asgn_req_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;

function createClient() {
  if (!connectionString) {
    throw new Error('ephemeral assignment request-id test requires POSTGRES_URL_NON_POOLING');
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

function ephemeralSql(relativePath: string, schema: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    .replace(/^\s*BEGIN;\s*/gmu, '')
    .replace(/^\s*COMMIT;\s*/gmu, '')
    .replace(/\bpublic\./gu, `${schema}.`);
}

function extractFunctionSql(relativePath: string, name: string, schema: string): string {
  const source = ephemeralSql(relativePath, schema);
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${schema}.${name}`);
  if (start < 0) {
    throw new Error(`missing ${name} in ${relativePath}`);
  }
  const grantNeedle = `GRANT EXECUTE ON FUNCTION ${schema}.${name}`;
  const grantAt = source.indexOf(grantNeedle, start);
  const end = source.indexOf(';', grantAt >= 0 ? grantAt : start);
  return source.slice(start, end + 1);
}

async function installFixture(client: pg.Client, schema: string) {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`
    CREATE TABLE ${schema}.schedule_jobs (
      id UUID PRIMARY KEY,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL
    );
    CREATE TABLE ${schema}.schedule_visits (
      id UUID PRIMARY KEY,
      job_id UUID NOT NULL REFERENCES ${schema}.schedule_jobs(id),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
    );
    CREATE TABLE ${schema}.schedule_employee_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID NOT NULL,
      work_date DATE NOT NULL,
      visit_id UUID,
      profile_id UUID NOT NULL,
      notes TEXT,
      conflict_override BOOLEAN NOT NULL DEFAULT FALSE,
      conflict_codes TEXT[] NOT NULL DEFAULT '{}',
      conflict_override_by UUID,
      conflict_override_at TIMESTAMPTZ,
      assigned_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE ${schema}.schedule_plant_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID NOT NULL,
      work_date DATE NOT NULL,
      visit_id UUID,
      plant_id UUID NOT NULL,
      notes TEXT,
      conflict_override BOOLEAN NOT NULL DEFAULT FALSE,
      conflict_codes TEXT[] NOT NULL DEFAULT '{}',
      conflict_override_by UUID,
      conflict_override_at TIMESTAMPTZ,
      assigned_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX schedule_plant_assignments_visit_unique_idx
      ON ${schema}.schedule_plant_assignments (visit_id, plant_id)
      WHERE visit_id IS NOT NULL;
    CREATE TABLE ${schema}.schedule_assignment_mutation_requests (
      request_id UUID PRIMARY KEY,
      action TEXT NOT NULL,
      actor_user_id UUID,
      input_hash TEXT NOT NULL,
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

describe('schedule assignment request-id PostgreSQL', () => {
  it('fails closed without POSTGRES_URL_NON_POOLING', () => {
    expect(connectionString, 'ephemeral assignment request-id test requires POSTGRES_URL_NON_POOLING').toBeTruthy();
  });

  if (!connectionString) {
    return;
  }

  const client = createClient();
  const second = createClient();
  const actorId = randomUUID();
  const jobId = randomUUID();
  const visitId = randomUUID();
  const plantA = randomUUID();
  const plantB = randomUUID();

  beforeAll(async () => {
    await client.connect();
    await second.connect();
    await installFixture(client, SCHEMA);
    await client.query(
      ephemeralSql('supabase/migrations/20260914233000_schedule_assignment_same_visit_idempotent.sql', SCHEMA)
    );
    await client.query(
      extractFunctionSql(
        'supabase/migrations/20260810214500_schedule_board_quick_add_v1.sql',
        'create_schedule_assignments_bulk_v1',
        SCHEMA
      )
    );
    await client.query(
      extractFunctionSql(
        'supabase/migrations/20260901210000_schedule_assignment_mutation_requests.sql',
        'schedule_assignment_request_replay_v2',
        SCHEMA
      )
    );
    await client.query(
      extractFunctionSql(
        'supabase/migrations/20260901210000_schedule_assignment_mutation_requests.sql',
        'create_schedule_assignments_bulk_v2',
        SCHEMA
      )
    );
    await client.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
    await second.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
    await client.query(
      `INSERT INTO ${SCHEMA}.schedule_jobs (id, start_date, end_date)
       VALUES ($1::uuid, '2099-01-01', '2099-01-07')`,
      [jobId]
    );
    await client.query(
      `INSERT INTO ${SCHEMA}.schedule_visits (id, job_id, starts_at, ends_at, status)
       VALUES ($1::uuid, $2::uuid, '2099-01-02T08:00:00Z', '2099-01-02T12:00:00Z', 'planned')`,
      [visitId, jobId]
    );
  });

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await client.end();
      await second.end();
    }
  });

  it('SCHED-ASSIGN-IDEMP-PG-003 binds an exact same-visit row and rejects a changed payload', async () => {
    const first = await client.query(
      `SELECT assignment_id::text FROM ${SCHEMA}.create_schedule_assignment_v1(
        $1::uuid, $2::uuid, 'plant', $3::uuid, '2099-01-02'::date, NULL, FALSE, '{}'::text[], $4::uuid
      )`,
      [jobId, visitId, plantA, actorId]
    );
    const existingId = first.rows[0]?.assignment_id;
    expect(existingId).toBeTruthy();

    const requestId = randomUUID();
    const bound = await client.query(
      `SELECT assignment_id::text, plant_id::text
       FROM ${SCHEMA}.create_schedule_assignments_bulk_v2(
         $5::uuid, $1::uuid, $2::uuid, 'plant', $3::uuid, ARRAY['2099-01-02']::date[],
         NULL, FALSE, '{}'::jsonb, $4::uuid
       )`,
      [jobId, visitId, plantA, actorId, requestId]
    );
    expect(bound.rows[0]?.assignment_id).toBe(existingId);
    const stored = await client.query<{ input_hash: string }>(
      `SELECT input_hash FROM ${SCHEMA}.schedule_assignment_mutation_requests WHERE request_id = $1::uuid`,
      [requestId]
    );
    expect(stored.rows).toHaveLength(1);

    await expect(
      client.query(
        `SELECT assignment_id::text
         FROM ${SCHEMA}.create_schedule_assignments_bulk_v2(
           $5::uuid, $1::uuid, $2::uuid, 'plant', $3::uuid, ARRAY['2099-01-02']::date[],
           NULL, FALSE, '{}'::jsonb, $4::uuid
         )`,
        [jobId, visitId, plantB, actorId, requestId]
      )
    ).rejects.toThrow(/REQUEST_ID_REUSED/);

    const concurrentId = randomUUID();
    const results = await Promise.allSettled([
      client.query(
        `SELECT assignment_id::text
         FROM ${SCHEMA}.create_schedule_assignments_bulk_v2(
           $5::uuid, $1::uuid, $2::uuid, 'plant', $3::uuid, ARRAY['2099-01-02']::date[],
           NULL, FALSE, '{}'::jsonb, $4::uuid
         )`,
        [jobId, visitId, plantA, actorId, concurrentId]
      ),
      second.query(
        `SELECT assignment_id::text
         FROM ${SCHEMA}.create_schedule_assignments_bulk_v2(
           $5::uuid, $1::uuid, $2::uuid, 'plant', $3::uuid, ARRAY['2099-01-02']::date[],
           NULL, FALSE, '{}'::jsonb, $4::uuid
         )`,
        [jobId, visitId, plantB, actorId, concurrentId]
      ),
    ]);
    const rejected = results.filter((result) => result.status === 'rejected');
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled.length + rejected.length).toBe(2);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(
      rejected.some((result) =>
        result.status === 'rejected' && /REQUEST_ID_REUSED/.test(String(result.reason))
      )
    ).toBe(true);
  });
});
