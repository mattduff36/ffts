/**
 * Real PostgreSQL locks/RPCs in a disposable local-only database, never .env.local.
 * SCHEDULING_TEST_POSTGRES_URL must name a dedicated loopback test database.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString = process.env.SCHEDULING_TEST_POSTGRES_URL;
const schema = `ffts_removal_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const actorId = randomUUID();
const employeeId = randomUUID();
const otherEmployeeId = randomUUID();
const jobId = randomUUID();
const visitId = randomUUID();
const otherVisitId = randomUUID();
const nextDayVisitId = randomUUID();
const workDate = '2099-01-02';

function createClient() {
  if (!connectionString) throw new Error('SCHEDULING_TEST_POSTGRES_URL is required (dedicated local database only)');
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !url.pathname.startsWith('/ffts_scheduling_test')) {
    throw new Error('Refusing non-local/non-test PostgreSQL target');
  }
  return new pg.Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
    statement_timeout: 2000,
  });
}

function migration(name: string) {
  return readFileSync(resolve('supabase', 'migrations', name), 'utf8')
    .replace(/^\s*(BEGIN|COMMIT);\s*/gmu, '')
    .replace(/\bpublic\./gu, `${schema}.`);
}

function functionSql(file: string, name: string) {
  const sql = migration(file);
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${schema}.${name}(`);
  const end = sql.indexOf('\n$$;', start);
  if (start < 0 || end < 0) throw new Error(`Missing real function ${name}`);
  return sql.slice(start, end + 4);
}

describe('atomic team removal on disposable local PostgreSQL', () => {
  it('requires an explicit local-only test target', () => {
    expect(connectionString, 'Set SCHEDULING_TEST_POSTGRES_URL to a dedicated local test database').toBeTruthy();
    expect(() => createClient()).not.toThrow();
  });
  if (!connectionString) return;

  const client = createClient();
  let installed = false;

  async function connectedClient() {
    const session = createClient();
    await session.connect();
    return session;
  }

  async function remove(session = client, ids: string[] | null = []) {
    return session.query(
      `SELECT * FROM ${schema}.remove_schedule_day_team_member_with_assignments_v1(
        $1::date, 1::smallint, $2::uuid, $3::uuid, $4::uuid[])`,
      [workDate, employeeId, actorId, ids]
    );
  }

  async function reset() {
    await client.query(`
      TRUNCATE ${schema}.schedule_employee_assignments, ${schema}.schedule_plant_assignments,
        ${schema}.schedule_day_team_members, ${schema}.schedule_team_slot_leaders;
      INSERT INTO ${schema}.schedule_day_team_members (work_date, slot_index, profile_id, added_by)
        VALUES ('${workDate}', 1, '${employeeId}', '${actorId}');
    `);
  }

  async function assign(session = client, resourceId = employeeId, targetVisitId = visitId) {
    const result = await session.query<{ assignment_id: string }>(
      `SELECT * FROM ${schema}.create_schedule_assignment_v1(
        $1::uuid, $2::uuid, 'employee', $3::uuid, $4::date, NULL, FALSE, '{}', $5::uuid)`,
      [jobId, targetVisitId, resourceId, workDate, actorId]
    );
    return result.rows[0].assignment_id;
  }

  async function membershipCount() {
    const result = await client.query<{ count: string }>(
      `SELECT count(*) FROM ${schema}.schedule_day_team_members
       WHERE work_date = $1 AND profile_id = $2`, [workDate, employeeId]
    );
    return Number(result.rows[0].count);
  }

  async function assignmentIds() {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM ${schema}.schedule_employee_assignments ORDER BY id`
    );
    return result.rows.map((row) => row.id);
  }

  beforeAll(async () => {
    await client.connect();
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      END $$;
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.profiles (id UUID PRIMARY KEY, is_placeholder BOOLEAN NOT NULL DEFAULT FALSE);
      CREATE FUNCTION ${schema}.effective_module_access_level(TEXT) RETURNS INTEGER LANGUAGE sql AS $$ SELECT 4 $$;
      INSERT INTO ${schema}.profiles (id) VALUES ('${actorId}'), ('${employeeId}'), ('${otherEmployeeId}');
      CREATE TABLE ${schema}.schedule_jobs (id UUID PRIMARY KEY, start_date DATE, end_date DATE);
      CREATE TABLE ${schema}.schedule_visits (
        id UUID PRIMARY KEY, job_id UUID REFERENCES ${schema}.schedule_jobs,
        starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'planned'
      );
      CREATE TABLE ${schema}.schedule_visit_backlog (visit_id UUID PRIMARY KEY);
      CREATE TABLE ${schema}.schedule_employee_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID NOT NULL, work_date DATE NOT NULL,
        visit_id UUID, profile_id UUID NOT NULL, notes TEXT,
        conflict_override BOOLEAN NOT NULL DEFAULT FALSE, conflict_codes TEXT[] NOT NULL DEFAULT '{}',
        conflict_override_by UUID, conflict_override_at TIMESTAMPTZ, assigned_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE ${schema}.schedule_plant_assignments (
        LIKE ${schema}.schedule_employee_assignments INCLUDING ALL
      );
      ALTER TABLE ${schema}.schedule_plant_assignments RENAME COLUMN profile_id TO plant_id;
      CREATE UNIQUE INDEX ON ${schema}.schedule_employee_assignments (visit_id, profile_id) WHERE visit_id IS NOT NULL;
      INSERT INTO ${schema}.schedule_jobs VALUES ('${jobId}', '2099-01-01', '2099-01-07');
      INSERT INTO ${schema}.schedule_visits (id, job_id, starts_at, ends_at) VALUES
        ('${visitId}', '${jobId}', '${workDate}T08:00:00Z', '${workDate}T12:00:00Z'),
        ('${otherVisitId}', '${jobId}', '${workDate}T13:00:00Z', '${workDate}T16:00:00Z'),
        ('${nextDayVisitId}', '${jobId}', '2099-01-03T08:00:00Z', '2099-01-03T12:00:00Z');
    `);
    installed = true;
    await client.query(migration('20260904120000_schedule_team_settings.sql'));
    await client.query(migration('20260914233000_schedule_assignment_same_visit_idempotent.sql'));
    await client.query(functionSql('20260810214500_schedule_board_quick_add_v1.sql', 'move_schedule_assignment_v1'));
    await client.query(migration('20261105121000_schedule_assignment_move_column_qualification.sql'));
    await client.query(functionSql('20260811001500_schedule_visit_backlog.sql', 'lock_and_guard_schedule_assignment_backlog_v1'));
    await client.query(`
      CREATE TRIGGER guard_employee_assignment_backlog BEFORE INSERT OR UPDATE OR DELETE
        ON ${schema}.schedule_employee_assignments FOR EACH ROW
        EXECUTE FUNCTION ${schema}.lock_and_guard_schedule_assignment_backlog_v1();
    `);
    await client.query(migration('20261105120000_schedule_team_member_assignment_removal.sql'));
  });

  afterAll(async () => {
    try {
      if (installed) await client.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await client.end();
    }
  });

  it('removes membership and exactly the confirmed employee/day assignments, retaining plant, dates and visits', async () => {
    await reset();
    const first = await assign();
    const second = await assign(client, employeeId, otherVisitId);
    const other = await assign(client, otherEmployeeId);
    const nextDay = randomUUID();
    await client.query(`
      INSERT INTO ${schema}.schedule_employee_assignments (id, job_id, work_date, profile_id)
        VALUES ('${nextDay}', '${jobId}', '2099-01-03', '${employeeId}');
      INSERT INTO ${schema}.schedule_plant_assignments (job_id, work_date, plant_id)
        VALUES ('${jobId}', '${workDate}', '${randomUUID()}');
    `);
    expect((await remove(client, [second, first, first])).rows).toEqual([{
      success: true, removed_assignment_ids: [first, second].sort(),
    }]);
    expect(await membershipCount()).toBe(0);
    expect(await assignmentIds()).toEqual([other, nextDay].sort());
    expect((await client.query(`SELECT * FROM ${schema}.schedule_plant_assignments`)).rows).toHaveLength(1);
    expect((await client.query(`SELECT * FROM ${schema}.schedule_visits`)).rows).toHaveLength(3);
  });

  it('rejects stale/missing/unrelated confirmation IDs and rolls back membership', async () => {
    await reset();
    const id = await assign();
    for (const ids of [null, [], [randomUUID()], [id, randomUUID()]]) {
      await expect(remove(client, ids)).rejects.toThrow('TEAM_ASSIGNMENTS_CHANGED');
      expect(await membershipCount()).toBe(1);
      expect(await assignmentIds()).toEqual([id]);
    }
  });

  it('permits an explicitly confirmed empty day and rejects changed membership/standing leaders', async () => {
    await reset();
    expect((await remove()).rows).toEqual([{ success: true, removed_assignment_ids: [] }]);
    await expect(remove()).rejects.toThrow('TEAM_MEMBER_CHANGED');
    await reset();
    await client.query(`INSERT INTO ${schema}.schedule_team_slot_leaders VALUES (1, '${employeeId}', NOW())`);
    await expect(remove()).rejects.toThrow('TEAM_LEADER_LOCKED');
    expect(await membershipCount()).toBe(1);
  });

  it.each(['visit', 'assignment', 'resource-day'] as const)(
    'rejects %s contention without waiting in an inverted lock order or partially removing membership',
    async (lock) => {
      await reset();
      const id = await assign();
      const locker = await connectedClient();
      const remover = await connectedClient();
      try {
        await locker.query('BEGIN');
        if (lock === 'visit') {
          await locker.query(`SELECT * FROM ${schema}.schedule_visits WHERE id = $1 FOR UPDATE`, [visitId]);
        } else if (lock === 'assignment') {
          await locker.query(`SELECT * FROM ${schema}.schedule_employee_assignments WHERE id = $1 FOR UPDATE`, [id]);
        } else {
          await locker.query(
            `SELECT pg_advisory_xact_lock(hashtextextended('employee:' || $1::text || ':' || $2::text, 0))`,
            [employeeId, workDate]
          );
        }
        await expect(remove(remover, [id])).rejects.toThrow('TEAM_ASSIGNMENTS_CHANGED');
        expect(await membershipCount()).toBe(1);
        expect(await assignmentIds()).toEqual([id]);
        if (lock === 'visit') {
          // A real creator takes this visit before the resource-day advisory lock.
          expect(await assign(locker)).toBe(id);
        }
      } finally {
        await locker.query('ROLLBACK');
        await locker.end();
        await remover.end();
      }
      expect((await remove(client, [id])).rows[0].success).toBe(true);
    }
  );

  it('rechecks the committed set after a concurrent actual create and move', async () => {
    await reset();
    const first = await assign();
    const creator = await connectedClient();
    try {
      await creator.query('BEGIN');
      const second = await assign(creator, employeeId, otherVisitId);
      await expect(remove(client, [first])).rejects.toThrow('TEAM_ASSIGNMENTS_CHANGED');
      await creator.query('COMMIT');
      await expect(remove(client, [first])).rejects.toThrow('TEAM_ASSIGNMENTS_CHANGED');
      expect(await membershipCount()).toBe(1);
      await creator.query('BEGIN');
      await creator.query(
        `SELECT * FROM ${schema}.move_schedule_assignment_v1($1, 'employee', $2, TRUE, '{}', $3)`,
        [second, nextDayVisitId, actorId]
      );
      await expect(remove(client, [first, second])).rejects.toThrow('TEAM_ASSIGNMENTS_CHANGED');
      await creator.query('COMMIT');
      await expect(remove(client, [first, second])).rejects.toThrow('TEAM_ASSIGNMENTS_CHANGED');
      expect((await remove(client, [first])).rows[0].success).toBe(true);
      expect(await assignmentIds()).toEqual([second]);
    } finally {
      await creator.query('ROLLBACK');
      await creator.end();
    }
  });

  it('grants execution only to service_role', async () => {
    const signature = `${schema}.remove_schedule_day_team_member_with_assignments_v1(date,smallint,uuid,uuid,uuid[])`;
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const result = await client.query<{ allowed: boolean }>(
        'SELECT has_function_privilege($1, $2, $3) AS allowed', [role, signature, 'EXECUTE']
      );
      expect(result.rows[0].allowed).toBe(role === 'service_role');
    }
  });

  it('moves plant assignments with qualified resource columns under the default PostgreSQL policy', async () => {
    await reset();
    const id = randomUUID();
    const plantId = randomUUID();
    await client.query(
      `INSERT INTO ${schema}.schedule_plant_assignments (id, job_id, work_date, visit_id, plant_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, jobId, workDate, visitId, plantId]
    );
    const result = await client.query(
      `SELECT * FROM ${schema}.move_schedule_assignment_v1($1, 'plant', $2, FALSE, '{}', $3)`,
      [id, nextDayVisitId, actorId]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      assignment_id: id, resource_type: 'plant', plant_id: plantId, profile_id: null,
      visit_id: nextDayVisitId, job_id: jobId, assigned_by: actorId,
    });
    expect((await client.query(
      `SELECT work_date::text FROM ${schema}.schedule_plant_assignments WHERE id = $1`, [id]
    )).rows).toEqual([{ work_date: '2099-01-03' }]);
  });
});
