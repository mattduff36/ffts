/**
 * Team-settings RPC checks against the real unreleased migration.
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
const SCHEMA = `ffts_team_settings_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;

function createClient() {
  if (!connectionString) {
    throw new Error('sched-team-capacity-leader requires POSTGRES_URL_NON_POOLING');
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
    resolve(process.cwd(), 'supabase/migrations/20260904120000_schedule_team_settings.sql'),
    'utf8'
  );
  return raw
    .replace(/^\s*BEGIN;\s*/u, '')
    .replace(/\s*COMMIT;\s*$/u, '')
    .replace(/\bpublic\./gu, `${schema}.`);
}

describe('schedule team settings save capacity', () => {
  it('fails closed without POSTGRES_URL_NON_POOLING', () => {
    expect(connectionString, 'sched-team-capacity-leader requires POSTGRES_URL_NON_POOLING').toBeTruthy();
  });

  if (!connectionString) {
    return;
  }

  const client = createClient();
  const actorId = randomUUID();

  async function insertProfile(id: string) {
    await client.query(
      `INSERT INTO ${SCHEMA}.profiles (id, is_placeholder) VALUES ($1::uuid, FALSE)`,
      [id]
    );
  }

  async function addMember(workDate: string, slot: number, profileId: string) {
    return client.query(
      `SELECT * FROM ${SCHEMA}.add_schedule_day_team_member_v1($1::date, $2::smallint, $3::uuid, $4::uuid)`,
      [workDate, slot, profileId, actorId]
    );
  }

  async function saveSettings(
    visibleSlotCount: number,
    leaders: Array<{ slot_index: number; profile_id: string | null }>
  ) {
    return client.query(
      `SELECT * FROM ${SCHEMA}.save_schedule_team_settings_v1($1::smallint, $2::jsonb, $3::uuid)`,
      [visibleSlotCount, JSON.stringify(leaders), actorId]
    );
  }

  async function membersOn(workDate: string) {
    const { rows } = await client.query<{
      slot_index: number;
      profile_id: string;
    }>(
      `SELECT slot_index, profile_id
       FROM ${SCHEMA}.schedule_day_team_members
       WHERE work_date = $1::date
       ORDER BY slot_index, created_at`,
      [workDate]
    );
    return rows;
  }

  async function settingsSnapshot() {
    const settings = await client.query<{ visible_slot_count: number }>(
      `SELECT visible_slot_count FROM ${SCHEMA}.schedule_team_settings WHERE id = TRUE`
    );
    const leaders = await client.query<{ slot_index: number; profile_id: string }>(
      `SELECT slot_index, profile_id FROM ${SCHEMA}.schedule_team_slot_leaders ORDER BY slot_index`
    );
    return {
      visible_slot_count: settings.rows[0]?.visible_slot_count ?? null,
      leaders: leaders.rows,
    };
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
    await client.query(ephemeralMigrationSql(SCHEMA));
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

  it('sched-team-capacity-leader sched-team-capacity-save-overflow rejects a leader that would overflow a full daily slot', async () => {
    const workDate = '2099-03-01';
    const occupantIds = Array.from({ length: 6 }, () => randomUUID());
    const leaderId = randomUUID();
    for (const id of [...occupantIds, leaderId]) {
      await insertProfile(id);
    }
    for (const id of occupantIds) {
      await addMember(workDate, 1, id);
    }

    const before = await settingsSnapshot();
    await expect(
      saveSettings(5, [{ slot_index: 1, profile_id: leaderId }])
    ).rejects.toThrow(/TEAM_SLOT_FULL/);

    expect(await settingsSnapshot()).toEqual(before);
    expect((await membersOn(workDate)).map((row) => row.profile_id).sort()).toEqual(
      [...occupantIds].sort()
    );
  });

  it('allows a leader who already occupies one of the six daily seats', async () => {
    await client.query(`DELETE FROM ${SCHEMA}.schedule_day_team_members`);
    await client.query(`DELETE FROM ${SCHEMA}.schedule_team_slot_leaders`);
    const workDate = '2099-03-02';
    const occupantIds = Array.from({ length: 6 }, () => randomUUID());
    for (const id of occupantIds) {
      await insertProfile(id);
    }
    for (const id of occupantIds) {
      await addMember(workDate, 1, id);
    }

    await saveSettings(5, [{ slot_index: 1, profile_id: occupantIds[0] }]);

    expect(await settingsSnapshot()).toEqual({
      visible_slot_count: 5,
      leaders: [{ slot_index: 1, profile_id: occupantIds[0] }],
    });
    expect((await membersOn(workDate)).map((row) => row.profile_id).sort()).toEqual(
      occupantIds.slice(1).sort()
    );
  });
});
