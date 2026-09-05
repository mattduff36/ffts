import {
  ERROR_LOG_RETENTION_MONTHS,
  ERROR_SNAPSHOT_DIRECTORY,
  ERROR_SNAPSHOT_PATH,
  __testOnlyAssertLocalV4SnapshotOrThrow,
  __testOnlyExecuteVerifiedSnapshotCleanup as executeVerifiedSnapshotCleanup,
  assertFixerrorsEntrypointPreconditions,
  assertNoClearRejected,
  assertNoLeftoverLegacySnapshots,
  computeServerIdentityFingerprint,
  fetchProductionErrorSnapshot,
  markSnapshotAnalysisCompleted,
  purgeExpiredArchivedErrorLogs,
  readAndVerifyErrorSnapshot,
  runRetentionAfterArchivePhase,
  writeAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
  type ErrorSnapshotExport,
  type PgClientLike,
  type LegacySnapshotScanFs,
  type SnapshotIo,
  type SnapshotLock,
} from '@/scripts/fixerrors-safety';
import type { ErrorLogEntry } from '@/scripts/fixerrors';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
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
const EXPORT_TIME = new Date('2026-09-05T00:00:00.000Z');
const RETENTION_CUTOFF = '2025-09-05T00:00:00.000000Z';

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function canonical(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)
    ? value
    : `${value.slice(0, -1)}000Z`;
}

function makeError(
  index: number,
  overrides: Partial<ErrorLogEntry> = {}
): ErrorLogEntry {
  const createdAt = canonical(
    new Date(EXPORT_TIME.getTime() - 60_000 + index).toISOString()
  );
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

type DbRow = ErrorLogEntry & {
  status: 'active' | 'archived';
  archived_at: string | null;
};

function dbRow(
  index: number,
  status: 'active' | 'archived' = 'active',
  archivedAt: string | null = null,
  overrides: Partial<ErrorLogEntry> = {}
): DbRow {
  return {
    ...makeError(index, overrides),
    status,
    archived_at: archivedAt,
  };
}

function compareRows(
  left: Pick<ErrorLogEntry, 'created_at' | 'id'>,
  right: Pick<ErrorLogEntry, 'created_at' | 'id'>
): number {
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
    default_expression: 'gen_random_uuid()',
  },
  {
    column_name: 'timestamp',
    data_type: 'timestamp with time zone',
    not_null: true,
    ordinal_position: 2,
    default_expression: 'now()',
  },
  {
    column_name: 'created_at',
    data_type: 'timestamp with time zone',
    not_null: true,
    ordinal_position: 3,
    default_expression: 'now()',
  },
  {
    column_name: 'status',
    data_type: 'text',
    not_null: true,
    ordinal_position: 4,
    default_expression: "'active'::text",
  },
  {
    column_name: 'archived_at',
    data_type: 'timestamp with time zone',
    not_null: false,
    ordinal_position: 5,
    default_expression: null,
  },
];

