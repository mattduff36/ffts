import {
  __testOnlyExecuteVerifiedSnapshotCleanup as executeVerifiedSnapshotCleanup,
  computeServerIdentityFingerprint,
  executeVerifiedSnapshotCleanup as executeProductionSnapshotCleanup,
  fetchProductionErrorSnapshot,
  markSnapshotAnalysisCompleted,
  readAndVerifyErrorSnapshot,
  writeAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
  type ErrorSnapshotExport,
  type PgClientLike,
  type SnapshotIo,
  type SnapshotLock,
} from '@/scripts/fixerrors-safety';
import * as safetyModule from '@/scripts/fixerrors-safety';
import { parseCleanupConfirmation, type ErrorLogEntry } from '@/scripts/fixerrors';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const SERVER_IDENTITY = {
  databaseName: 'ffts_test',
  serverAddr: '127.0.0.1',
  serverPort: '5432',
  systemIdentifier: '42',
};
const TARGET_FINGERPRINT = computeServerIdentityFingerprint(SERVER_IDENTITY);
const SNAPSHOT_PATH = '/virtual/error-snapshot.json';
const ANALYSIS_PATH = '/virtual/error-analysis.md';
const EXPORT_TIME = new Date('2026-08-11T06:00:00.000Z');

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function makeError(index: number, overrides: Partial<ErrorLogEntry> = {}): ErrorLogEntry {
  const createdAt = new Date(EXPORT_TIME.getTime() - 60_000 + index).toISOString();
  return {
    id: uuid(index),
    timestamp: createdAt,
    created_at: createdAt,
    error_message: `Error ${index}`,
    error_stack: null,
    error_type: 'Error',
    user_id: null,
    user_email: 'user@example.com',
    page_url: 'https://forest-farm.example.test/example',
    user_agent: 'vitest',
    component_name: 'Example',
    additional_data: null,
    ...overrides,
  };
}

function compareRows(left: ErrorLogEntry, right: ErrorLogEntry): number {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
}

function result<T extends Record<string, unknown>>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

const SCHEMA_COLUMNS = [
  {
    column_name: 'id',
    data_type: 'uuid',
    not_null: true,
    ordinal_position: 1,
  },
  {
    column_name: 'timestamp',
    data_type: 'timestamp with time zone',
    not_null: true,
    ordinal_position: 2,
  },
  {
    column_name: 'created_at',
    data_type: 'timestamp with time zone',
    not_null: true,
    ordinal_position: 3,
  },
];

const EXPECTED_FOREIGN_KEYS = [
  {
    child_schema: 'public',
    child_table: 'error_log_alerts',
    child_columns: ['error_log_id'],
    parent_columns: ['id'],
    delete_action: 'CASCADE',
  },
  {
    child_schema: 'public',
    child_table: 'service_health_events',
    child_columns: ['recovery_error_log_id'],
    parent_columns: ['id'],
    delete_action: 'SET NULL',
  },
  {
    child_schema: 'public',
    child_table: 'user_usage_events',
    child_columns: ['error_log_id'],
    parent_columns: ['id'],
    delete_action: 'SET NULL',
  },
];

const EXPECTED_TRIGGERS = [
  {
    table_name: 'service_health_events',
    trigger_name: 'set_updated_at_service_health_events',
  },
];

class ExportClient implements PgClientLike {
  readonly queryLog: string[] = [];
  readonly liveRows: ErrorLogEntry[];
  private transactionRows: ErrorLogEntry[] = [];
  private readonly failTag: string | null;
  private readonly afterBegin?: (rows: ErrorLogEntry[]) => void;
  private readonly countOverride: number | null;
  schemaColumns = [...SCHEMA_COLUMNS];
  foreignKeys = [...EXPECTED_FOREIGN_KEYS];
  triggerRows = [...EXPECTED_TRIGGERS];
  alerts = new Set<string>();
  serviceReferences = new Set<string>();
  usageReferences = new Set<string>();

