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
  writeAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
  type ErrorSnapshotExport,
  type PgClientLike,
  type SnapshotIo,
} from '@/scripts/fixerrors-safety';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';
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

class FailSecondDeleteClient implements PgClientLike {
  private deleteBatches = 0;

  constructor(private readonly inner: PgClientLike) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) {
    if (text.includes('fixerrors:delete-error-batch')) {
      this.deleteBatches += 1;
      if (this.deleteBatches >= 1) {
        throw new Error('forced mid-delete failure');
      }
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
        additional_data JSONB
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

  it('FXERR-DEL-001 / FXERR-DEP-001 deletes exact IDs, alerts, and records SET NULL collateral with updated_at trigger', async () => {
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
    expect(result.clearedAlertCount).toBe(1);
    expect(result.collateral.userUsageEventsNulled).toBe(2);
    expect(result.collateral.serviceHealthEventsNulled).toBe(1);

    const remaining = await admin.query(`SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_logs`);
    expect(remaining.rows[0].count).toBe(0);
    const alerts = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_log_alerts`
    );
    expect(alerts.rows[0].count).toBe(0);
    const usage = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.user_usage_events WHERE error_log_id IS NOT NULL`
    );
    expect(usage.rows[0].count).toBe(0);
    const service = await admin.query<{
      recovery_error_log_id: string | null;
      updated_at: Date;
    }>(
      `SELECT recovery_error_log_id, updated_at FROM ${SCHEMA}.service_health_events WHERE id = $1`,
      [serviceId]
    );
    expect(service.rows[0].recovery_error_log_id).toBeNull();
    expect(new Date(service.rows[0].updated_at).toISOString() >= updatedBefore).toBe(true);
  });

  it('FXERR-TX-001 / FXERR-RB-001 rolls back mid-delete failure', async () => {
    await truncateAll();
    const ids = await seedExactRows(2);
    await admin.query(
      `INSERT INTO ${SCHEMA}.error_log_alerts (error_log_id) VALUES ($1)`,
      [ids[0]]
    );

    const io = new MemoryIo();
    const snapshot = await analyzedSnapshot(asPgClient(admin), io);
    const failing = new FailSecondDeleteClient(asPgClient(admin));

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
    ).rejects.toMatchObject({ outcome: 'rolled_back' });

    const remaining = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_logs`
    );
    expect(remaining.rows[0].count).toBe(2);
    const alerts = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_log_alerts`
    );
    expect(alerts.rows[0].count).toBe(1);
  });

  it('FXERR-CONC-001 excludes a concurrent committed insert from the repeatable-read snapshot', async () => {
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
        `SELECT id FROM ${SCHEMA}.error_logs ORDER BY id`
      );
      expect(remaining.rows.map((row) => row.id)).toEqual([concurrentId]);
    } finally {
      await secondary.end();
    }
  });

  it('FXERR-SCHEMA-001 blocks cleanup when dependent trigger contract drifts', async () => {
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
    ).rejects.toMatchObject({ outcome: 'rejected' });

    const remaining = await admin.query(
      `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.error_logs`
    );
    expect(remaining.rows[0].count).toBe(1);

    await admin.query(
      `DROP TRIGGER IF EXISTS unexpected_error_logs_trigger ON ${SCHEMA}.error_logs`
    );
  });
});