const CHECK_CONSTRAINTS = [
  {
    constraint_name: 'error_logs_status_archived_at_consistency',
    definition:
      "CHECK (status = 'active'::text AND archived_at IS NULL OR status = 'archived'::text AND archived_at IS NOT NULL)",
    validated: true,
  },
  {
    constraint_name: 'error_logs_status_check',
    definition:
      "CHECK (status = ANY (ARRAY['active'::text, 'archived'::text]))",
    validated: true,
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

class SafetyClient implements PgClientLike {
  readonly queryLog: string[] = [];
  readonly rows: Map<string, DbRow>;
  readonly alerts: string[];
  readonly usageReferences: string[];
  readonly serviceReferences: string[];
  schemaColumns = [...SCHEMA_COLUMNS];
  checkConstraints = [...CHECK_CONSTRAINTS];
  foreignKeys = [...EXPECTED_FOREIGN_KEYS];
  triggerRows = [...EXPECTED_TRIGGERS];
  dateTyped: 'boundary' | 'page' | null = null;
  countOverride: number | null = null;
  failArchiveBatch = false;
  shortRetentionDelete = false;
  afterExportBegin?: (client: SafetyClient) => void;
  private transactionRows: DbRow[] = [];
  private workingRows = new Map<string, DbRow>();
  private workingAlerts: string[] = [];
  private workingUsage: string[] = [];
  private workingService: string[] = [];

  constructor(
    rows: DbRow[],
    options: {
      alerts?: string[];
      usageReferences?: string[];
      serviceReferences?: string[];
    } = {}
  ) {
    this.rows = new Map(rows.map((row) => [row.id, row]));
    this.alerts = [...(options.alerts ?? [])];
    this.usageReferences = [...(options.usageReferences ?? [])];
    this.serviceReferences = [...(options.serviceReferences ?? [])];
  }

  activeIds(): string[] {
    return [...this.rows.values()]
      .filter((row) => row.status === 'active')
      .map((row) => row.id);
  }

  private beginWorking(): void {
    this.workingRows = new Map(
      [...this.rows].map(([id, row]) => [id, { ...row }])
    );
    this.workingAlerts = [...this.alerts];
    this.workingUsage = [...this.usageReferences];
    this.workingService = [...this.serviceReferences];
  }

  private commitWorking(): void {
    this.rows.clear();
    for (const [id, row] of this.workingRows) this.rows.set(id, row);
    this.alerts.splice(0, this.alerts.length, ...this.workingAlerts);
    this.usageReferences.splice(0, this.usageReferences.length, ...this.workingUsage);
    this.serviceReferences.splice(
      0,
      this.serviceReferences.length,
      ...this.workingService
    );
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queryLog.push(text);
    if (text.includes('fixerrors:export-begin')) {
      this.transactionRows = [...this.rows.values()]
        .filter((row) => row.status === 'active')
        .sort(compareRows)
        .map((row) => ({ ...row }));
      this.afterExportBegin?.(this);
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (
      text.includes('fixerrors:cleanup-begin') ||
      text.includes('fixerrors:retention-begin')
    ) {
      this.beginWorking();
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
      return result(this.schemaColumns) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:check-constraint-catalog')) {
      return result(this.checkConstraints) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:fk-catalog')) {
      return result(this.foreignKeys) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:trigger-catalog')) {
      return result(this.triggerRows) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:snapshot-boundary')) {
      const row = this.transactionRows.at(-1);
      return result(
        row
          ? [
              {
                id: row.id,
                created_at:
                  this.dateTyped === 'boundary'
                    ? new Date(row.created_at)
                    : row.created_at,
              },
            ]
          : []
      ) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:snapshot-count')) {
      const boundary = {
        created_at: String(values[0] ?? ''),
        id: String(values[1] ?? ''),
      };
      const count = this.transactionRows.filter(
        (row) => values[0] === null || compareRows(row, boundary) <= 0
      ).length;
      return result([
        { count: String(this.countOverride ?? count) },
      ]) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:snapshot-page')) {
      const boundary = {
        created_at: String(values[0] ?? ''),
        id: String(values[1] ?? ''),
      };
      const cursor = {
        created_at: String(values[2] ?? ''),
        id: String(values[3] ?? ''),
      };
      const rows = this.transactionRows
        .filter(
          (row) =>
            (values[0] === null || compareRows(row, boundary) <= 0) &&
            (values[2] === null || compareRows(row, cursor) > 0)
        )
        .slice(0, Number(values[4]))
        .map((row) =>
          this.dateTyped === 'page'
            ? {
                ...row,
                timestamp: new Date(row.timestamp),
                created_at: new Date(row.created_at),
              }
            : row
        );
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-alert-inventory')) {
      const ids = new Set(values[0] as string[]);
      return result(
        this.alerts
          .filter((id) => ids.has(id))
          .sort()
          .map((error_log_id) => ({ error_log_id }))
      ) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-usage-inventory')) {
      const ids = new Set(values[0] as string[]);
      return result([
        { count: String(this.usageReferences.filter((id) => ids.has(id)).length) },
      ]) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:dependency-service-inventory')) {
      const ids = new Set(values[0] as string[]);
      return result([
        { count: String(this.serviceReferences.filter((id) => ids.has(id)).length) },
      ]) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:lock-target-rows')) {
      const ids = values[0] as string[];
      return result(
        ids
          .map((id) => this.workingRows.get(id))
          .filter((row): row is DbRow => Boolean(row))
          .sort(compareRows)
      ) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:archive-error-batch')) {
      if (this.failArchiveBatch) throw new Error('forced archive failure');
      const archived = (values[0] as string[])
        .map((id) => this.workingRows.get(id))
        .filter((row): row is DbRow => Boolean(row) && row.status === 'active')
        .map((row) => {
          this.workingRows.set(row.id, {
            ...row,
            status: 'archived',
            archived_at: EXPORT_TIME.toISOString(),
          });
          return { id: row.id };
        });
      return result(archived) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:remaining-count')) {
      return result([
        {
          count: String(
            [...this.workingRows.values()].filter(
              (row) => row.status === 'active'
            ).length
          ),
        },
      ]) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:retention-cutoff')) {
      expect(values[0]).toBe(ERROR_LOG_RETENTION_MONTHS);
      return result([{ cutoff: RETENTION_CUTOFF }]) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:retention-eligible')) {
      return result(
        [...this.workingRows.values()]
          .filter(
            (row) =>
              row.status === 'archived' &&
              row.archived_at !== null &&
              row.archived_at < String(values[0])
          )
          .sort(
            (left, right) =>
              (left.archived_at ?? '').localeCompare(right.archived_at ?? '') ||
              left.id.localeCompare(right.id)
          )
          .map((row) => ({ id: row.id }))
      ) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:retention-alert-collateral')) {
      const ids = new Set(values[0] as string[]);
      return result([
        { count: String(this.workingAlerts.filter((id) => ids.has(id)).length) },
      ]) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:retention-usage-collateral')) {
      const ids = new Set(values[0] as string[]);
      return result([
        { count: String(this.workingUsage.filter((id) => ids.has(id)).length) },
      ]) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:retention-service-collateral')) {
      const ids = new Set(values[0] as string[]);
      return result([
        { count: String(this.workingService.filter((id) => ids.has(id)).length) },
      ]) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:retention-delete-batch')) {
      if (this.shortRetentionDelete) {
        return result([]) as unknown as { rows: T[]; rowCount: number };
      }
      const ids = values[0] as string[];
      const cutoff = String(values[1]);
      const deleted = ids.filter((id) => {
        const row = this.workingRows.get(id);
        if (
          !row ||
          row.status !== 'archived' ||
          !row.archived_at ||
          row.archived_at >= cutoff
        ) {
          return false;
        }
        this.workingRows.delete(id);
        this.workingAlerts = this.workingAlerts.filter((ref) => ref !== id);
        this.workingUsage = this.workingUsage.filter((ref) => ref !== id);
        this.workingService = this.workingService.filter((ref) => ref !== id);
        return true;
      });
      return result(deleted.map((id) => ({ id }))) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:retention-remaining-expired')) {
      const cutoff = String(values[0]);
      const count = [...this.workingRows.values()].filter(
        (row) =>
          row.status === 'archived' &&
          row.archived_at !== null &&
          row.archived_at < cutoff
      ).length;
      return result([{ count: String(count) }]) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (
      text.includes('fixerrors:retention-active-before') ||
      text.includes('fixerrors:retention-active-after')
    ) {
      const count = [...this.workingRows.values()].filter(
        (row) => row.status === 'active'
      ).length;
      return result([{ count: String(count) }]) as unknown as {
        rows: T[];
        rowCount: number;
      };
    }
    if (
      text.includes('fixerrors:cleanup-commit') ||
      text.includes('fixerrors:retention-commit')
    ) {
      this.commitWorking();
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (
      text.includes('fixerrors:cleanup-rollback') ||
      text.includes('fixerrors:retention-rollback')
    ) {
      return result([]) as { rows: T[]; rowCount: number };
    }
    return result([]) as { rows: T[]; rowCount: number };
  }
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

class MemoryScanFs implements LegacySnapshotScanFs {
  constructor(private readonly files: Map<string, string>) {}

  exists(path: string): boolean {
    return this.files.has(path);
  }

  read(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }

  list(directory: string): string[] {
    const root = resolve(directory);
    return [...this.files.keys()].filter((filePath) => resolve(filePath, '..') === root);
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
  client: SafetyClient,
  io = new MemoryIo()
): Promise<{ snapshot: ErrorSnapshotExport; io: MemoryIo }> {
  let snapshot = await fetchProductionErrorSnapshot(client, EXPORT_TIME);
  const report = '# verified report\n';
  snapshot = markSnapshotAnalysisCompleted(
    snapshot,
    report,
    { standard: 1 },
    EXPORT_TIME
  );
  io.writeAtomic(ANALYSIS_PATH, report);
  snapshot = writeAndVerifyErrorSnapshot(snapshot, SNAPSHOT_PATH, io);
  return { snapshot, io };
}

async function archive(
  prepared: { snapshot: ErrorSnapshotExport; io: MemoryIo },
  client: SafetyClient
) {
  return executeVerifiedSnapshotCleanup({
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
}

describe('fixerrors v4 transaction-consistent snapshot export', () => {
  it('FXERR-SNAPSHOT-001 exports active rows using keyset pages', async () => {
    for (const [count, pages] of [
      [0, 0],
      [1, 1],
      [199, 1],
      [200, 2],
      [405, 3],
    ] as const) {
      const client = new SafetyClient(
        Array.from({ length: count }, (_, index) => dbRow(index + 1))
      );
      const snapshot = await fetchProductionErrorSnapshot(client, EXPORT_TIME);

      expect(snapshot.version).toBe(3);
      expect(snapshot.safetyContract).toBe('fixerrors-exact-snapshot-v4');
      expect(snapshot.rowCount).toBe(count);
      expect(snapshot.schemaFingerprint).toHaveLength(64);
      expect(
        client.queryLog.filter((query) =>
          query.includes('fixerrors:snapshot-page')
        )
      ).toHaveLength(pages);
      expect(client.queryLog.some((query) => /\bOFFSET\b/iu.test(query))).toBe(
        false
      );
    }
  });

  it('excludes a post-BEGIN backdated row and archive preserves it', async () => {
    const initial = [dbRow(1), dbRow(2), dbRow(3)];
    const concurrent = dbRow(4, 'active', null, {
      timestamp: '2020-01-01T00:00:00.000000Z',
      created_at: '2020-01-01T00:00:00.000000Z',
    });
    const exportClient = new SafetyClient(initial);
    exportClient.afterExportBegin = (client) => {
      client.rows.set(concurrent.id, concurrent);
    };
    const prepared = await analyzedSnapshot(exportClient);
    expect(prepared.snapshot.exactIds).toEqual(initial.map((row) => row.id));

    const cleanupClient = new SafetyClient([...initial, concurrent]);
    await archive(prepared, cleanupClient);
    expect(cleanupClient.activeIds()).toEqual([concurrent.id]);
    expect(cleanupClient.rows.size).toBe(4);
  });

  it('FXERR-ACTIVE-022 exports only active rows with native ROW predicates', async () => {
    const active = dbRow(1);
    const archived = dbRow(2, 'archived', '2026-01-01T00:00:00.000000Z');
    const client = new SafetyClient([active, archived]);
    const snapshot = await fetchProductionErrorSnapshot(client, EXPORT_TIME);
    expect(snapshot.exactIds).toEqual([active.id]);
    expect(
      client.queryLog.some(
        (query) =>
          query.includes('fixerrors:snapshot-page') &&
          query.includes("error_logs.status = 'active'") &&
          query.includes('ROW(error_logs.created_at, error_logs.id)')
      )
    ).toBe(true);
  });

  it('FXERR-TS-PREC-015 / FXERR-TS-ORDER-016 preserves microsecond boundary order', async () => {
    const first = dbRow(1, 'active', null, {
      timestamp: '2026-09-04T21:50:14.694001Z',
      created_at: '2026-09-04T21:50:14.694001Z',
    });
    const second = dbRow(2, 'active', null, {
      timestamp: '2026-09-04T21:50:14.694999Z',
      created_at: '2026-09-04T21:50:14.694999Z',
    });
    const client = new SafetyClient([second, first]);
    const snapshot = await fetchProductionErrorSnapshot(client, EXPORT_TIME);
    expect(snapshot.exactIds).toEqual([first.id, second.id]);
    expect(snapshot.boundary?.createdAt).toBe(second.created_at);
    expect(
      client.queryLog.some(
        (query) =>
          query.includes('fixerrors:snapshot-boundary') &&
          query.includes("to_char(error_logs.created_at AT TIME ZONE 'UTC'")
      )
    ).toBe(true);
  });

  it('FXERR-TS-DATE-017 rejects Date-typed boundary and page timestamps', async () => {
    const boundaryClient = new SafetyClient([dbRow(1)]);
    boundaryClient.dateTyped = 'boundary';
    await expect(
      fetchProductionErrorSnapshot(boundaryClient, EXPORT_TIME)
    ).rejects.toThrow('Date-typed boundary created_at');

    const pageClient = new SafetyClient([dbRow(1)]);
    pageClient.dateTyped = 'page';
    await expect(
      fetchProductionErrorSnapshot(pageClient, EXPORT_TIME)
    ).rejects.toThrow('Date-typed timestamp');
  });
});

describe('fixerrors v4 exact archive', () => {
  it('archives exact IDs without deleting alerts', async () => {
    const rows = [dbRow(1), dbRow(2)];
    const prepared = await analyzedSnapshot(new SafetyClient(rows));
    const client = new SafetyClient([...rows, dbRow(99)], {
      alerts: [rows[0].id],
    });
    const archived = await archive(prepared, client);

    expect(archived.reconciliationState).toBe('archived');
    expect(archived.archivedErrorLogIds).toEqual(rows.map((row) => row.id));
    expect(client.activeIds()).toEqual([uuid(99)]);
    expect(client.alerts).toEqual([rows[0].id]);
    expect(
      client.queryLog.some((query) => query.includes('DELETE FROM'))
    ).toBe(false);
    expect(
      client.queryLog.some(
        (query) =>
          query.includes('fixerrors:lock-target-rows') &&
          query.includes("to_char(error_logs.timestamp AT TIME ZONE 'UTC'") &&
          query.includes("to_char(error_logs.created_at AT TIME ZONE 'UTC'")
      )
    ).toBe(true);
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, prepared.io).cleanup.status).toBe(
      'completed'
    );
  });

  it('archives rows whose created_at has non-zero microseconds', async () => {
    const first = dbRow(1, 'active', null, {
      timestamp: '2026-09-04T21:50:14.694001Z',
      created_at: '2026-09-04T21:50:14.694001Z',
    });
    const second = dbRow(2, 'active', null, {
      timestamp: '2026-09-04T21:50:14.694888Z',
      created_at: '2026-09-04T21:50:14.694888Z',
    });
    const prepared = await analyzedSnapshot(new SafetyClient([first, second]));
    expect(prepared.snapshot.boundary?.createdAt).toBe(second.created_at);
    expect(prepared.snapshot.errors.map((row) => row.created_at)).toEqual([
      first.created_at,
      second.created_at,
    ]);

    const archived = await archive(prepared, new SafetyClient([first, second]));
    expect(archived.reconciliationState).toBe('archived');
    expect(archived.archivedErrorLogIds).toEqual([first.id, second.id]);
    expect(archived.clearedCount).toBe(2);
  });

  it('FXERR-SCHEMA-001 binds exact archive columns, checks, FKs, and triggers', async () => {
    const rows = [dbRow(1)];
    const columnDrift = new SafetyClient(rows);
    columnDrift.schemaColumns = columnDrift.schemaColumns.map((column) =>
      column.column_name === 'status'
        ? { ...column, default_expression: "'archived'::text" }
        : column
    );
    await expect(
      fetchProductionErrorSnapshot(columnDrift, EXPORT_TIME)
    ).rejects.toThrow('archive column safety contract changed');

    const checkDrift = new SafetyClient(rows);
    checkDrift.checkConstraints = checkDrift.checkConstraints.slice(1);
    await expect(
      fetchProductionErrorSnapshot(checkDrift, EXPORT_TIME)
    ).rejects.toThrow('check-constraint safety contract changed');

    const prepared = await analyzedSnapshot(new SafetyClient(rows));
    const fingerprintDrift = new SafetyClient(rows);
    fingerprintDrift.schemaColumns = [
      ...fingerprintDrift.schemaColumns,
      {
        column_name: 'unexpected',
        data_type: 'text',
        not_null: false,
        ordinal_position: 99,
        default_expression: null,
      },
    ];
    await expect(archive(prepared, fingerprintDrift)).rejects.toThrow(
      'schema fingerprint mismatch'
    );
  });

  it('fails closed on mixed state and reconciles all-already-archived state', async () => {
    const rows = [dbRow(1), dbRow(2)];
    const mixedPrepared = await analyzedSnapshot(new SafetyClient(rows));
    const mixed = new SafetyClient([
      rows[0],
      { ...rows[1], status: 'archived', archived_at: EXPORT_TIME.toISOString() },
    ]);
    await expect(archive(mixedPrepared, mixed)).rejects.toThrow(
      'mixed archive state'
    );
    expect(mixed.activeIds()).toEqual([rows[0].id]);

    const archivedPrepared = await analyzedSnapshot(new SafetyClient(rows));
    const alreadyArchived = new SafetyClient(
      rows.map((row) => ({
        ...row,
        status: 'archived' as const,
        archived_at: EXPORT_TIME.toISOString(),
      }))
    );
    const reconciled = await archive(archivedPrepared, alreadyArchived);
    expect(reconciled.reconciliationState).toBe('already_archived');
    expect(
      alreadyArchived.queryLog.some((query) =>
        query.includes('fixerrors:archive-error-batch')
      )
    ).toBe(false);
  });
});

describe('fixerrors v4 filesystem gates and artifacts', () => {
  it('FXERR-ART-001 atomically writes and read-verifies text artifacts', () => {
    const io = new MemoryIo();
    writeAndVerifyTextArtifactAtomic(ANALYSIS_PATH, '# report\n', io);
    expect(io.read(ANALYSIS_PATH)).toBe('# report\n');
    expect(() =>
      writeAndVerifyTextArtifactAtomic(ANALYSIS_PATH, '# report\n', {
        writeAtomic() {},
        read: () => 'different',
      })
    ).toThrow('Text artifact readback mismatch');
  });

  it('FXERR-TARGET-001 rejects a target mismatch before transactional archive', async () => {
    const rows = [dbRow(1)];
    const prepared = await analyzedSnapshot(new SafetyClient(rows));
    const client = new SafetyClient(rows);
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
    expect(
      client.queryLog.some((query) => query.includes('fixerrors:cleanup-begin'))
    ).toBe(false);
  });

  it('FXERR-V1-REJECT-019 rejects v1/v2/v3 leftovers with filesystem-only work', async () => {
    const rows = [dbRow(1)];
    const prepared = await analyzedSnapshot(new SafetyClient(rows));
    const client = new SafetyClient(rows);
    for (const safetyContract of [
      'fixerrors-exact-snapshot-v1',
      'fixerrors-exact-snapshot-v2',
      'fixerrors-exact-snapshot-v3',
    ]) {
      const io = new MemoryIo();
      io.writeAtomic(
        SNAPSHOT_PATH,
        JSON.stringify({
          ...prepared.snapshot,
          safetyContract,
        })
      );
      expect(() =>
        __testOnlyAssertLocalV4SnapshotOrThrow({
          confirmation: {
            ...confirmation(prepared.snapshot),
            safetyContract,
          },
          snapshotPath: SNAPSHOT_PATH,
          io,
        })
      ).toThrow('rejects leftover v1/v2/v3');

      const defaultPathFs = new MemoryScanFs(
        new Map([
          [
            ERROR_SNAPSHOT_PATH,
            JSON.stringify({
              ...prepared.snapshot,
              safetyContract,
            }),
          ],
        ])
      );
      expect(() => assertNoLeftoverLegacySnapshots(defaultPathFs)).toThrow(
        'rejects leftover v1/v2/v3'
      );
      expect(() =>
        assertFixerrorsEntrypointPreconditions(['--cleanup'], defaultPathFs)
      ).toThrow('rejects leftover v1/v2/v3');
      expect(() => assertFixerrorsEntrypointPreconditions([], defaultPathFs)).toThrow(
        'rejects leftover v1/v2/v3'
      );

      const directoryFs = new MemoryScanFs(
        new Map([
          [
            resolve(ERROR_SNAPSHOT_DIRECTORY, `${prepared.snapshot.snapshotId}.json`),
            JSON.stringify({
              version: 2,
              safetyContract,
            }),
          ],
        ])
      );
      expect(() => assertNoLeftoverLegacySnapshots(directoryFs)).toThrow(
        'rejects leftover v1/v2/v3'
      );
    }
    expect(client.queryLog).toEqual([]);
    expect(() =>
      assertFixerrorsEntrypointPreconditions([], new MemoryScanFs(new Map()))
    ).not.toThrow();

    const script = resolve(process.cwd(), 'scripts/fixerrors.ts');
    const tsxCli = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
    for (const args of [
      [] as string[],
      ['--cleanup', '--snapshot-id=00000000-0000-4000-8000-000000000001'],
    ]) {
      const root = mkdtempSync(join(tmpdir(), 'fxerr-v1-'));
      try {
        mkdirSync(join(root, 'docs_private'), { recursive: true });
        writeFileSync(
          join(root, 'docs_private', 'error-snapshot.json'),
          JSON.stringify({
            version: 1,
            safetyContract: 'fixerrors-exact-snapshot-v1',
          })
        );
        const spawned = spawnSync(process.execPath, [tsxCli, script, ...args], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            POSTGRES_URL_NON_POOLING: 'postgresql://should-not-connect.invalid:5432/ffts',
            POSTGRES_URL: '',
          },
          timeout: 30_000,
          windowsHide: true,
        });
        const output = `${spawned.stdout ?? ''}\n${spawned.stderr ?? ''}\n${spawned.error?.message ?? ''}`;
        expect(spawned.status, output).not.toBe(0);
        expect(output).toMatch(/rejects leftover v1\/v2\/v3/u);
        expect(output).not.toMatch(
          /should-not-connect|ECONNREFUSED|getaddrinfo|FIXERRORS - Error Analysis/iu
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('FXERR-NOCLEAR-024 rejects --no-clear before DB setup', () => {
    expect(() => assertNoClearRejected(['--no-clear'])).toThrow(
      '--no-clear is not supported'
    );
    expect(() => assertNoClearRejected([])).not.toThrow();
  });
});

describe('fixerrors 12-month archived retention', () => {
  it('deletes only captured expired archived IDs and records collateral', async () => {
    const expired = dbRow(1, 'archived', '2024-01-01T00:00:00.000000Z');
    const recent = dbRow(2, 'archived', '2026-08-01T00:00:00.000000Z');
    const active = dbRow(3);
    const exportSnapshot = await fetchProductionErrorSnapshot(
      new SafetyClient([active]),
      EXPORT_TIME
    );
    const client = new SafetyClient([expired, recent, active], {
      alerts: [expired.id, recent.id],
      usageReferences: [expired.id],
      serviceReferences: [expired.id],
    });
    const purged = await runRetentionAfterArchivePhase('archived', () =>
      purgeExpiredArchivedErrorLogs(client, exportSnapshot.schemaFingerprint)
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
    expect([...client.rows.keys()]).toEqual([recent.id, active.id]);
    expect(client.alerts).toEqual([recent.id]);
    expect(
      client.queryLog.some(
        (query) =>
          query.includes('fixerrors:retention-delete-batch') &&
          query.includes("status = 'archived'") &&
          query.includes('archived_at < $2::timestamptz')
      )
    ).toBe(true);
  });

  it('skips failed/indeterminate archive phases and binds schema', async () => {
    let calls = 0;
    for (const phase of [
      'not-ready',
      'failed',
      'mixed',
      'indeterminate',
    ] as const) {
      const skipped = await runRetentionAfterArchivePhase(phase, async () => {
        calls += 1;
        return 'unexpected';
      });
      expect(skipped).toBeNull();
    }
    expect(calls).toBe(0);

    const client = new SafetyClient([
      dbRow(1, 'archived', '2024-01-01T00:00:00.000000Z'),
    ]);
    await expect(
      purgeExpiredArchivedErrorLogs(client, 'f'.repeat(64))
    ).rejects.toMatchObject({ outcome: 'failed' });
    expect(
      client.queryLog.some((query) =>
        query.includes('fixerrors:retention-delete-batch')
      )
    ).toBe(false);

    const shortDelete = new SafetyClient([
      dbRow(2, 'archived', '2024-01-01T00:00:00.000000Z'),
    ]);
    shortDelete.shortRetentionDelete = true;
    const matchingSnapshot = await fetchProductionErrorSnapshot(
      new SafetyClient([dbRow(3)]),
      EXPORT_TIME
    );
    await expect(
      purgeExpiredArchivedErrorLogs(
        shortDelete,
        matchingSnapshot.schemaFingerprint
      )
    ).rejects.toMatchObject({ outcome: 'failed' });
    expect(shortDelete.rows.has(uuid(2))).toBe(true);
    expect(
      shortDelete.queryLog.some((query) =>
        query.includes('fixerrors:retention-rollback')
      )
    ).toBe(true);
  });
});

describe('fixerrors v4 migration contract', () => {
  it('defines additive archive columns, checks, indexes, and update policy', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260905_error_logs_archive_status.sql'
      ),
      'utf8'
    );
    expect(sql).toContain("status TEXT NOT NULL DEFAULT 'active'");
    expect(sql).toContain('archived_at TIMESTAMPTZ');
    expect(sql).toContain('error_logs_status_check');
    expect(sql).toContain('error_logs_status_archived_at_consistency');
    expect(sql).toContain('idx_error_logs_active_created_at');
    expect(sql).toContain('idx_error_logs_active_timestamp');
    expect(sql).toContain('idx_error_logs_archived_at');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('is_actual_super_admin()');
    expect(sql).toContain('admin@mpdee.co.uk');
    expect(sql).toContain('WITH CHECK');
  });
});
