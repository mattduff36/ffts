/**
 * Concurrent claim/complete and required-staff writes against the real SQL.
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
const SCHEMA = `ffts_quote_claim_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;

function createClient() {
  if (!connectionString) {
    throw new Error('quote-create-claim-pg requires POSTGRES_URL_NON_POOLING');
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

describe('quote create claim and required-staff RPCs', () => {
  it('fails closed without POSTGRES_URL_NON_POOLING', () => {
    expect(connectionString, 'quote-create-claim-pg requires POSTGRES_URL_NON_POOLING').toBeTruthy();
  });

  if (!connectionString) {
    return;
  }

  const client = createClient();
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260910123000_quote_create_atomic_and_staff_tx.sql'),
    'utf8'
  );

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`
      CREATE TABLE ${SCHEMA}.quotes (
        id UUID PRIMARY KEY,
        required_staff_count SMALLINT,
        updated_by UUID,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${SCHEMA}.schedule_jobs (
        id UUID PRIMARY KEY,
        quote_id UUID REFERENCES ${SCHEMA}.quotes(id),
        required_staff_count SMALLINT,
        updated_by UUID,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${SCHEMA}.quote_create_requests (
        request_id UUID PRIMARY KEY,
        input_hash TEXT NOT NULL,
        reserved_quote_id UUID NOT NULL DEFAULT gen_random_uuid(),
        quote_id UUID REFERENCES ${SCHEMA}.quotes(id),
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(extractFunction(migration, 'quote_create_request_claim_v1'));
    await client.query(extractFunction(migration, 'quote_create_request_complete_v1'));
    await client.query(extractFunction(migration, 'set_schedule_job_required_staff_v1'));
    await client.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await client.end();
    }
  });

  it('installs claim, complete, and staff functions from the real migration', async () => {
    expect(extractFunction(migration, 'quote_create_request_claim_v1')).toContain(`${SCHEMA}.quote_create_requests`);
    const { rows } = await client.query<{ proname: string }>(
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1
         AND p.proname IN (
           'quote_create_request_claim_v1',
           'quote_create_request_complete_v1',
           'set_schedule_job_required_staff_v1'
         )
       ORDER BY p.proname`,
      [SCHEMA]
    );
    expect(rows.map((row) => row.proname)).toEqual([
      'quote_create_request_claim_v1',
      'quote_create_request_complete_v1',
      'set_schedule_job_required_staff_v1',
    ]);
  });

  it('serializes concurrent claims to one reserved quote id', async () => {
    const requestId = randomUUID();
    const inputHash = 'same-payload';
    const second = createClient();
    await second.connect();
    try {
      await second.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      const [firstClaim, secondClaim] = await Promise.all([
        client.query(
          `SELECT quote_id, reserved_quote_id, replayed
           FROM ${SCHEMA}.quote_create_request_claim_v1($1::uuid, $2, $3::uuid)`,
          [requestId, inputHash, actorId]
        ),
        second.query(
          `SELECT quote_id, reserved_quote_id, replayed
           FROM ${SCHEMA}.quote_create_request_claim_v1($1::uuid, $2, $3::uuid)`,
          [requestId, inputHash, actorId]
        ),
      ]);
      const reserved = new Set([
        firstClaim.rows[0].reserved_quote_id,
        secondClaim.rows[0].reserved_quote_id,
      ]);
      expect(reserved.size).toBe(1);
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.quote_create_requests WHERE request_id = $1`,
        [requestId]
      );
      expect(rows[0].count).toBe(1);
    } finally {
      await second.end();
    }
  });

  it('rejects a changed hash and a different actor', async () => {
    const requestId = randomUUID();
    await client.query(
      `SELECT * FROM ${SCHEMA}.quote_create_request_claim_v1($1::uuid, $2, $3::uuid)`,
      [requestId, 'hash-a', actorId]
    );
    await expect(
      client.query(
        `SELECT * FROM ${SCHEMA}.quote_create_request_claim_v1($1::uuid, $2, $3::uuid)`,
        [requestId, 'hash-b', actorId]
      )
    ).rejects.toThrow(/REQUEST_ID_REUSED/);
    await expect(
      client.query(
        `SELECT * FROM ${SCHEMA}.quote_create_request_claim_v1($1::uuid, $2, $3::uuid)`,
        [requestId, 'hash-a', otherActorId]
      )
    ).rejects.toThrow(/REQUEST_ID_ACTOR_MISMATCH/);
  });

  it('completes only the reserved quote id and updates job plus quote together', async () => {
    const requestId = randomUUID();
    const claim = await client.query<{ reserved_quote_id: string }>(
      `SELECT reserved_quote_id
       FROM ${SCHEMA}.quote_create_request_claim_v1($1::uuid, $2, $3::uuid)`,
      [requestId, 'complete-hash', actorId]
    );
    const quoteId = claim.rows[0].reserved_quote_id;
    await client.query(
      `INSERT INTO ${SCHEMA}.quotes (id) VALUES ($1::uuid)`,
      [quoteId]
    );
    await client.query(
      `SELECT ${SCHEMA}.quote_create_request_complete_v1($1::uuid, $2::uuid, $3::uuid)`,
      [requestId, quoteId, actorId]
    );
    await expect(
      client.query(
        `SELECT ${SCHEMA}.quote_create_request_complete_v1($1::uuid, $2::uuid, $3::uuid)`,
        [requestId, randomUUID(), actorId]
      )
    ).rejects.toThrow(/REQUEST_ID_REUSED/);

    const jobId = randomUUID();
    await client.query(
      `INSERT INTO ${SCHEMA}.schedule_jobs (id, quote_id) VALUES ($1::uuid, $2::uuid)`,
      [jobId, quoteId]
    );
    await client.query(
      `SELECT ${SCHEMA}.set_schedule_job_required_staff_v1($1::uuid, $2::smallint, $3::uuid)`,
      [jobId, 4, actorId]
    );
    const staff = await client.query<{ job_count: number | null; quote_count: number | null }>(
      `SELECT
         job.required_staff_count AS job_count,
         quote.required_staff_count AS quote_count
       FROM ${SCHEMA}.schedule_jobs AS job
       JOIN ${SCHEMA}.quotes AS quote ON quote.id = job.quote_id
       WHERE job.id = $1`,
      [jobId]
    );
    expect(staff.rows[0]).toEqual({ job_count: 4, quote_count: 4 });

    await expect(
      client.query(
        `SELECT ${SCHEMA}.set_schedule_job_required_staff_v1($1::uuid, $2::smallint, $3::uuid)`,
        [jobId, 21, actorId]
      )
    ).rejects.toThrow(/between 1 and 20/);
    const unchanged = await client.query<{ job_count: number | null; quote_count: number | null }>(
      `SELECT
         job.required_staff_count AS job_count,
         quote.required_staff_count AS quote_count
       FROM ${SCHEMA}.schedule_jobs AS job
       JOIN ${SCHEMA}.quotes AS quote ON quote.id = job.quote_id
       WHERE job.id = $1`,
      [jobId]
    );
    expect(unchanged.rows[0]).toEqual({ job_count: 4, quote_count: 4 });
  });
});
