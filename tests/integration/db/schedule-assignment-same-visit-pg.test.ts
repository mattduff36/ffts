/**
 * Executes create_schedule_assignment_v1 same-visit semantics in an ephemeral schema.
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
const SCHEMA = `ffts_asgn_visit_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;

function createClient() {
  if (!connectionString) {
    throw new Error('ephemeral assignment SQL test requires POSTGRES_URL_NON_POOLING');
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
    resolve(
      process.cwd(),
      'supabase/migrations/20260914233000_schedule_assignment_same_visit_idempotent.sql'
    ),
    'utf8'
  )
    .replace(/^\s*BEGIN;\s*/gmu, '')
    .replace(/^\s*COMMIT;\s*/gmu, '')
    .replace(/\bpublic\./gu, `${schema}.`);
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
    CREATE UNIQUE INDEX schedule_employee_assignments_visit_unique_idx
      ON ${schema}.schedule_employee_assignments (visit_id, profile_id)
      WHERE visit_id IS NOT NULL;
    CREATE UNIQUE INDEX schedule_employee_assignments_legacy_unique_idx
      ON ${schema}.schedule_employee_assignments (job_id, work_date, profile_id)
      WHERE visit_id IS NULL;
    CREATE UNIQUE INDEX schedule_plant_assignments_visit_unique_idx
      ON ${schema}.schedule_plant_assignments (visit_id, plant_id)
      WHERE visit_id IS NOT NULL;
    CREATE UNIQUE INDEX schedule_plant_assignments_legacy_unique_idx
      ON ${schema}.schedule_plant_assignments (job_id, work_date, plant_id)
      WHERE visit_id IS NULL;
  `);
}

describe('schedule assignment same-visit PostgreSQL', () => {
  it('fails closed without POSTGRES_URL_NON_POOLING', () => {
    expect(connectionString, 'ephemeral assignment SQL test requires POSTGRES_URL_NON_POOLING').toBeTruthy();
  });

  if (!connectionString) {
    return;
  }

  const client = createClient();
  const actorId = randomUUID();
  const jobId = randomUUID();
  const visitA = randomUUID();
  const visitOverlap = randomUUID();
  const plantA = randomUUID();
  const plantB = randomUUID();
  const employeeId = randomUUID();

  async function createAssignment(
    resourceType: 'employee' | 'plant',
    resourceId: string,
    visitId: string | null,
    override = false
  ) {
    return client.query(
      `SELECT * FROM ${SCHEMA}.create_schedule_assignment_v1(
        $1::uuid, $2::uuid, $3::text, $4::uuid, $5::date, $6::text, $7::boolean, $8::text[], $9::uuid
      )`,
      [
        jobId,
        visitId,
        resourceType,
        resourceId,
        '2099-01-02',
        null,
        override,
        [],
        actorId,
      ]
    );
  }

  beforeAll(async () => {
    await client.connect();
    await installFixture(client, SCHEMA);
    await client.query(ephemeralMigrationSql(SCHEMA));
    await client.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
    await client.query(
      `INSERT INTO ${SCHEMA}.schedule_jobs (id, start_date, end_date)
       VALUES ($1::uuid, '2099-01-01', '2099-01-07')`,
      [jobId]
    );
    await client.query(
      `INSERT INTO ${SCHEMA}.schedule_visits (id, job_id, starts_at, ends_at, status)
       VALUES
         ($1::uuid, $3::uuid, '2099-01-02T08:00:00Z', '2099-01-02T12:00:00Z', 'planned'),
         ($2::uuid, $3::uuid, '2099-01-02T11:00:00Z', '2099-01-02T15:00:00Z', 'planned')`,
      [visitA, visitOverlap, jobId]
    );
  });

  afterAll(async () => {
    try {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await client.end();
    }
  });

  it('installs the replaced create function from the new migration', async () => {
    const sql = ephemeralMigrationSql(SCHEMA);
    expect(sql).toContain(`${SCHEMA}.create_schedule_assignment_v1`);
    expect(sql).toContain('assignment.visit_id IS DISTINCT FROM p_visit_id');
    const { rows } = await client.query<{ proname: string }>(
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 AND p.proname = 'create_schedule_assignment_v1'`,
      [SCHEMA]
    );
    expect(rows).toHaveLength(1);
  });

  it('SCHED-ASSIGN-SQL-001 allows two plants, returns the same-visit row, and rejects other-visit overlap', async () => {
    const first = await createAssignment('plant', plantA, visitA);
    const secondPlant = await createAssignment('plant', plantB, visitA);
    const repeat = await createAssignment('plant', plantA, visitA);
    expect(first.rows).toHaveLength(1);
    expect(secondPlant.rows).toHaveLength(1);
    expect(secondPlant.rows[0]?.plant_id).toBe(plantB);
    expect(repeat.rows[0]?.assignment_id).toBe(first.rows[0]?.assignment_id);
    const { rows } = await client.query<{ plant_id: string }>(
      `SELECT plant_id::text FROM ${SCHEMA}.schedule_plant_assignments WHERE visit_id = $1::uuid ORDER BY plant_id`,
      [visitA]
    );
    expect(rows.map((row) => row.plant_id).sort()).toEqual([plantA, plantB].sort());

    await expect(createAssignment('plant', plantA, visitOverlap)).rejects.toThrow(/RESOURCE_OVERLAP/);
    const dayPlant = randomUUID();
    await client.query(
      `INSERT INTO ${SCHEMA}.schedule_plant_assignments (job_id, work_date, visit_id, plant_id, assigned_by)
       VALUES ($1::uuid, '2099-01-02', NULL, $2::uuid, $3::uuid)`,
      [jobId, dayPlant, actorId]
    );
    await expect(createAssignment('plant', dayPlant, visitA)).rejects.toThrow(/RESOURCE_OVERLAP/);

    const employeeFirst = await createAssignment('employee', employeeId, visitA);
    const employeeRepeat = await createAssignment('employee', employeeId, visitA);
    expect(employeeRepeat.rows[0]?.assignment_id).toBe(employeeFirst.rows[0]?.assignment_id);
    await expect(createAssignment('employee', employeeId, visitOverlap)).rejects.toThrow(
      /RESOURCE_OVERLAP/
    );
  });
});