  constructor(
    rows: ErrorLogEntry[],
    options: {
      failTag?: string;
      afterBegin?: (rows: ErrorLogEntry[]) => void;
      countOverride?: number;
      alerts?: string[];
      serviceReferences?: string[];
      usageReferences?: string[];
    } = {}
  ) {
    this.liveRows = [...rows];
    this.failTag = options.failTag ?? null;
    this.afterBegin = options.afterBegin;
    this.countOverride = options.countOverride ?? null;
    this.alerts = new Set(options.alerts ?? []);
    this.serviceReferences = new Set(options.serviceReferences ?? []);
    this.usageReferences = new Set(options.usageReferences ?? []);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queryLog.push(text);
    if (this.failTag && text.includes(this.failTag)) {
      throw new Error(`forced ${this.failTag} failure`);
    }
    if (text.includes('fixerrors:export-begin')) {
      this.transactionRows = [...this.liveRows].sort(compareRows);
      this.afterBegin?.(this.liveRows);
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:server-identity')) {
      return result([
        {
          database_name: SERVER_IDENTITY.databaseName,
          server_addr: SERVER_IDENTITY.serverAddr,
          server_port: SERVER_IDENTITY.serverPort,
          system_identifier: SERVER_IDENTITY.systemIdentifier,
        },
      ]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:transaction-time')) {
      return result([{ transaction_started_at: EXPORT_TIME }]) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:schema-columns')) {
      return result(this.schemaColumns) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:fk-catalog')) {
      return result(this.foreignKeys) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:trigger-catalog')) {
      return result(this.triggerRows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:snapshot-boundary')) {
      const row = this.transactionRows.at(-1);
      return result(row ? [{ id: row.id, created_at: row.created_at }] : []) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:snapshot-count')) {
      return result([
        { count: String(this.countOverride ?? this.transactionRows.length) },
      ]) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:snapshot-page')) {
      const cursorCreatedAt = values[2] as string | null;
      const cursorId = values[3] as string | null;
      const limit = values[4] as number;
      const rows = this.transactionRows
        .filter(
          (row) =>
            cursorCreatedAt === null ||
            row.created_at > cursorCreatedAt ||
            (row.created_at === cursorCreatedAt && row.id > (cursorId ?? ''))
        )
        .slice(0, limit);
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-alert-inventory')) {
      const ids = values[0] as string[];
      const rows = ids
        .filter((id) => this.alerts.has(id))
        .sort()
        .map((error_log_id) => ({ error_log_id }));
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-usage-inventory')) {
      const ids = values[0] as string[];
      const count = ids.filter((id) => this.usageReferences.has(id)).length;
      return result([{ count: String(count) }]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-service-inventory')) {
      const ids = values[0] as string[];
      const count = ids.filter((id) => this.serviceReferences.has(id)).length;
      return result([{ count: String(count) }]) as { rows: T[]; rowCount: number };
    }
    return result([]) as { rows: T[]; rowCount: number };
  }
}

class CleanupClient implements PgClientLike {
  readonly queryLog: string[] = [];
  readonly unrelatedData = new Set(['application-row']);
  readonly errorRows: Map<string, ErrorLogEntry>;
  readonly alerts: Set<string>;
  readonly serviceReferences: Set<string>;
  readonly usageReferences: Set<string>;
  schemaColumns = [...SCHEMA_COLUMNS];
  foreignKeys = [...EXPECTED_FOREIGN_KEYS];
  triggerRows = [...EXPECTED_TRIGGERS];
  failDeleteBatch: number | null = null;
  commitThenThrow = false;
  private workingRows = new Map<string, ErrorLogEntry>();
  private workingAlerts = new Set<string>();
  private deleteBatch = 0;

  constructor(options: {
    rows: ErrorLogEntry[];
    alerts?: string[];
    serviceReferences?: string[];
    usageReferences?: string[];
  }) {
    this.errorRows = new Map(options.rows.map((row) => [row.id, row]));
    this.alerts = new Set(options.alerts ?? []);
    this.serviceReferences = new Set(options.serviceReferences ?? []);
    this.usageReferences = new Set(options.usageReferences ?? []);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queryLog.push(text);
    if (text.includes('fixerrors:cleanup-begin')) {
      this.workingRows = new Map(this.errorRows);
      this.workingAlerts = new Set(this.alerts);
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:server-identity')) {
      return result([
        {
          database_name: SERVER_IDENTITY.databaseName,
          server_addr: SERVER_IDENTITY.serverAddr,
          server_port: SERVER_IDENTITY.serverPort,
          system_identifier: SERVER_IDENTITY.systemIdentifier,
        },
      ]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:schema-columns')) {
      return result(this.schemaColumns) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:fk-catalog')) {
      return result(this.foreignKeys) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:trigger-catalog')) {
      return result(this.triggerRows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:lock-target-rows')) {
      const ids = values[0] as string[];
      const rows = ids
        .map((id) => this.workingRows.get(id))
        .filter((row): row is ErrorLogEntry => Boolean(row))
        .sort(compareRows);
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-alert-inventory')) {
      const ids = values[0] as string[];
      const rows = ids
        .filter((id) => this.workingAlerts.has(id))
        .sort()
        .map((error_log_id) => ({ error_log_id }));
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-usage-inventory')) {
      const ids = values[0] as string[];
      const count = ids.filter((id) => this.usageReferences.has(id)).length;
      return result([{ count: String(count) }]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-service-inventory')) {
      const ids = values[0] as string[];
      const count = ids.filter((id) => this.serviceReferences.has(id)).length;
      return result([{ count: String(count) }]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:delete-alerts')) {
      const ids = values[0] as string[];
      const rows = ids
        .filter((id) => this.workingAlerts.delete(id))
        .map((error_log_id) => ({ error_log_id }));
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:delete-error-batch')) {
      this.deleteBatch += 1;
      if (this.failDeleteBatch === this.deleteBatch) {
        throw new Error('forced batch failure');
      }
      const ids = values[0] as string[];
      const rows = ids
        .filter((id) => this.workingRows.delete(id))
        .map((id) => ({ id }));
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:remaining-count')) {
      return result([{ count: String(this.workingRows.size) }]) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:cleanup-rollback')) {
      this.workingRows = new Map(this.errorRows);
      this.workingAlerts = new Set(this.alerts);
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:cleanup-commit')) {
      this.errorRows.clear();
      for (const [id, row] of this.workingRows) this.errorRows.set(id, row);
      this.alerts.clear();
      for (const id of this.workingAlerts) this.alerts.add(id);
      if (this.commitThenThrow) throw new Error('connection lost during commit');
      return result([]) as { rows: T[]; rowCount: number };
    }
    return result([]) as { rows: T[]; rowCount: number };
  }
}

class MemoryIo implements SnapshotIo {
  readonly files = new Map<string, string>();
  failNextWrite = false;
  failNextRead = false;
  failCompletedOutcomeWrite = false;

  writeAtomic(path: string, content: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('forced artifact write failure');
    }
    if (
      this.failCompletedOutcomeWrite &&
      (JSON.parse(content) as ErrorSnapshotExport).cleanup.status === 'committed'
    ) {
      this.failCompletedOutcomeWrite = false;
      throw new Error('forced post-commit artifact write failure');
    }
    this.files.set(path, content);
  }

  read(path: string): string {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error('forced artifact read failure');
    }
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }
}

class MemoryLock implements SnapshotLock {
  held = false;

  acquire(): () => void {
    if (this.held) throw new Error('artifact lock is already held');
    this.held = true;
    return () => {
      this.held = false;
    };
  }
}

async function analyzedSnapshot(
  rows: ErrorLogEntry[],
  io = new MemoryIo(),
  options: {
    alerts?: string[];
    serviceReferences?: string[];
    usageReferences?: string[];
  } = {}
): Promise<{ snapshot: ErrorSnapshotExport; io: MemoryIo; report: string }> {
  const exportClient = new ExportClient(rows, options);
  let snapshot = await fetchProductionErrorSnapshot(exportClient, EXPORT_TIME);
  const report = '# verified report\n';
  snapshot = markSnapshotAnalysisCompleted(snapshot, report, { standard: 1 }, EXPORT_TIME);
  io.writeAtomic(ANALYSIS_PATH, report);
  snapshot = writeAndVerifyErrorSnapshot(snapshot, SNAPSHOT_PATH, io);
  return { snapshot, io, report };
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

function queryOrderIndex(client: { queryLog: string[] }, tag: string): number {
  return client.queryLog.findIndex((query) => query.includes(tag));
}

function validCleanupArgs(snapshot: ErrorSnapshotExport): string[] {
  const bound = confirmation(snapshot);
  return [
    '--cleanup',
    `--snapshot-id=${bound.snapshotId}`,
    `--checksum=${bound.checksum}`,
    `--row-count=${bound.rowCount}`,
    `--target=${bound.databaseTargetFingerprint}`,
    `--expires-at=${bound.expiresAt}`,
    `--safety-contract=${bound.safetyContract}`,
    `--manifest=${bound.manifestChecksum}`,
  ];
}

describe('fixerrors transaction-consistent snapshot export', () => {
  it.each([
    [0, 0],
    [1, 1],
    [199, 1],
    [200, 2],
    [405, 3],
  ])('FXERR-SNAP-001 exports %i rows completely using %i keyset pages', async (count, pages) => {
    const client = new ExportClient(
      Array.from({ length: count }, (_, index) => makeError(index + 1))
    );
    const snapshot = await fetchProductionErrorSnapshot(client, EXPORT_TIME);

    expect(snapshot.version).toBe(1);
    expect(snapshot.safetyContract).toBe('fixerrors-exact-snapshot-v1');
    expect(snapshot.databaseTargetFingerprint).toBe(TARGET_FINGERPRINT);
    expect(snapshot.schemaFingerprint).toHaveLength(64);
    expect(snapshot.dependencies).toEqual({
      alertErrorLogIds: [],
      userUsageEventsReferencing: 0,
      serviceHealthEventsReferencing: 0,
    });
    expect(snapshot.rowCount).toBe(count);
    expect(snapshot.expectedRowCount).toBe(count);
    expect(new Set(snapshot.exactIds).size).toBe(count);
    expect(
      client.queryLog.filter((query) => query.includes('fixerrors:snapshot-page'))
    ).toHaveLength(pages);
    expect(client.queryLog.some((query) => /\bOFFSET\b/iu.test(query))).toBe(false);
    expect(
      client.queryLog.some((query) =>
        query.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      )
    ).toBe(true);
  });

  it('FXERR-CONC-001 excludes a concurrent backdated insert from the repeatable-read snapshot', async () => {
    const initial = [makeError(1), makeError(2), makeError(3)];
    const arrivedLater = makeError(4, {
      created_at: '2020-01-01T00:00:00.000Z',
      timestamp: '2020-01-01T00:00:00.000Z',
    });
    const exportClient = new ExportClient(initial, {
      afterBegin: (rows) => rows.push(arrivedLater),
    });
    let snapshot = await fetchProductionErrorSnapshot(exportClient, EXPORT_TIME);

    expect(snapshot.exactIds).toEqual(initial.map((row) => row.id));
    const io = new MemoryIo();
    const report = '# verified report\n';
    snapshot = markSnapshotAnalysisCompleted(
      snapshot,
      report,
      { standard: 1 },
      EXPORT_TIME
    );
    io.writeAtomic(ANALYSIS_PATH, report);
    snapshot = writeAndVerifyErrorSnapshot(snapshot, SNAPSHOT_PATH, io);
    const cleanupClient = new CleanupClient({ rows: [...initial, arrivedLater] });
    const cleanup = await executeVerifiedSnapshotCleanup({
      client: cleanupClient,
      confirmation: confirmation(snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      latestSnapshotPath: null,
      analysisPath: ANALYSIS_PATH,
      io,
      lock: new MemoryLock(),
      now: EXPORT_TIME,
    });
    expect(cleanup.clearedCount).toBe(3);
    expect([...cleanupClient.errorRows.keys()]).toEqual([arrivedLater.id]);
  });

  it('FXERR-SNAP-001 fails closed on duplicate/invalid rows and page retrieval failure', async () => {
    const duplicate = makeError(1);
    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([duplicate, { ...duplicate }]),
        EXPORT_TIME
      )
    ).rejects.toThrow(/duplicate IDs|strictly ordered/u);
    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([makeError(1, { id: '' })]),
        EXPORT_TIME
      )
    ).rejects.toThrow('invalid ID');
    const failedPage = new ExportClient([makeError(1)], {
      failTag: 'fixerrors:snapshot-page',
    });
    await expect(
      fetchProductionErrorSnapshot(failedPage, EXPORT_TIME)
    ).rejects.toThrow('forced');
    expect(
      failedPage.queryLog.some((query) => query.includes('fixerrors:export-rollback'))
    ).toBe(true);

    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([makeError(1)], {
          failTag: 'fixerrors:snapshot-count',
        }),
        EXPORT_TIME
      )
    ).rejects.toThrow('forced');
    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([makeError(1)], { countOverride: 2 }),
        EXPORT_TIME
      )
    ).rejects.toThrow('count mismatch');
  });
});

