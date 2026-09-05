/**
 * FXERR PostgreSQL integration coverage for exact-snapshot cleanup.
 *
 * Uses an ephemeral schema (never mutates production public.error_logs).
 * Requires POSTGRES_URL_NON_POOLING in .env.local.
 */
import {
  __testOnlyConfigureFixerrorsRelations,
  __testOnlyExecuteVerifiedSnapshotCleanup as executeVerifiedSnapshotCleanup,
  fetchDatabaseTargetFingerprint,
  fetchProductionErrorSnapshot,
  markSnapshotAnalysisCompleted,
  purgeExpiredArchivedErrorLogs,
  writeAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
  type ErrorSnapshotExport,
  type PgClientLike,
  type SnapshotIo,
} from '@/scripts/fixerrors-safety';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.error(
    'Missing required env var: POSTGRES_URL_NON_POOLING (required for fixerrors PG integration tests)'
  );
  process.exit(1);
}

const { Client } = pg;
const SCHEMA = `ffts_fxerr_test_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;
const EXPORT_TIME = new Date('2026-08-11T21:00:00.000Z');

function createPostgresClient(urlString: string): InstanceType<typeof Client> {
  const url = new URL(urlString);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.replace(/^\/+/u, '') || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

function asPgClient(client: InstanceType<typeof Client>): PgClientLike {
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[]
    ) {
      const result = await client.query(text, values);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount,
      };
    },
  };
}

class MemoryIo implements SnapshotIo {
  readonly files = new Map<string, string>();

  writeAtomic(path: string, content: string): void {
    this.files.set(path, content);
  }

  read(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }
}

class FailArchiveClient implements PgClientLike {

  constructor(private readonly inner: PgClientLike) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) {
    if (text.includes('fixerrors:archive-error-batch')) {
      throw new Error('forced archive failure');
    }
    return this.inner.query<T>(text, values);
  }
}

class ConcurrentInsertClient implements PgClientLike {
  private inserted = false;

  constructor(
    private readonly inner: PgClientLike,
    private readonly onAfterSnapshotEstablished: () => Promise<void>
  ) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) {
    const result = await this.inner.query<T>(text, values);
    // PostgreSQL establishes the RR snapshot on the first query after BEGIN.
    // Insert only after that snapshot exists (post boundary probe).
    if (!this.inserted && text.includes('fixerrors:snapshot-boundary')) {
      this.inserted = true;
      await this.onAfterSnapshotEstablished();
    }
    return result;
  }
}

function confirmation(snapshot: ErrorSnapshotExport) {
  return {
    snapshotId: snapshot.snapshotId,
    checksum: snapshot.checksum,
    rowCount: snapshot.rowCount,
    databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
    expiresAt: snapshot.expiresAt,
    safetyContract: snapshot.safetyContract,
    manifestChecksum: snapshot.manifestChecksum,
  };
}

async function analyzedSnapshot(
  client: PgClientLike,
  io: MemoryIo
): Promise<ErrorSnapshotExport> {
  let snapshot = await fetchProductionErrorSnapshot(client, EXPORT_TIME);
  const report = '# pg integration report\n';
  snapshot = markSnapshotAnalysisCompleted(snapshot, report, { standard: 1 }, EXPORT_TIME);
  writeAndVerifyTextArtifactAtomic('/virtual/error-analysis.md', report, io);
  return writeAndVerifyErrorSnapshot(snapshot, '/virtual/error-snapshot.json', io);
}

describe('fixerrors PostgreSQL exact-snapshot safety', () => {
  let admin: InstanceType<typeof Client>;
  let targetFingerprint = '';

  beforeAll(async () => {
    admin = createPostgresClient(connectionString);
    await admin.connect();

    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`
      CREATE OR REPLACE FUNCTION ${SCHEMA}.update_updated_at_column()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$;
    `);
    await admin.query(`
      CREATE TABLE ${SCHEMA}.error_logs (
        id UUID PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        error_message TEXT NOT NULL,
        error_stack TEXT,
        error_type TEXT NOT NULL,
        user_id UUID,
        user_email TEXT,
        page_url TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        component_name TEXT,
        additional_data JSONB,
        status TEXT NOT NULL DEFAULT 'active',
        archived_at TIMESTAMPTZ,
        CONSTRAINT error_logs_status_check
          CHECK (status IN ('active', 'archived')),
        CONSTRAINT error_logs_status_archived_at_consistency
          CHECK (
            (status = 'active' AND archived_at IS NULL)
            OR (status = 'archived' AND archived_at IS NOT NULL)
          )
      );
      CREATE TABLE ${SCHEMA}.error_log_alerts (
        error_log_id UUID PRIMARY KEY REFERENCES ${SCHEMA}.error_logs(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${SCHEMA}.user_usage_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        error_log_id UUID REFERENCES ${SCHEMA}.error_logs(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${SCHEMA}.service_health_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recovery_error_log_id UUID REFERENCES ${SCHEMA}.error_logs(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TRIGGER set_updated_at_service_health_events
        BEFORE UPDATE ON ${SCHEMA}.service_health_events
        FOR EACH ROW
        EXECUTE FUNCTION ${SCHEMA}.update_updated_at_column();
    `);

    __testOnlyConfigureFixerrorsRelations({
      schema: SCHEMA,
      errorLogsTable: 'error_logs',
      errorLogAlertsTable: 'error_log_alerts',
      userUsageEventsTable: 'user_usage_events',
      serviceHealthEventsTable: 'service_health_events',
      expectedTriggers: [
        {
          table: 'service_health_events',
          triggerName: 'set_updated_at_service_health_events',
        },
      ],
    });

    targetFingerprint = await fetchDatabaseTargetFingerprint(asPgClient(admin));
  }, 60_000);

  afterAll(async () => {
    try {
      __testOnlyConfigureFixerrorsRelations(null);
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await admin.end();
      }
    } catch {
      // best-effort cleanup
    }
  });

  async function seedExactRows(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = randomUUID();
      ids.push(id);
      const createdAt = new Date(EXPORT_TIME.getTime() - 60_000 + index).toISOString();
      await admin.query(
        `
          INSERT INTO ${SCHEMA}.error_logs (
            id, timestamp, created_at, error_message, error_type, page_url, user_agent, component_name
          ) VALUES ($1, $2::timestamptz, $2::timestamptz, $3, 'Error', 'https://example.test/x', 'vitest', 'Example')
        `,
        [id, createdAt, `pg error ${index + 1}`]
      );
    }
    return ids;
  }

  async function truncateAll(): Promise<void> {
    await admin.query(`
      TRUNCATE TABLE
        ${SCHEMA}.error_log_alerts,
        ${SCHEMA}.user_usage_events,
        ${SCHEMA}.service_health_events,
        ${SCHEMA}.error_logs
      CASCADE
    `);
  }

  it('FXERR-ARCHIVE-020 archives exact IDs without changing dependents', async () => {
    await truncateAll();
    const ids = await seedExactRows(2);
    await admin.query(
      `INSERT INTO ${SCHEMA}.error_log_alerts (error_log_id) VALUES ($1)`,
      [ids[0]]
    );
    await admin.query(
      `INSERT INTO ${SCHEMA}.user_usage_events (error_log_id) VALUES ($1), ($2)`,
      [ids[0], ids[1]]
    );
    const serviceInsert = await admin.query<{ id: string; updated_at: Date }>(
      `
        INSERT INTO ${SCHEMA}.service_health_events (recovery_error_log_id)
        VALUES ($1)
        RETURNING id, updated_at
      `,
      [ids[0]]
    );
    const serviceId = serviceInsert.rows[0].id;
    const updatedBefore = new Date(serviceInsert.rows[0].updated_at).toISOString();

    const client = asPgClient(admin);
    const io = new MemoryIo();
    const snapshot = await analyzedSnapshot(client, io);
    expect(snapshot.databaseTargetFingerprint).toBe(targetFingerprint);
    expect(snapshot.dependencies.alertErrorLogIds).toEqual([ids[0]]);
    expect(snapshot.dependencies.userUsageEventsReferencing).toBe(2);
    expect(snapshot.dependencies.serviceHealthEventsReferencing).toBe(1);

    const result = await executeVerifiedSnapshotCleanup({
      client,
      confirmation: confirmation(snapshot),
      databaseTargetFingerprint: targetFingerprint,
      snapshotPath: '/virtual/error-snapshot.json',
      latestSnapshotPath: null,
      analysisPath: '/virtual/error-analysis.md',
      io,
      now: EXPORT_TIME,
    });

    expect(result.clearedCount).toBe(2);
    expect(result.reconciliationState).toBe('archived');

    const remaining = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_logs WHERE status = 'archived'`
    );
    expect(remaining.rows[0].count).toBe(2);
    const alerts = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_log_alerts`
    );
    expect(alerts.rows[0].count).toBe(1);
    const usage = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.user_usage_events WHERE error_log_id IS NOT NULL`
    );
    expect(usage.rows[0].count).toBe(2);
    const service = await admin.query<{
      recovery_error_log_id: string | null;
      updated_at: Date;
    }>(
      `SELECT recovery_error_log_id, updated_at FROM ${SCHEMA}.service_health_events WHERE id = $1`,
      [serviceId]
    );
    expect(service.rows[0].recovery_error_log_id).toBe(ids[0]);
    expect(new Date(service.rows[0].updated_at).toISOString()).toBe(updatedBefore);
  });

  it('rolls back an archive failure', async () => {
    await truncateAll();
    const ids = await seedExactRows(2);
    await admin.query(
      `INSERT INTO ${SCHEMA}.error_log_alerts (error_log_id) VALUES ($1)`,
      [ids[0]]
    );

    const io = new MemoryIo();
    const snapshot = await analyzedSnapshot(asPgClient(admin), io);
    const failing = new FailArchiveClient(asPgClient(admin));

    await expect(
      executeVerifiedSnapshotCleanup({
        client: failing,
        confirmation: confirmation(snapshot),
        databaseTargetFingerprint: targetFingerprint,
        snapshotPath: '/virtual/error-snapshot.json',
        latestSnapshotPath: null,
        analysisPath: '/virtual/error-analysis.md',
        io,
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({ outcome: 'failed' });

    const remaining = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_logs`
    );
    expect(remaining.rows[0].count).toBe(2);
    const alerts = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_log_alerts`
    );
    expect(alerts.rows[0].count).toBe(1);
  });

  it('FXERR-CONCURRENCY-002 excludes a concurrent committed insert from the repeatable-read snapshot', async () => {
    await truncateAll();
    const ids = await seedExactRows(2);
    const concurrentId = randomUUID();
    const secondary = createPostgresClient(connectionString);
    await secondary.connect();
    try {
      const exportClient = new ConcurrentInsertClient(asPgClient(admin), async () => {
        await secondary.query(
          `
            INSERT INTO ${SCHEMA}.error_logs (
              id, timestamp, created_at, error_message, error_type, page_url, user_agent
            ) VALUES (
              $1,
              '2020-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z',
              'concurrent',
              'Error',
              'https://example.test/y',
              'vitest'
            )
          `,
          [concurrentId]
        );
      });

      const io = new MemoryIo();
      let snapshot = await fetchProductionErrorSnapshot(exportClient, EXPORT_TIME);
      expect(snapshot.exactIds).toEqual(ids);
      expect(snapshot.exactIds).not.toContain(concurrentId);

      const report = '# concurrent report\n';
      snapshot = markSnapshotAnalysisCompleted(
        snapshot,
        report,
        { standard: 1 },
        EXPORT_TIME
      );
      writeAndVerifyTextArtifactAtomic('/virtual/error-analysis.md', report, io);
      snapshot = writeAndVerifyErrorSnapshot(
        snapshot,
        '/virtual/error-snapshot.json',
        io
      );

      await executeVerifiedSnapshotCleanup({
        client: asPgClient(admin),
        confirmation: confirmation(snapshot),
        databaseTargetFingerprint: targetFingerprint,
        snapshotPath: '/virtual/error-snapshot.json',
        latestSnapshotPath: null,
        analysisPath: '/virtual/error-analysis.md',
        io,
        now: EXPORT_TIME,
      });

      const remaining = await admin.query<{ id: string }>(
        `SELECT id FROM ${SCHEMA}.error_logs WHERE status = 'active' ORDER BY id`
      );
      expect(remaining.rows.map((row) => row.id)).toEqual([concurrentId]);
    } finally {
      await secondary.end();
    }
  });

  it('FXERR-RETENTION-021 purges only expired archived rows and records FK collateral', async () => {
    await truncateAll();
    const expiredId = randomUUID();
    const recentId = randomUUID();
    const activeId = randomUUID();
    await admin.query(
      `
        INSERT INTO ${SCHEMA}.error_logs (
          id, timestamp, created_at, error_message, error_type, page_url,
          user_agent, status, archived_at
        ) VALUES
          ($1, NOW(), NOW() - INTERVAL '18 months', 'expired', 'Error',
            'https://example.test/expired', 'vitest', 'archived',
            NOW() - INTERVAL '13 months'),
          ($2, NOW(), NOW() - INTERVAL '2 months', 'recent', 'Error',
            'https://example.test/recent', 'vitest', 'archived',
            NOW() - INTERVAL '1 month'),
          ($3, NOW(), NOW() - INTERVAL '18 months', 'active', 'Error',
            'https://example.test/active', 'vitest', 'active', NULL)
      `,
      [expiredId, recentId, activeId]
    );
    await admin.query(
      `INSERT INTO ${SCHEMA}.error_log_alerts (error_log_id) VALUES ($1), ($2)`,
      [expiredId, recentId]
    );
    await admin.query(
      `INSERT INTO ${SCHEMA}.user_usage_events (error_log_id) VALUES ($1)`,
      [expiredId]
    );
    await admin.query(
      `INSERT INTO ${SCHEMA}.service_health_events (recovery_error_log_id) VALUES ($1)`,
      [expiredId]
    );

    const databaseClient = asPgClient(admin);
    const snapshot = await fetchProductionErrorSnapshot(
      databaseClient,
      EXPORT_TIME
    );
    const purged = await purgeExpiredArchivedErrorLogs(
      databaseClient,
      snapshot.schemaFingerprint
    );

    expect(purged).toMatchObject({
      eligibleCount: 1,
      purgedCount: 1,
      remainingExpiredCount: 0,
      remainingActiveCount: 1,
      reconciliationState: 'purged',
      collateral: {
        cascadedAlertCount: 1,
        userUsageEventsNulled: 1,
        serviceHealthEventsNulled: 1,
      },
    });
    const remaining = await admin.query<{ id: string }>(
      `SELECT id::text AS id FROM ${SCHEMA}.error_logs ORDER BY id`
    );
    expect(remaining.rows.map((row) => row.id).sort()).toEqual(
      [recentId, activeId].sort()
    );
    const alerts = await admin.query<{ error_log_id: string }>(
      `SELECT error_log_id::text AS error_log_id FROM ${SCHEMA}.error_log_alerts`
    );
    expect(alerts.rows).toEqual([{ error_log_id: recentId }]);
    const usage = await admin.query<{ error_log_id: string | null }>(
      `SELECT error_log_id::text AS error_log_id FROM ${SCHEMA}.user_usage_events`
    );
    expect(usage.rows).toEqual([{ error_log_id: null }]);
    const service = await admin.query<{
      recovery_error_log_id: string | null;
    }>(
      `SELECT recovery_error_log_id::text AS recovery_error_log_id FROM ${SCHEMA}.service_health_events`
    );
    expect(service.rows).toEqual([{ recovery_error_log_id: null }]);
  });

  it('blocks cleanup when dependent trigger contract drifts', async () => {
    await truncateAll();
    await seedExactRows(1);
    const io = new MemoryIo();
    const snapshot = await analyzedSnapshot(asPgClient(admin), io);

    await admin.query(`
      CREATE OR REPLACE FUNCTION ${SCHEMA}.noop_trigger()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN NEW;
      END;
      $$;
    `);
    await admin.query(`
      CREATE TRIGGER unexpected_error_logs_trigger
        BEFORE DELETE ON ${SCHEMA}.error_logs
        FOR EACH ROW
        EXECUTE FUNCTION ${SCHEMA}.noop_trigger();
    `);

    await expect(
      executeVerifiedSnapshotCleanup({
        client: asPgClient(admin),
        confirmation: confirmation(snapshot),
        databaseTargetFingerprint: targetFingerprint,
        snapshotPath: '/virtual/error-snapshot.json',
        latestSnapshotPath: null,
        analysisPath: '/virtual/error-analysis.md',
        io,
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({ outcome: 'failed' });

    const remaining = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_logs`
    );
    expect(remaining.rows[0].count).toBe(1);

    await admin.query(
      `DROP TRIGGER IF EXISTS unexpected_error_logs_trigger ON ${SCHEMA}.error_logs`
    );
  });

  it('FXERR-TS-CLEANUP-018 archives rows with non-zero microsecond created_at', async () => {
    await truncateAll();
    const firstId = randomUUID();
    const secondId = randomUUID();
    await admin.query(
      `
        INSERT INTO ${SCHEMA}.error_logs (
          id, timestamp, created_at, error_message, error_type, page_url, user_agent, component_name
        ) VALUES
          ($1, TIMESTAMPTZ '2026-09-04 21:50:14.694001+00', TIMESTAMPTZ '2026-09-04 21:50:14.694001+00', 'us-1', 'Error', 'https://example.test/x', 'vitest', 'Example'),
          ($2, TIMESTAMPTZ '2026-09-04 21:50:14.694888+00', TIMESTAMPTZ '2026-09-04 21:50:14.694888+00', 'us-2', 'Error', 'https://example.test/x', 'vitest', 'Example')
      `,
      [firstId, secondId]
    );

    const io = new MemoryIo();
    const snapshot = await analyzedSnapshot(asPgClient(admin), io);
    expect(snapshot.boundary?.createdAt).toBe('2026-09-04T21:50:14.694888Z');
    expect(snapshot.errors.map((row) => row.created_at)).toEqual([
      '2026-09-04T21:50:14.694001Z',
      '2026-09-04T21:50:14.694888Z',
    ]);

    const result = await executeVerifiedSnapshotCleanup({
      client: asPgClient(admin),
      confirmation: confirmation(snapshot),
      databaseTargetFingerprint: targetFingerprint,
      snapshotPath: '/virtual/error-snapshot.json',
      latestSnapshotPath: null,
      analysisPath: '/virtual/error-analysis.md',
      io,
      now: EXPORT_TIME,
    });
    expect(result.reconciliationState).toBe('archived');
    expect(result.archivedErrorLogIds).toEqual([firstId, secondId]);

    const statuses = await admin.query<{ status: string }>(
      `SELECT status FROM ${SCHEMA}.error_logs ORDER BY created_at ASC`
    );
    expect(statuses.rows.map((row) => row.status)).toEqual(['archived', 'archived']);
  });
});

describe('disposable pre-migration apply', () => {
  const MIGRATION_SCHEMA = `ffts_fxerr_mig_${process.pid}_${Date.now()}`;
  const admin = createPostgresClient(connectionString!);

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${MIGRATION_SCHEMA}`);
    await admin.query(`
      CREATE TABLE ${MIGRATION_SCHEMA}.error_logs (
        id UUID PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        error_message TEXT NOT NULL,
        error_type TEXT NOT NULL DEFAULT 'Error',
        page_url TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        component_name TEXT
      )
    `);
    await admin.query(`ALTER TABLE ${MIGRATION_SCHEMA}.error_logs ENABLE ROW LEVEL SECURITY`);
    await admin.query(
      `
        INSERT INTO ${MIGRATION_SCHEMA}.error_logs (
          id, timestamp, created_at, error_message, page_url, user_agent, component_name
        ) VALUES ($1, NOW(), NOW(), 'pre-migration row', 'https://example.test/x', 'vitest', 'Example')
      `,
      [randomUUID()]
    );
  });

  afterAll(async () => {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${MIGRATION_SCHEMA} CASCADE`);
    } finally {
      await admin.end();
    }
  });

  it('FXERR-MIG-025 applies rewritten additive SQL onto a pre-archive table', async () => {
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260905_error_logs_archive_status.sql'),
      'utf8'
    );
    const rewritten = source
      .replaceAll('public.error_logs', `${MIGRATION_SCHEMA}.error_logs`)
      .replaceAll("'public.error_logs'::regclass", `'${MIGRATION_SCHEMA}.error_logs'::regclass`);

    await admin.query(rewritten);

    const row = await admin.query<{
      status: string;
      archived_at: Date | null;
    }>(`SELECT status, archived_at FROM ${MIGRATION_SCHEMA}.error_logs`);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].status).toBe('active');
    expect(row.rows[0].archived_at).toBeNull();

    const columns = await admin.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'error_logs'
          AND column_name IN ('status', 'archived_at')
        ORDER BY column_name
      `,
      [MIGRATION_SCHEMA]
    );
    expect(columns.rows).toEqual([
      {
        column_name: 'archived_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'status',
        data_type: 'text',
        is_nullable: 'NO',
        column_default: "'active'::text",
      },
    ]);

    const constraints = await admin.query<{ conname: string; definition: string }>(
      `
        SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = $1
          AND rel.relname = 'error_logs'
          AND con.conname IN (
            'error_logs_status_check',
            'error_logs_status_archived_at_consistency'
          )
        ORDER BY con.conname
      `,
      [MIGRATION_SCHEMA]
    );
    const statusCheck = constraints.rows.find(
      (item) => item.conname === 'error_logs_status_check'
    );
    const consistencyCheck = constraints.rows.find(
      (item) => item.conname === 'error_logs_status_archived_at_consistency'
    );
    expect(statusCheck?.definition.replace(/\s+/gu, ' ')).toMatch(
      /^CHECK \(\(status = ANY \(ARRAY\['active'::text, 'archived'::text\]\)\)\)$/u
    );
    expect(consistencyCheck?.definition.replace(/\s+/gu, ' ')).toMatch(
      /^CHECK \(\(\(\(status = 'active'::text\) AND \(archived_at IS NULL\)\) OR \(\(status = 'archived'::text\) AND \(archived_at IS NOT NULL\)\)\)\)$/u
    );

    const indexes = await admin.query<{ indexname: string; indexdef: string }>(
      `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = $1
          AND tablename = 'error_logs'
          AND indexname IN (
            'idx_error_logs_active_created_at',
            'idx_error_logs_active_timestamp',
            'idx_error_logs_archived_at'
          )
        ORDER BY indexname
      `,
      [MIGRATION_SCHEMA]
    );
    expect(indexes.rows.map((item) => item.indexname)).toEqual([
      'idx_error_logs_active_created_at',
      'idx_error_logs_active_timestamp',
      'idx_error_logs_archived_at',
    ]);
    const archivedIndex = indexes.rows.find(
      (item) => item.indexname === 'idx_error_logs_archived_at'
    );
    expect(archivedIndex?.indexdef.replace(/\s+/gu, ' ')).toMatch(
      new RegExp(
        `CREATE INDEX idx_error_logs_archived_at ON ${MIGRATION_SCHEMA}\\.error_logs USING btree \\(archived_at, id\\) WHERE \\(status = 'archived'::text\\)`
      )
    );

    const policy = await admin.query<{
      polname: string;
      polcmd: string;
      roles: string;
      using_expr: string;
      with_check: string;
    }>(
      `
        SELECT
          pol.polname,
          pol.polcmd,
          array_to_string(
            ARRAY(
              SELECT COALESCE(rol.rolname, 'public')
              FROM unnest(pol.polroles) AS role_oid
              LEFT JOIN pg_roles rol ON rol.oid = role_oid
              ORDER BY 1
            ),
            ','
          ) AS roles,
          pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
          pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
        FROM pg_policy pol
        JOIN pg_class rel ON rel.oid = pol.polrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = $1
          AND rel.relname = 'error_logs'
          AND pol.polname = 'SuperAdmin can update error logs'
      `,
      [MIGRATION_SCHEMA]
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0].polcmd).toBe('w');
    expect(policy.rows[0].roles).toBe('authenticated');
    const normalizePolicy = (value: string) => value.replace(/\s+/gu, ' ').trim();
    const expectedPolicy =
      "(( SELECT is_actual_super_admin() AS is_actual_super_admin) OR ((( SELECT auth.jwt() AS jwt) ->> 'email'::text) = 'admin@mpdee.co.uk'::text))";
    expect(normalizePolicy(policy.rows[0].using_expr)).toBe(expectedPolicy);
    expect(normalizePolicy(policy.rows[0].with_check)).toBe(expectedPolicy);
  });
});
