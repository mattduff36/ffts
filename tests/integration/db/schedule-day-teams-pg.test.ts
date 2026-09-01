/**
 * Concurrent membership checks against the real day-team migration RPCs.
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
const SCHEMA = `ffts_day_team_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;

function createClient() {
  if (!connectionString) {
    throw new Error('SCH-TEAM-DB-001 requires POSTGRES_URL_NON_POOLING');
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
  const raw = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260901170000_schedule_day_teams.sql'),
    'utf8'
  );
  return raw
    .replace(/^\s*BEGIN;\s*/u, '')
    .replace(/\s*COMMIT;\s*$/u, '')
    .replace(/\bpublic\./gu, `${schema}.`);
}

function isUndefinedTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: string }).code === '42P01';
}

describe('schedule day team concurrent membership (SCH-TEAM-DB-001)', () => {
  it('SCH-TEAM-DB-001 fails closed without POSTGRES_URL_NON_POOLING', () => {
    expect(connectionString, 'SCH-TEAM-DB-001 requires POSTGRES_URL_NON_POOLING').toBeTruthy();
  });

  if (!connectionString) {
    return;
  }

  const client = createClient();
  const actorId = randomUUID();

  async function insertProfile(id: string, isPlaceholder = false) {
    await client.query(
      `INSERT INTO ${SCHEMA}.profiles (id, is_placeholder) VALUES ($1::uuid, $2)`,
      [id, isPlaceholder]
    );
  }

  async function addMember(workDate: string, slot: number, profileId: string) {
    return client.query(
      `SELECT * FROM ${SCHEMA}.add_schedule_day_team_member_v1($1::date, $2::smallint, $3::uuid, $4::uuid)`,
      [workDate, slot, profileId, actorId]
    );
  }

  async function membersOn(workDate: string) {
    const { rows } = await client.query<{
      slot_index: number;
      profile_id: string;
    }>(
      `SELECT slot_index, profile_id FROM ${SCHEMA}.schedule_day_team_members WHERE work_date = $1::date ORDER BY slot_index, created_at`,
      [workDate]
    );
    return rows;
  }

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`
      CREATE TABLE ${SCHEMA}.profiles (
        id UUID PRIMARY KEY,
        is_placeholder BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE FUNCTION ${SCHEMA}.effective_module_access_level(module_key TEXT)
      RETURNS INTEGER
      LANGUAGE sql
      AS $$ SELECT 4 $$;
    `);
    try {
      await client.query(ephemeralMigrationSql(SCHEMA));
    } catch (error) {
      if (!isUndefinedTable(error)) throw error;
      throw new Error(
        `SCH-TEAM-DB-001 could not install the real migration into ${SCHEMA}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    await client.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
    await insertProfile(actorId);
  });

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await client.end();
    }
  });

  it('SCH-TEAM-DB-001 installs add and remove RPCs from the real migration file', async () => {
    const sql = ephemeralMigrationSql(SCHEMA);
    expect(sql).toContain(`${SCHEMA}.add_schedule_day_team_member_v1`);
    expect(sql).toContain(`${SCHEMA}.remove_schedule_day_team_member_v1`);
    expect(sql).toContain("hashtextextended('schedule-day-team:' || p_work_date::TEXT, 0)");
    expect(sql).not.toContain('CREATE FUNCTION add_member');
    const { rows } = await client.query<{ proname: string }>(
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1
         AND p.proname IN ('add_schedule_day_team_member_v1', 'remove_schedule_day_team_member_v1')
       ORDER BY p.proname`,
      [SCHEMA]
    );
    expect(rows.map((row) => row.proname)).toEqual([
      'add_schedule_day_team_member_v1',
      'remove_schedule_day_team_member_v1',
    ]);
  });

  it('rejects missing and placeholder profiles', async () => {
    const workDate = '2099-01-01';
    const missingId = randomUUID();
    await expect(addMember(workDate, 1, missingId)).rejects.toThrow(/TEAM_PROFILE_INVALID/);

    const placeholderId = randomUUID();
    await insertProfile(placeholderId, true);
    await expect(addMember(workDate, 1, placeholderId)).rejects.toThrow(/TEAM_PROFILE_INVALID/);
    expect(await membersOn(workDate)).toEqual([]);
  });

  it('treats a same-slot add as idempotent', async () => {
    const workDate = '2099-01-02';
    const profileId = randomUUID();
    await insertProfile(profileId);
    const first = await addMember(workDate, 1, profileId);
    const second = await addMember(workDate, 1, profileId);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(1);
    expect(await membersOn(workDate)).toEqual([{ slot_index: 1, profile_id: profileId }]);
  });

  it('leaves prior membership unchanged when the target slot is full', async () => {
    const workDate = '2099-01-03';
    const occupantIds = Array.from({ length: 6 }, () => randomUUID());
    const moverId = randomUUID();
    for (const id of [...occupantIds, moverId]) {
      await insertProfile(id);
    }
    for (const id of occupantIds) {
      await addMember(workDate, 2, id);
    }
    await addMember(workDate, 1, moverId);
    await expect(addMember(workDate, 2, moverId)).rejects.toThrow(/TEAM_SLOT_FULL/);
    const rows = await membersOn(workDate);
    expect(rows.filter((row) => row.slot_index === 2).map((row) => row.profile_id).sort()).toEqual(
      [...occupantIds].sort()
    );
    expect(rows.filter((row) => row.profile_id === moverId)).toEqual([
      { slot_index: 1, profile_id: moverId },
    ]);
  });

  it('blocks remove while another session holds the per-date advisory lock', async () => {
    const workDate = '2099-01-04';
    const profileId = randomUUID();
    await insertProfile(profileId);
    await addMember(workDate, 1, profileId);

    const locker = createClient();
    const remover = createClient();
    await locker.connect();
    await remover.connect();
    try {
      await locker.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      await remover.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      await locker.query('BEGIN');
      await locker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('schedule-day-team:' || $1::text, 0))`,
        [workDate]
      );
      await remover.query(`SET statement_timeout = '800ms'`);
      await expect(
        remover.query(
          `SELECT * FROM ${SCHEMA}.remove_schedule_day_team_member_v1($1::date, 1::smallint, $2::uuid, $3::uuid)`,
          [workDate, profileId, actorId]
        )
      ).rejects.toMatchObject({
        code: '57014',
      });

      await locker.query('COMMIT');
      await remover.query('SET statement_timeout = 0');
      const removed = await remover.query(
        `SELECT * FROM ${SCHEMA}.remove_schedule_day_team_member_v1($1::date, 1::smallint, $2::uuid, $3::uuid)`,
        [workDate, profileId, actorId]
      );
      expect(removed.rows).toHaveLength(1);
      expect(await membersOn(workDate)).toEqual([]);
    } finally {
      try {
        await locker.query('ROLLBACK');
      } catch {
        // already committed
      }
      await locker.end();
      await remover.end();
    }
  });

  it('serializes two concurrent sixth-seat adds so exactly one succeeds', async () => {
    const workDate = '2099-12-31';
    const ids = Array.from({ length: 7 }, () => randomUUID());
    for (const profileId of ids) {
      await insertProfile(profileId);
    }
    for (const profileId of ids.slice(0, 5)) {
      await addMember(workDate, 1, profileId);
    }

    const locker = createClient();
    const first = createClient();
    const second = createClient();
    await locker.connect();
    await first.connect();
    await second.connect();
    try {
      await locker.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      await first.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      await second.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      await locker.query('BEGIN');
      await locker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('schedule-day-team:' || $1::text, 0))`,
        [workDate]
      );

      const firstAdd = first.query(
        `SELECT * FROM ${SCHEMA}.add_schedule_day_team_member_v1($1::date, 1::smallint, $2::uuid, $3::uuid)`,
        [workDate, ids[5], actorId]
      );
      const secondAdd = second.query(
        `SELECT * FROM ${SCHEMA}.add_schedule_day_team_member_v1($1::date, 1::smallint, $2::uuid, $3::uuid)`,
        [workDate, ids[6], actorId]
      );

      const waitDeadline = Date.now() + 8000;
      let waiterCount = 0;
      while (Date.now() < waitDeadline) {
        const waiting = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM pg_locks
           WHERE locktype = 'advisory'
             AND NOT granted`
        );
        waiterCount = Number(waiting.rows[0].count);
        if (waiterCount >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiterCount).toBeGreaterThanOrEqual(2);

      await locker.query('COMMIT');
      const attempts = await Promise.allSettled([firstAdd, secondAdd]);
      const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
      const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/TEAM_SLOT_FULL/);
      expect(await membersOn(workDate)).toHaveLength(6);
    } finally {
      try {
        await locker.query('ROLLBACK');
      } catch {
        // already committed
      }
      await locker.end();
      await first.end();
      await second.end();
    }
  });

  it('keeps exclusive membership when concurrent moves target different slots', async () => {
    const moveDate = '2099-12-30';
    const profileId = randomUUID();
    await insertProfile(profileId);
    await addMember(moveDate, 1, profileId);

    const first = createClient();
    const second = createClient();
    await first.connect();
    await second.connect();
    try {
      await first.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      await second.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
      await Promise.all([
        first.query(
          `SELECT * FROM ${SCHEMA}.add_schedule_day_team_member_v1($1::date, 2::smallint, $2::uuid, $3::uuid)`,
          [moveDate, profileId, actorId]
        ),
        second.query(
          `SELECT * FROM ${SCHEMA}.add_schedule_day_team_member_v1($1::date, 3::smallint, $2::uuid, $3::uuid)`,
          [moveDate, profileId, actorId]
        ),
      ]);
      const moved = await membersOn(moveDate);
      expect(moved).toHaveLength(1);
      expect([2, 3]).toContain(moved[0].slot_index);
      expect(moved[0].profile_id).toBe(profileId);
    } finally {
      await first.end();
      await second.end();
    }
  });
});