describe('fixerrors exact transactional cleanup', () => {
  it('FXERR-DEL-001 deletes exact IDs in batches and preserves unrelated rows', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => makeError(index + 1));
    const extra = makeError(999);
    const prepared = await analyzedSnapshot(rows, new MemoryIo(), {
      alerts: [rows[0].id, rows[204].id],
    });
    const client = new CleanupClient({
      rows: [...rows, extra],
      alerts: [rows[0].id, rows[204].id],
    });

    const cleanup = await executeVerifiedSnapshotCleanup({
      client,
      confirmation: confirmation(prepared.snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      latestSnapshotPath: null,
      analysisPath: ANALYSIS_PATH,
      io: prepared.io,
      lock: new MemoryLock(),
      now: EXPORT_TIME,
    });

    expect(cleanup.clearedCount).toBe(205);
    expect(cleanup.clearedAlertCount).toBe(2);
    expect([...client.errorRows.keys()]).toEqual([extra.id]);
    expect(client.alerts.size).toBe(0);
    expect([...client.unrelatedData]).toEqual(['application-row']);
    const batches = client.queryLog.filter((query) =>
      query.includes('fixerrors:delete-error-batch')
    );
    expect(batches).toHaveLength(3);
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, prepared.io).cleanup.status).toBe(
      'committed'
    );
  });

  it('FXERR-DEP-001 inventories/deletes alerts and records SET NULL collateral (allowed)', async () => {
    const rows = [makeError(1), makeError(2)];
    const prepared = await analyzedSnapshot(rows, new MemoryIo(), {
      alerts: [rows[0].id],
      serviceReferences: [rows[0].id],
      usageReferences: [rows[0].id, rows[1].id],
    });
    expect(prepared.snapshot.dependencies).toEqual({
      alertErrorLogIds: [rows[0].id],
      userUsageEventsReferencing: 2,
      serviceHealthEventsReferencing: 1,
    });
    const client = new CleanupClient({
      rows,
      alerts: [rows[0].id],
      serviceReferences: [rows[0].id],
      usageReferences: [rows[0].id, rows[1].id],
    });

    const cleanup = await executeVerifiedSnapshotCleanup({
      client,
      confirmation: confirmation(prepared.snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      latestSnapshotPath: null,
      analysisPath: ANALYSIS_PATH,
      io: prepared.io,
      lock: new MemoryLock(),
      now: EXPORT_TIME,
    });

    expect(cleanup.clearedCount).toBe(2);
    expect(cleanup.clearedAlertCount).toBe(1);
    expect(cleanup.collateral.userUsageEventsNulled).toBe(2);
    expect(cleanup.collateral.serviceHealthEventsNulled).toBe(1);
    expect(cleanup.collateral.notes.join(' ')).toMatch(/updated_at/i);
    expect(client.errorRows.size).toBe(0);

    const lockIndex = queryOrderIndex(client, 'fixerrors:lock-target-rows');
    const usageIndex = queryOrderIndex(client, 'fixerrors:dependency-usage-inventory');
    const serviceIndex = queryOrderIndex(
      client,
      'fixerrors:dependency-service-inventory'
    );
    const deleteIndex = queryOrderIndex(client, 'fixerrors:delete-alerts');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(usageIndex).toBeGreaterThan(lockIndex);
    expect(serviceIndex).toBeGreaterThan(lockIndex);
    expect(deleteIndex).toBeGreaterThan(usageIndex);
    expect(deleteIndex).toBeGreaterThan(serviceIndex);
  });

  it('FXERR-TX-001 / FXERR-RB-001 rolls back every batch when a later delete fails', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => makeError(index + 1));
    const prepared = await analyzedSnapshot(rows, new MemoryIo(), {
      alerts: [rows[0].id],
    });
    const client = new CleanupClient({ rows, alerts: [rows[0].id] });
    client.failDeleteBatch = 2;

    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(prepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: prepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({
      outcome: 'rolled_back',
      attemptedErrorLogIds: rows.slice(0, 200).map((row) => row.id),
    });
    expect(client.errorRows.size).toBe(205);
    expect(client.alerts).toContain(rows[0].id);
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, prepared.io).cleanup.status).toBe(
      'rolled_back'
    );
  });

  it('FXERR-SCHEMA-001 blocks unknown FK scope, triggers, and schema fingerprint drift', async () => {
    const rows = [makeError(1)];

    const unknownPrepared = await analyzedSnapshot(rows);
    const unknownForeignKey = new CleanupClient({ rows });
    unknownForeignKey.foreignKeys.push({
      child_schema: 'public',
      child_table: 'unexpected_table',
      child_columns: ['error_id'],
      parent_columns: ['id'],
      delete_action: 'CASCADE',
    });
    await expect(
      executeVerifiedSnapshotCleanup({
        client: unknownForeignKey,
        confirmation: confirmation(unknownPrepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: unknownPrepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({ outcome: 'rejected' });

    const triggerPrepared = await analyzedSnapshot(rows);
    const unexpectedTrigger = new CleanupClient({ rows });
    unexpectedTrigger.triggerRows = [
      ...EXPECTED_TRIGGERS,
      { table_name: 'error_logs', trigger_name: 'mutate_other_data' },
    ];
    await expect(
      executeVerifiedSnapshotCleanup({
        client: unexpectedTrigger,
        confirmation: confirmation(triggerPrepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: triggerPrepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({ outcome: 'rejected' });

    const missingPrepared = await analyzedSnapshot(rows);
    const missingTrigger = new CleanupClient({ rows });
    missingTrigger.triggerRows = [];
    await expect(
      executeVerifiedSnapshotCleanup({
        client: missingTrigger,
        confirmation: confirmation(missingPrepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: missingPrepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({ outcome: 'rejected' });

    const driftPrepared = await analyzedSnapshot(rows);
    const fingerprintDrift = new CleanupClient({ rows });
    fingerprintDrift.schemaColumns = [
      ...SCHEMA_COLUMNS,
      {
        column_name: 'extra_column',
        data_type: 'text',
        not_null: false,
        ordinal_position: 99,
      },
    ];
    await expect(
      executeVerifiedSnapshotCleanup({
        client: fingerprintDrift,
        confirmation: confirmation(driftPrepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: driftPrepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('schema fingerprint mismatch');
  });
});

describe('fixerrors artifact and confirmation gate', () => {
  it('production cleanup reconstructs fixed options and ignores injected runtime extras', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    let injectedLockCalls = 0;
    const injectedOptions = {
      client,
      confirmation: confirmation(prepared.snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      analysisPath: ANALYSIS_PATH,
      io: prepared.io,
      lock: {
        acquire() {
          injectedLockCalls += 1;
          throw new Error('injected lock used');
        },
      },
      now: EXPORT_TIME,
    };

    await expect(
      executeProductionSnapshotCleanup(injectedOptions)
    ).rejects.not.toThrow('injected lock used');
    expect(injectedLockCalls).toBe(0);
    expect(client.queryLog).toHaveLength(0);
  });

  it('FXERR-ART-001 atomically writes and read-verifies the analysis report', () => {
    const io = new MemoryIo();
    writeAndVerifyTextArtifactAtomic(ANALYSIS_PATH, '# report\n', io);
    expect(io.files.get(ANALYSIS_PATH)).toBe('# report\n');

    const mismatchedRead: SnapshotIo = {
      writeAtomic() {},
      read() {
        return 'different';
      },
    };
    expect(() =>
      writeAndVerifyTextArtifactAtomic(ANALYSIS_PATH, '# report\n', mismatchedRead)
    ).toThrow('Text artifact readback mismatch');
  });

  it('does not export the low-level transactional deletion helper', () => {
    expect('clearProductionErrorLogs' in safetyModule).toBe(false);
  });

  it('FXERR-CONC-001 blocks a concurrent cleanup while the artifact lock is held', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    const lock = new MemoryLock();
    const release = lock.acquire();
    try {
      await expect(
        executeVerifiedSnapshotCleanup({
          client,
          confirmation: confirmation(prepared.snapshot),
          databaseTargetFingerprint: TARGET_FINGERPRINT,
          snapshotPath: SNAPSHOT_PATH,
          latestSnapshotPath: null,
          analysisPath: ANALYSIS_PATH,
          io: prepared.io,
          lock,
          now: EXPORT_TIME,
        })
      ).rejects.toThrow('artifact lock is already held');
      expect(client.queryLog).toHaveLength(0);
    } finally {
      release();
    }
  });

  it('FXERR-ART-001 performs zero database work when artifact write or readback fails', async () => {
    const rows = [makeError(1)];
    const preparedWrite = await analyzedSnapshot(rows);
    const writeClient = new CleanupClient({ rows });
    preparedWrite.io.failNextWrite = true;
    await expect(
      executeVerifiedSnapshotCleanup({
        client: writeClient,
        confirmation: confirmation(preparedWrite.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: preparedWrite.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('artifact write failure');
    expect(
      writeClient.queryLog.every((query) => query.includes('fixerrors:server-identity'))
    ).toBe(true);
    expect(
      writeClient.queryLog.some((query) =>
        query.includes('fixerrors:delete-error-batch')
      )
    ).toBe(false);

    const preparedRead = await analyzedSnapshot(rows);
    const readClient = new CleanupClient({ rows });
    preparedRead.io.failNextRead = true;
    await expect(
      executeVerifiedSnapshotCleanup({
        client: readClient,
        confirmation: confirmation(preparedRead.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: preparedRead.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('artifact read failure');
    expect(
      readClient.queryLog.every((query) => query.includes('fixerrors:server-identity'))
    ).toBe(true);
    expect(
      readClient.queryLog.some((query) =>
        query.includes('fixerrors:delete-error-batch')
      )
    ).toBe(false);
  });

  it('FXERR-CONFIRM-001 blocks mismatched, stale, report-corrupted, unknown, and duplicate CLI args', async () => {
    const rows = [makeError(1)];
    const mismatched = await analyzedSnapshot(rows);
    const mismatchClient = new CleanupClient({ rows });
    await expect(
      executeVerifiedSnapshotCleanup({
        client: mismatchClient,
        confirmation: { ...confirmation(mismatched.snapshot), rowCount: 2 },
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: mismatched.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('confirmation does not match');
    expect(mismatchClient.queryLog).toHaveLength(0);

    const stale = await analyzedSnapshot(rows);
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: confirmation(stale.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: stale.io,
        lock: new MemoryLock(),
        now: new Date(EXPORT_TIME.getTime() + 31 * 60 * 1000),
      })
    ).rejects.toThrow('expired');

    const corruptedReport = await analyzedSnapshot(rows);
    corruptedReport.io.files.set(ANALYSIS_PATH, 'corrupted');
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: confirmation(corruptedReport.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: corruptedReport.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('analysis artifact verification failed');

    const prepared = await analyzedSnapshot(rows);
    const args = validCleanupArgs(prepared.snapshot);
    expect(parseCleanupConfirmation(args)).toEqual(confirmation(prepared.snapshot));
    expect(() => parseCleanupConfirmation([...args, '--extra=1'])).toThrow(
      /unknown or malformed flag/i
    );
    expect(() =>
      parseCleanupConfirmation([...args, `--snapshot-id=${prepared.snapshot.snapshotId}`])
    ).toThrow(/duplicate flag/i);
    expect(() => parseCleanupConfirmation(['--cleanup', '--cleanup', ...args.slice(1)])).toThrow(
      /duplicate flag/i
    );
    expect(parseCleanupConfirmation(['--no-clear'])).toBeNull();
  });

  it('FXERR-RB-001 rejects malformed cleanup state transitions before database work', async () => {
    const rows = [makeError(1)];
    const malformed = await analyzedSnapshot(rows);
    const malformedJson = JSON.parse(
      malformed.io.files.get(SNAPSHOT_PATH) ?? '{}'
    ) as ErrorSnapshotExport;
    malformedJson.cleanup = {
      ...malformedJson.cleanup,
      status: 'rolled_back',
      attemptedAt: null,
      error: null,
    };
    malformed.io.files.set(SNAPSHOT_PATH, JSON.stringify(malformedJson));
    const client = new CleanupClient({ rows });
    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(malformed.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: malformed.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('snapshot verification failed');
    expect(client.queryLog).toHaveLength(0);
  });

  it('FXERR-TARGET-001 blocks a snapshot from another database target', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(prepared.snapshot),
        databaseTargetFingerprint: 'b'.repeat(64),
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: prepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('database target does not match');
    expect(client.queryLog).toHaveLength(0);
    expect(
      client.queryLog.some((query) => query.includes('fixerrors:delete-error-batch'))
    ).toBe(false);
  });

  it('FXERR-RB-001 records committed cleanup and treats post-commit artifact failure as committed_unverified', async () => {
    const rows = [makeError(1)];
    const successful = await analyzedSnapshot(rows);
    await executeVerifiedSnapshotCleanup({
      client: new CleanupClient({ rows }),
      confirmation: confirmation(successful.snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      latestSnapshotPath: null,
      analysisPath: ANALYSIS_PATH,
      io: successful.io,
      lock: new MemoryLock(),
      now: EXPORT_TIME,
    });
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, successful.io).cleanup.status).toBe(
      'committed'
    );

    const uncertain = await analyzedSnapshot(rows);
    uncertain.io.failCompletedOutcomeWrite = true;
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: confirmation(uncertain.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: uncertain.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('audit outcome is unverified');
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, uncertain.io).cleanup.status).toBe(
      'committed_unverified'
    );
  });

  it('FXERR-TX-001 records an unknown commit outcome as indeterminate and blocks retry', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    client.commitThenThrow = true;

    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(prepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: prepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({ outcome: 'indeterminate' });
    expect(client.errorRows.size).toBe(0);
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, prepared.io).cleanup.status).toBe(
      'indeterminate'
    );

    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: confirmation(prepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: prepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('manual investigation');
  });

  it('FXERR-INDEP-001 has no sibling-repo path strings in new fixerrors modules/tests', () => {
    const siblingRepo = ['avs', 'work', 'log'].join('');
    const forbidden = new RegExp(`${siblingRepo}|Websites[/\\\\]+${siblingRepo}`, 'i');
    const paths = [
      'scripts/fixerrors-safety.ts',
      'scripts/automation/trusted-operational-actions.ts',
      'scripts/fixerrors.ts',
      'tests/unit/trusted-operational-actions.test.ts',
    ];
    for (const relativePath of paths) {
      const contents = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(contents).not.toMatch(forbidden);
    }
  });
});
