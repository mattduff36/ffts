/**
 * Executes the board_sequence migration in an ephemeral schema.
 * Requires POSTGRES_URL_NON_POOLING. Never mutates public.schedule_jobs.
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
const SCHEMA = `ffts_job_order_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;

function createClient() {
  if (!connectionString) {
    throw new Error('JOB-ORDER-MIG-002 requires POSTGRES_URL_NON_POOLING');
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

function ephemeralMigrationSql(schema: string): string {
  return readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260902130000_schedule_jobs_board_sequence.sql'),
    'utf8'
  ).replace(/\bpublic\./gu, `${schema}.`);
}

async function installJobTable(client: pg.Client, schema: string) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS ${schema};
    CREATE OR REPLACE FUNCTION ${schema}.update_updated_at_column()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;
    CREATE TABLE IF NOT EXISTS ${schema}.schedule_jobs (
      id UUID PRIMARY KEY,
      job_reference TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    DROP TRIGGER IF EXISTS set_updated_at_schedule_jobs ON ${schema}.schedule_jobs;
    CREATE TRIGGER set_updated_at_schedule_jobs
      BEFORE UPDATE ON ${schema}.schedule_jobs
      FOR EACH ROW
      EXECUTE FUNCTION ${schema}.update_updated_at_column();
  `);
}

describe('schedule jobs board_sequence migration (ephemeral)', () => {
  it('JOB-ORDER-MIG-002 fails closed without POSTGRES_URL_NON_POOLING', () => {
    expect(connectionString, 'JOB-ORDER-MIG-002 requires POSTGRES_URL_NON_POOLING').toBeTruthy();
  });

  if (!connectionString) {
    return;
  }

  const client = createClient();
  const firstId = '00000000-0000-4000-8000-000000000002';
  const secondId = '00000000-0000-4000-8000-000000000001';
  const sharedCreatedAt = '2026-01-01T00:00:00.000Z';
  const originalUpdatedAt = '2026-02-01T00:00:00.000Z';

  beforeAll(async () => {
    await client.connect();
    await installJobTable(client, SCHEMA);
    await client.query(
      `INSERT INTO ${SCHEMA}.schedule_jobs (id, job_reference, title, created_at, updated_at)
       VALUES
         ($1::uuid, 'Z-LATE', 'Z', $3::timestamptz, $4::timestamptz),
         ($2::uuid, 'A-EARLY-ID', 'A', $3::timestamptz, $4::timestamptz)`,
      [firstId, secondId, sharedCreatedAt, originalUpdatedAt]
    );
    await client.query(ephemeralMigrationSql(SCHEMA));
  });

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await client.end();
    }
  });

  it('JOB-ORDER-009: backfill is created_at then id and preserves updated_at', async () => {
    const { rows } = await client.query<{
      id: string;
      board_sequence: string;
      updated_at: string;
    }>(
      `SELECT id::text, board_sequence::text, updated_at
       FROM ${SCHEMA}.schedule_jobs
       ORDER BY board_sequence, id`
    );
    expect(rows.map((row) => row.id)).toEqual([secondId, firstId]);
    expect(rows.map((row) => Number(row.board_sequence))).toEqual([1, 2]);
    expect(rows.every((row) => new Date(row.updated_at).toISOString() === originalUpdatedAt)).toBe(
      true
    );
  });

  it('JOB-ORDER-MIG-002: rerun does not renumber populated rows', async () => {
    await client.query(ephemeralMigrationSql(SCHEMA));
    const { rows } = await client.query<{ id: string; board_sequence: string }>(
      `SELECT id::text, board_sequence::text FROM ${SCHEMA}.schedule_jobs ORDER BY board_sequence`
    );
    expect(rows.map((row) => Number(row.board_sequence))).toEqual([1, 2]);
  });

  it('JOB-ORDER-MIG-002: empty table accepts the first identity value', async () => {
    const emptySchema = `${SCHEMA}_empty`;
    const emptyClient = createClient();
    await emptyClient.connect();
    try {
      await installJobTable(emptyClient, emptySchema);
      await emptyClient.query(ephemeralMigrationSql(emptySchema));
      await emptyClient.query(
        `INSERT INTO ${emptySchema}.schedule_jobs (id, job_reference, title, created_at, updated_at)
         VALUES ($1::uuid, 'NEW', 'New', NOW(), NOW())`,
        [randomUUID()]
      );
      const { rows } = await emptyClient.query<{ board_sequence: string }>(
        `SELECT board_sequence::text FROM ${emptySchema}.schedule_jobs`
      );
      expect(rows.map((row) => Number(row.board_sequence))).toEqual([1]);
    } finally {
      await emptyClient.query(`DROP SCHEMA IF EXISTS ${emptySchema} CASCADE`);
      await emptyClient.end();
    }
  });

  it('JOB-ORDER-MIG-002: mixed nulls fail closed and do not renumber', async () => {
    const partialSchema = `${SCHEMA}_partial`;
    const partialClient = createClient();
    await partialClient.connect();
    try {
      await installJobTable(partialClient, partialSchema);
      await partialClient.query(
        `ALTER TABLE ${partialSchema}.schedule_jobs ADD COLUMN board_sequence BIGINT`
      );
      await partialClient.query(
        `INSERT INTO ${partialSchema}.schedule_jobs
           (id, job_reference, title, created_at, updated_at, board_sequence)
         VALUES
           ($1::uuid, 'HAS', 'Has', NOW(), NOW(), 9),
           ($2::uuid, 'NULL', 'Null', NOW(), NOW(), NULL)`,
        [randomUUID(), randomUUID()]
      );
      await expect(partialClient.query(ephemeralMigrationSql(partialSchema))).rejects.toThrow(
        /partially populated/i
      );
      await partialClient.query('ROLLBACK');
      const { rows } = await partialClient.query<{ board_sequence: string | null }>(
        `SELECT board_sequence::text FROM ${partialSchema}.schedule_jobs ORDER BY job_reference`
      );
      expect(rows.map((row) => row.board_sequence)).toEqual(['9', null]);
    } finally {
      try {
        await partialClient.query('ROLLBACK');
      } catch {
        // already idle
      }
      await partialClient.query(`DROP SCHEMA IF EXISTS ${partialSchema} CASCADE`);
      await partialClient.end();
    }
  });

  it('JOB-ORDER-MIG-003: inserts cannot choose and updates cannot change board_sequence', async () => {
    await expect(
      client.query(
        `INSERT INTO ${SCHEMA}.schedule_jobs
           (id, job_reference, title, created_at, updated_at, board_sequence)
         VALUES ($1::uuid, 'SUPPLIED', 'Supplied', NOW(), NOW(), 99)`,
        [randomUUID()]
      )
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "board_sequence"/i);

    await expect(
      client.query(
        `UPDATE ${SCHEMA}.schedule_jobs SET board_sequence = 50 WHERE id = $1::uuid`,
        [secondId]
      )
    ).rejects.toThrow(/can only be updated to DEFAULT/);
    await expect(
      client.query(
        `UPDATE ${SCHEMA}.schedule_jobs SET board_sequence = DEFAULT WHERE id = $1::uuid`,
        [secondId]
      )
    ).rejects.toThrow(/BOARD_SEQUENCE_IMMUTABLE/);
  });
});
