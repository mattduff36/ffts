import { createHash, randomUUID } from 'crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import type { ErrorLogEntry } from './fixerrors';
import { TRUSTED_OPERATIONAL_ACTIONS } from './automation/trusted-operational-actions';

export const ERROR_FETCH_PAGE_SIZE = 200;
export const ERROR_ARCHIVE_BATCH_SIZE = 100;
export const ERROR_DELETE_BATCH_SIZE = ERROR_ARCHIVE_BATCH_SIZE;
export const ERROR_LOG_RETENTION_MONTHS = 12;
export const ERROR_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const ERROR_SNAPSHOT_PATH = resolve(
  process.cwd(),
  'docs_private',
  'error-snapshot.json'
);
export const ERROR_SNAPSHOT_DIRECTORY = resolve(
  process.cwd(),
  'docs_private',
  'error-snapshots'
);
export const ERROR_ANALYSIS_PATH = resolve(
  process.cwd(),
  'docs_private',
  'error-analysis.md'
);

const OPERATION = TRUSTED_OPERATIONAL_ACTIONS.fixerrors;

const SET_NULL_COLLATERAL_NOTE =
  'service_health_events.updated_at may change via trigger when recovery_error_log_id is SET NULL';
const CASCADE_COLLATERAL_NOTE =
  'error_log_alerts rows are deleted by ON DELETE CASCADE during expired archived retention';

export interface PgClientLike {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export type ErrorSnapshotBoundary = {
  createdAt: string;
  id: string;
};

export type ErrorLogRetentionCollateral = {
  cascadedAlertCount: number;
  userUsageEventsNulled: number;
  serviceHealthEventsNulled: number;
  notes: string[];
};

export type ErrorSnapshotReconciliationState =
  | 'not_started'
  | 'archived'
  | 'already_archived'
  | 'failed'
  | 'indeterminate';

export type ErrorSnapshotCleanup = {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'indeterminate';
  attemptedAt: string | null;
  completedAt: string | null;
  archivedErrorLogIds: string[];
  attemptedErrorLogIds: string[];
  reconciliationState: ErrorSnapshotReconciliationState;
  remainingActiveCount: number | null;
  error: string | null;
};

export type ErrorSnapshotDependencies = {
  alertErrorLogIds: string[];
  userUsageEventsReferencing: number;
  serviceHealthEventsReferencing: number;
};

export type ErrorSnapshotExport = {
  version: 3;
  commandId: 'fixerrors';
  safetyContract: string;
  snapshotId: string;
  databaseTargetFingerprint: string;
  schemaFingerprint: string;
  exportedAt: string;
  expiresAt: string;
  transactionStartedAt: string;
  table: string;
  boundary: ErrorSnapshotBoundary | null;
  expectedRowCount: number;
  rowCount: number;
  exactIds: string[];
  checksum: string;
  manifestChecksum: string;
  dependencies: ErrorSnapshotDependencies;
  errors: ErrorLogEntry[];
  analysis: {
    status: 'pending' | 'completed';
    reportPath: 'docs_private/error-analysis.md';
    reportChecksum: string | null;
    completedAt: string | null;
    clusterCount: number;
    clusterLanes: Record<string, number>;
  };
  cleanup: ErrorSnapshotCleanup;
};

export type SnapshotIo = {
  writeAtomic(path: string, content: string): void;
  read(path: string): string;
};

export type LegacySnapshotScanFs = {
  exists(path: string): boolean;
  read(path: string): string;
  list(directory: string): string[];
};

export type SnapshotLock = {
  acquire(lockPath: string, snapshotId: string): () => void;
};

export type CleanupConfirmation = {
  snapshotId: string;
  checksum: string;
  rowCount: number;
  databaseTargetFingerprint: string;
  expiresAt: string;
  safetyContract: string;
  manifestChecksum: string;
};

export type ErrorLogClearResult = {
  clearedCount: number;
  /** @deprecated Archive never deletes alerts; retained until fixerrors.ts v4 lands. */
  clearedAlertCount: number;
  remainingCount: number;
  archivedErrorLogIds: string[];
  reconciliationState: 'archived' | 'already_archived';
  /** @deprecated Archive has no FK collateral; retention reports real collateral. */
  collateral: ErrorLogRetentionCollateral;
};

type ForeignKeyContract = {
  childSchema: string;
  childTable: string;
  childColumns: string[];
  parentColumns: string[];
  deleteAction: string;
};

type TriggerContract = {
  table: string;
  triggerName: string;
};

type SchemaCatalog = {
  columns: Array<{
    columnName: string;
    dataType: string;
    notNull: boolean;
    ordinalPosition: number;
    defaultExpression: string | null;
  }>;
  checkConstraints: CheckConstraintContract[];
  foreignKeys: ForeignKeyContract[];
  triggers: TriggerContract[];
};

type CheckConstraintContract = {
  constraintName: string;
  definition: string;
  validated: boolean;
};

export type FixerrorsRelationConfig = {
  schema: string;
  errorLogsTable: string;
  errorLogAlertsTable: string;
  userUsageEventsTable: string;
  serviceHealthEventsTable: string;
  expectedTriggers: readonly TriggerContract[];
};

const DEFAULT_FIXERRORS_RELATIONS: FixerrorsRelationConfig = {
  schema: 'public',
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
};

let activeRelations: FixerrorsRelationConfig = DEFAULT_FIXERRORS_RELATIONS;

function assertSafeSqlIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Unsafe SQL identifier for ${label}`);
  }
  return value;
}

function getRelations(): FixerrorsRelationConfig {
  return activeRelations;
}

function qualifiedTable(tableName: string): string {
  const schema = assertSafeSqlIdentifier(getRelations().schema, 'schema');
  const table = assertSafeSqlIdentifier(tableName, 'table');
  return `"${schema}"."${table}"`;
}

function expectedForeignKeys(): ForeignKeyContract[] {
  const relations = getRelations();
  return [
    {
      childSchema: relations.schema,
      childTable: relations.errorLogAlertsTable,
      childColumns: ['error_log_id'],
      parentColumns: ['id'],
      deleteAction: 'CASCADE',
    },
    {
      childSchema: relations.schema,
      childTable: relations.serviceHealthEventsTable,
      childColumns: ['recovery_error_log_id'],
      parentColumns: ['id'],
      deleteAction: 'SET NULL',
    },
    {
      childSchema: relations.schema,
      childTable: relations.userUsageEventsTable,
      childColumns: ['error_log_id'],
      parentColumns: ['id'],
      deleteAction: 'SET NULL',
    },
  ];
}

function relationTableName(): string {
  const relations = getRelations();
  return `${relations.schema}.${relations.errorLogsTable}`;
}

/** @internal Test-only relation override for ephemeral schemas; unavailable outside Vitest. */
export function __testOnlyConfigureFixerrorsRelations(
  relations: FixerrorsRelationConfig | null
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('The fixerrors relation test harness is unavailable');
  }
  activeRelations = relations ?? DEFAULT_FIXERRORS_RELATIONS;
}

const DEFAULT_LEGACY_SNAPSHOT_SCAN_FS: LegacySnapshotScanFs = {
  exists(path) {
    return existsSync(path);
  },
  read(path) {
    return readFileSync(path, 'utf8');
  },
  list(directory) {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).map((name) => resolve(directory, name));
  },
};

const DEFAULT_SNAPSHOT_IO: SnapshotIo = {
  writeAtomic(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor: number | null = null;
    try {
      descriptor = openSync(temporaryPath, 'wx');
      writeFileSync(descriptor, content, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      renameSync(temporaryPath, path);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  },
  read(path) {
    return readFileSync(path, 'utf8');
  },
};

const DEFAULT_SNAPSHOT_LOCK: SnapshotLock = {
  acquire(lockPath, snapshotId) {
    mkdirSync(dirname(lockPath), { recursive: true });
    const artifactLockPath = `${lockPath}.lock`;
    let descriptor: number | null = null;
    try {
      descriptor = openSync(artifactLockPath, 'wx');
      writeFileSync(
        descriptor,
        JSON.stringify({
          snapshotId,
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }),
        'utf8'
      );
      fsyncSync(descriptor);
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      throw new Error(
        `Another fixerrors export or cleanup owns the artifact lock: ${safeErrorMessage(error)}`
      );
    }
    return () => {
      if (descriptor !== null) {
        closeSync(descriptor);
        descriptor = null;
      }
      rmSync(artifactLockPath, { force: true });
    };
  },
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value
  );
}

function requireSnapshotUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new Error(
      `Production error snapshot contains an invalid ${field}; cleanup blocked`
    );
  }
  return value;
}

export function getErrorSnapshotArtifactPath(snapshotId: string): string {
  if (!isUuid(snapshotId)) {
    throw new Error('Invalid fixerrors snapshot identifier');
  }
  return resolve(ERROR_SNAPSHOT_DIRECTORY, `${snapshotId}.json`);
}

export function acquireErrorSnapshotArtifactLock(
  snapshotId: string,
  lock: SnapshotLock = DEFAULT_SNAPSHOT_LOCK,
  lockPath = ERROR_SNAPSHOT_PATH
): () => void {
  if (!isUuid(snapshotId)) {
    throw new Error('Invalid fixerrors snapshot identifier');
  }
  return lock.acquire(lockPath, snapshotId);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, ' ').slice(0, 500);
}

const SNAPSHOT_TIMESTAMPTZ_TEXT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const SNAPSHOT_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/u;

function snapshotTimestamptzTextSql(
  column: 'created_at' | 'timestamp',
  qualifier?: string
): string {
  const reference = qualifier ? `${qualifier}.${column}` : column;
  return `to_char(${reference} AT TIME ZONE 'UTC', '${SNAPSHOT_TIMESTAMPTZ_TEXT_FORMAT}')`;
}

const ERROR_LOG_SNAPSHOT_PROJECTION = `
            error_logs.id::text AS id,
            ${snapshotTimestamptzTextSql('timestamp', 'error_logs')} AS timestamp,
            ${snapshotTimestamptzTextSql('created_at', 'error_logs')} AS created_at,
            error_logs.error_message,
            error_logs.error_stack,
            error_logs.error_type,
            error_logs.user_id,
            error_logs.user_email,
            error_logs.page_url,
            error_logs.user_agent,
            error_logs.component_name,
            error_logs.additional_data
`;

function normalizeOperationalTimestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Production error snapshot contains invalid ${field}; cleanup blocked`);
  }
  return parsed.toISOString();
}

function canonicalizeSnapshotTimestamp(value: unknown, field: string): string {
  if (value instanceof Date) {
    throw new Error(
      `Production error snapshot contains a Date-typed ${field}; cleanup blocked`
    );
  }
  if (typeof value !== 'string') {
    throw new Error(`Production error snapshot contains invalid ${field}; cleanup blocked`);
  }
  const match = SNAPSHOT_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Production error snapshot contains invalid ${field}; cleanup blocked`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const verified = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    verified.getUTCFullYear() !== year ||
    verified.getUTCMonth() !== month - 1 ||
    verified.getUTCDate() !== day ||
    verified.getUTCHours() !== hour ||
    verified.getUTCMinutes() !== minute ||
    verified.getUTCSeconds() !== second
  ) {
    throw new Error(`Production error snapshot contains invalid ${field}; cleanup blocked`);
  }
  return value;
}

function isValidIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
  );
}

function normalizeErrorRow(row: Record<string, unknown>): ErrorLogEntry {
  if (typeof row.id !== 'string' || row.id.trim() === '') {
    throw new Error('Production error snapshot contains an invalid ID; cleanup blocked');
  }
  return {
    id: row.id,
    timestamp: canonicalizeSnapshotTimestamp(row.timestamp, 'timestamp'),
    created_at: canonicalizeSnapshotTimestamp(row.created_at, 'created_at'),
    error_message: String(row.error_message ?? ''),
    error_stack: row.error_stack == null ? null : String(row.error_stack),
    error_type: String(row.error_type ?? ''),
    user_id: row.user_id == null ? null : String(row.user_id),
    user_email: row.user_email == null ? null : String(row.user_email),
    page_url: String(row.page_url ?? ''),
    user_agent: String(row.user_agent ?? ''),
    component_name: row.component_name == null ? null : String(row.component_name),
    additional_data:
      row.additional_data && typeof row.additional_data === 'object'
        ? (row.additional_data as Record<string, unknown>)
        : null,
  };
}

function compareSnapshotRows(left: ErrorLogEntry, right: ErrorLogEntry): number {
  return (
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function snapshotChecksum(errors: ErrorLogEntry[]): string {
  return sha256(JSON.stringify(errors));
}

function snapshotManifestChecksum(
  snapshot: Omit<ErrorSnapshotExport, 'manifestChecksum'>
): string {
  return sha256(
    JSON.stringify({
      version: snapshot.version,
      commandId: snapshot.commandId,
      safetyContract: snapshot.safetyContract,
      snapshotId: snapshot.snapshotId,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      schemaFingerprint: snapshot.schemaFingerprint,
      exportedAt: snapshot.exportedAt,
      expiresAt: snapshot.expiresAt,
      transactionStartedAt: snapshot.transactionStartedAt,
      table: snapshot.table,
      boundary: snapshot.boundary,
      expectedRowCount: snapshot.expectedRowCount,
      rowCount: snapshot.rowCount,
      exactIds: snapshot.exactIds,
      checksum: snapshot.checksum,
      dependencies: snapshot.dependencies,
    })
  );
}

function emptyDependencies(): ErrorSnapshotDependencies {
  return {
    alertErrorLogIds: [],
    userUsageEventsReferencing: 0,
    serviceHealthEventsReferencing: 0,
  };
}

function isValidDependencies(
  dependencies: ErrorSnapshotDependencies | undefined,
  exactIds: string[]
): dependencies is ErrorSnapshotDependencies {
  if (!dependencies) return false;
  const exactIdSet = new Set(exactIds);
  if (
    !Array.isArray(dependencies.alertErrorLogIds) ||
    !dependencies.alertErrorLogIds.every((id) => typeof id === 'string') ||
    new Set(dependencies.alertErrorLogIds).size !==
      dependencies.alertErrorLogIds.length ||
    dependencies.alertErrorLogIds.some((id) => !exactIdSet.has(id)) ||
    [...dependencies.alertErrorLogIds].sort().join(',') !==
      dependencies.alertErrorLogIds.join(',') ||
    !Number.isSafeInteger(dependencies.userUsageEventsReferencing) ||
    dependencies.userUsageEventsReferencing < 0 ||
    !Number.isSafeInteger(dependencies.serviceHealthEventsReferencing) ||
    dependencies.serviceHealthEventsReferencing < 0
  ) {
    return false;
  }
  return true;
}

function emptyCleanup(): ErrorSnapshotCleanup {
  return {
    status: 'not_started',
    attemptedAt: null,
    completedAt: null,
    archivedErrorLogIds: [],
    attemptedErrorLogIds: [],
    reconciliationState: 'not_started',
    remainingActiveCount: null,
    error: null,
  };
}

function emptyRetentionCollateral(): ErrorLogRetentionCollateral {
  return {
    cascadedAlertCount: 0,
    userUsageEventsNulled: 0,
    serviceHealthEventsNulled: 0,
    notes: [],
  };
}

const ACTIVE_ERROR_LOG_PREDICATE = `error_logs.status = 'active'`;

/** Non-authoritative connection-string helper; not used for snapshot binding. */
export function createDatabaseTargetFingerprint(connectionString: string): string {
  const url = new URL(connectionString);
  const identity = {
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
    port: url.port || '5432',
    database: url.pathname.replace(/^\/+/u, '') || 'postgres',
    username: decodeURIComponent(url.username),
  };
  return sha256(JSON.stringify(identity));
}

export type DatabaseServerIdentity = {
  databaseName: string;
  serverAddr: string;
  serverPort: string;
  systemIdentifier: string;
};

export function computeServerIdentityFingerprint(
  identity: DatabaseServerIdentity
): string {
  return sha256(
    JSON.stringify({
      databaseName: identity.databaseName,
      serverAddr: identity.serverAddr,
      serverPort: identity.serverPort,
      systemIdentifier: identity.systemIdentifier,
    })
  );
}

export async function fetchDatabaseTargetFingerprint(
  client: PgClientLike
): Promise<string> {
  const identityResult = await client.query<{
    database_name: unknown;
    server_addr: unknown;
    server_port: unknown;
    system_identifier: unknown;
  }>(`
    /* fixerrors:server-identity */
    SELECT
      current_database() AS database_name,
      COALESCE(
        CASE
          WHEN inet_server_addr() IS NULL THEN NULL
          ELSE host(inet_server_addr())
        END,
        NULLIF(current_setting('listen_addresses', true), ''),
        ''
      ) AS server_addr,
      COALESCE(
        inet_server_port()::text,
        NULLIF(current_setting('port', true), ''),
        ''
      ) AS server_port,
      system_identifier::text AS system_identifier
    FROM pg_control_system()
  `);
  const row = identityResult.rows[0];
  if (!row) {
    throw new Error('Unable to resolve database server identity; cleanup blocked');
  }
  const identity: DatabaseServerIdentity = {
    databaseName: String(row.database_name ?? ''),
    serverAddr: String(row.server_addr ?? ''),
    serverPort: String(row.server_port ?? ''),
    systemIdentifier: String(row.system_identifier ?? ''),
  };
  if (
    !identity.databaseName ||
    !identity.systemIdentifier ||
    identity.serverPort === ''
  ) {
    throw new Error('Database server identity is incomplete; cleanup blocked');
  }
  return computeServerIdentityFingerprint(identity);
}

function foreignKeyKey(contract: ForeignKeyContract): string {
  return [
    contract.childSchema,
    contract.childTable,
    contract.childColumns.join(','),
    contract.parentColumns.join(','),
    contract.deleteAction,
  ].join('.');
}

function parsePgTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value !== 'string') {
    return [];
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '{}') {
    return [];
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim().replace(/^"|"$/gu, ''))
      .filter((part) => part.length > 0);
  }
  return [trimmed];
}

function parseForeignKeyRows(rows: Array<Record<string, unknown>>): ForeignKeyContract[] {
  return rows.map((row) => ({
    childSchema: String(row.child_schema),
    childTable: String(row.child_table),
    childColumns: parsePgTextArray(row.child_columns),
    parentColumns: parsePgTextArray(row.parent_columns),
    deleteAction: String(row.delete_action),
  }));
}

function assertExpectedForeignKeys(rows: Array<Record<string, unknown>>): void {
  const actual = parseForeignKeyRows(rows);
  const expectedKeys = new Set(expectedForeignKeys().map(foreignKeyKey));
  const actualKeys = new Set(actual.map(foreignKeyKey));
  if (
    actualKeys.size !== expectedKeys.size ||
    [...actualKeys].some((key) => !expectedKeys.has(key))
  ) {
    throw new Error('error_logs foreign-key safety contract changed; cleanup blocked');
  }
}

function triggerKey(trigger: TriggerContract): string {
  return `${trigger.table}.${trigger.triggerName}`;
}

function normalizeCatalogExpression(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function checkConstraintKey(constraint: CheckConstraintContract): string {
  return [
    constraint.constraintName,
    normalizeCatalogExpression(constraint.definition),
    constraint.validated ? 'validated' : 'not-validated',
  ].join('.');
}

const EXPECTED_CHECK_CONSTRAINT_NAMES = new Set([
  'error_logs_status_check',
  'error_logs_status_archived_at_consistency',
]);
const EXPECTED_STATUS_CHECK_DEFINITION =
  "CHECK (status = ANY (ARRAY['active'::text, 'archived'::text]))";
const EXPECTED_STATUS_ARCHIVE_CONSISTENCY_DEFINITION =
  "CHECK (status = 'active'::text AND archived_at IS NULL OR status = 'archived'::text AND archived_at IS NOT NULL)";

function assertArchiveColumnContract(catalog: SchemaCatalog): void {
  const status = catalog.columns.find((column) => column.columnName === 'status');
  const archivedAt = catalog.columns.find(
    (column) => column.columnName === 'archived_at'
  );
  if (
    !status ||
    status.dataType !== 'text' ||
    !status.notNull ||
    normalizeCatalogExpression(status.defaultExpression ?? '') !== "'active'::text" ||
    !archivedAt ||
    archivedAt.dataType !== 'timestamp with time zone' ||
    archivedAt.notNull ||
    archivedAt.defaultExpression !== null
  ) {
    throw new Error('error_logs archive column safety contract changed; cleanup blocked');
  }
}

function assertExpectedCheckConstraints(
  constraints: CheckConstraintContract[]
): void {
  const names = new Set(constraints.map((constraint) => constraint.constraintName));
  if (
    names.size !== EXPECTED_CHECK_CONSTRAINT_NAMES.size ||
    [...names].some((name) => !EXPECTED_CHECK_CONSTRAINT_NAMES.has(name)) ||
    constraints.some(
      (constraint) =>
        !constraint.validated ||
        !normalizeCatalogExpression(constraint.definition).startsWith('CHECK (')
    )
  ) {
    throw new Error('error_logs check-constraint safety contract changed; cleanup blocked');
  }
  const statusDefinition = normalizeCatalogExpression(
    constraints.find(
      (constraint) => constraint.constraintName === 'error_logs_status_check'
    )?.definition ?? ''
  );
  const consistencyDefinition = normalizeCatalogExpression(
    constraints.find(
      (constraint) =>
        constraint.constraintName ===
        'error_logs_status_archived_at_consistency'
    )?.definition ?? ''
  );
  if (
    statusDefinition !== EXPECTED_STATUS_CHECK_DEFINITION ||
    consistencyDefinition !==
      EXPECTED_STATUS_ARCHIVE_CONSISTENCY_DEFINITION
  ) {
    throw new Error('error_logs check-constraint safety contract changed; cleanup blocked');
  }
}

function assertExpectedTriggers(triggers: TriggerContract[]): void {
  const expectedKeys = new Set(getRelations().expectedTriggers.map(triggerKey));
  const actualKeys = new Set(triggers.map(triggerKey));
  if (
    actualKeys.size !== expectedKeys.size ||
    [...actualKeys].some((key) => !expectedKeys.has(key))
  ) {
    throw new Error('error_logs trigger safety contract changed; cleanup blocked');
  }
}

function computeSchemaFingerprint(catalog: SchemaCatalog): string {
  return sha256(
    JSON.stringify({
      columns: catalog.columns,
      checkConstraints: [...catalog.checkConstraints]
        .map(checkConstraintKey)
        .sort((left, right) => left.localeCompare(right)),
      foreignKeys: [...catalog.foreignKeys]
        .map(foreignKeyKey)
        .sort((left, right) => left.localeCompare(right)),
      triggers: [...catalog.triggers]
        .map(triggerKey)
        .sort((left, right) => left.localeCompare(right)),
    })
  );
}

function buildFkCatalogSql(): string {
  const relations = getRelations();
  const schema = assertSafeSqlIdentifier(relations.schema, 'schema');
  const parentTable = assertSafeSqlIdentifier(relations.errorLogsTable, 'errorLogsTable');
  return `
  /* fixerrors:fk-catalog */
  SELECT
    child_ns.nspname AS child_schema,
    child.relname AS child_table,
    ARRAY(
      SELECT child_column.attname
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, position)
      JOIN pg_attribute child_column
        ON child_column.attrelid = child.oid
       AND child_column.attnum = child_key.attnum
      ORDER BY child_key.position
    ) AS child_columns,
    ARRAY(
      SELECT parent_column.attname
      FROM unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, position)
      JOIN pg_attribute parent_column
        ON parent_column.attrelid = parent.oid
       AND parent_column.attnum = parent_key.attnum
      ORDER BY parent_key.position
    ) AS parent_columns,
    CASE constraint_row.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
    END AS delete_action
  FROM pg_constraint constraint_row
  JOIN pg_class parent ON parent.oid = constraint_row.confrelid
  JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
  JOIN pg_class child ON child.oid = constraint_row.conrelid
  JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
  WHERE constraint_row.contype = 'f'
    AND parent_ns.nspname = '${schema}'
    AND parent.relname = '${parentTable}'
  ORDER BY child_ns.nspname, child.relname
`;
}

function buildTriggerCatalogSql(): string {
  const relations = getRelations();
  const schema = assertSafeSqlIdentifier(relations.schema, 'schema');
  const tables = [
    relations.errorLogsTable,
    relations.errorLogAlertsTable,
    relations.userUsageEventsTable,
    relations.serviceHealthEventsTable,
  ].map((table) => assertSafeSqlIdentifier(table, 'trigger-table'));
  const tableList = tables.map((table) => `'${table}'`).join(', ');
  return `
  /* fixerrors:trigger-catalog */
  SELECT
    table_row.relname AS table_name,
    trigger_row.tgname AS trigger_name
  FROM pg_trigger trigger_row
  JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
  JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
  WHERE schema_row.nspname = '${schema}'
    AND table_row.relname IN (${tableList})
    AND NOT trigger_row.tgisinternal
  ORDER BY table_row.relname, trigger_row.tgname
`;
}

function buildSchemaColumnsSql(): string {
  const relations = getRelations();
  const schema = assertSafeSqlIdentifier(relations.schema, 'schema');
  const table = assertSafeSqlIdentifier(relations.errorLogsTable, 'errorLogsTable');
  return `
  /* fixerrors:schema-columns */
  SELECT
    column_row.attname AS column_name,
    format_type(column_row.atttypid, column_row.atttypmod) AS data_type,
    column_row.attnotnull AS not_null,
    column_row.attnum AS ordinal_position,
    pg_get_expr(default_row.adbin, default_row.adrelid) AS default_expression
  FROM pg_attribute column_row
  JOIN pg_class table_row ON table_row.oid = column_row.attrelid
  JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
  LEFT JOIN pg_attrdef default_row
    ON default_row.adrelid = column_row.attrelid
   AND default_row.adnum = column_row.attnum
  WHERE schema_row.nspname = '${schema}'
    AND table_row.relname = '${table}'
    AND column_row.attnum > 0
    AND NOT column_row.attisdropped
  ORDER BY column_row.attnum
`;
}

function buildCheckConstraintCatalogSql(): string {
  const relations = getRelations();
  const schema = assertSafeSqlIdentifier(relations.schema, 'schema');
  const table = assertSafeSqlIdentifier(relations.errorLogsTable, 'errorLogsTable');
  return `
  /* fixerrors:check-constraint-catalog */
  SELECT
    constraint_row.conname AS constraint_name,
    pg_get_constraintdef(constraint_row.oid, true) AS definition,
    constraint_row.convalidated AS validated
  FROM pg_constraint constraint_row
  JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
  JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
  WHERE constraint_row.contype = 'c'
    AND schema_row.nspname = '${schema}'
    AND table_row.relname = '${table}'
    AND constraint_row.conname IN (
      'error_logs_status_check',
      'error_logs_status_archived_at_consistency'
    )
  ORDER BY constraint_row.conname
`;
}

async function fetchSchemaCatalog(client: PgClientLike): Promise<SchemaCatalog> {
  const columnsResult = await client.query<{
    column_name: unknown;
    data_type: unknown;
    not_null: unknown;
    ordinal_position: unknown;
    default_expression: unknown;
  }>(buildSchemaColumnsSql());
  const checkConstraintsResult = await client.query<{
    constraint_name: unknown;
    definition: unknown;
    validated: unknown;
  }>(buildCheckConstraintCatalogSql());
  const foreignKeysResult = await client.query<Record<string, unknown>>(buildFkCatalogSql());
  const triggersResult = await client.query<{
    table_name: unknown;
    trigger_name: unknown;
  }>(buildTriggerCatalogSql());

  return {
    columns: columnsResult.rows.map((row) => ({
      columnName: String(row.column_name),
      dataType: String(row.data_type),
      notNull: Boolean(row.not_null),
      ordinalPosition: Number(row.ordinal_position),
      defaultExpression:
        row.default_expression == null ? null : String(row.default_expression),
    })),
    checkConstraints: checkConstraintsResult.rows.map((row) => ({
      constraintName: String(row.constraint_name),
      definition: String(row.definition),
      validated: Boolean(row.validated),
    })),
    foreignKeys: parseForeignKeyRows(foreignKeysResult.rows),
    triggers: triggersResult.rows.map((row) => ({
      table: String(row.table_name),
      triggerName: String(row.trigger_name),
    })),
  };
}

function assertSchemaCatalogContract(catalog: SchemaCatalog): string {
  assertExpectedForeignKeys(
    catalog.foreignKeys.map((fk) => ({
      child_schema: fk.childSchema,
      child_table: fk.childTable,
      child_columns: fk.childColumns,
      parent_columns: fk.parentColumns,
      delete_action: fk.deleteAction,
    }))
  );
  assertExpectedTriggers(catalog.triggers);
  assertArchiveColumnContract(catalog);
  assertExpectedCheckConstraints(catalog.checkConstraints);
  if (catalog.columns.length === 0) {
    throw new Error('error_logs schema catalog is empty; cleanup blocked');
  }
  return computeSchemaFingerprint(catalog);
}

async function inventorySnapshotDependencies(
  client: PgClientLike,
  targetIds: string[]
): Promise<ErrorSnapshotDependencies> {
  if (targetIds.length === 0) {
    return emptyDependencies();
  }
  const relations = getRelations();
  const alerts = await client.query<{ error_log_id: unknown }>(
    `
      /* fixerrors:dependency-alert-inventory */
      SELECT error_log_id
      FROM ${qualifiedTable(relations.errorLogAlertsTable)}
      WHERE error_log_id = ANY($1::uuid[])
      ORDER BY error_log_id
    `,
    [targetIds]
  );
  const usage = await client.query<{ count: unknown }>(
    `
      /* fixerrors:dependency-usage-inventory */
      SELECT COUNT(*)::text AS count
      FROM ${qualifiedTable(relations.userUsageEventsTable)}
      WHERE error_log_id = ANY($1::uuid[])
    `,
    [targetIds]
  );
  const service = await client.query<{ count: unknown }>(
    `
      /* fixerrors:dependency-service-inventory */
      SELECT COUNT(*)::text AS count
      FROM ${qualifiedTable(relations.serviceHealthEventsTable)}
      WHERE recovery_error_log_id = ANY($1::uuid[])
    `,
    [targetIds]
  );
  const userUsageEventsReferencing = Number(usage.rows[0]?.count ?? Number.NaN);
  const serviceHealthEventsReferencing = Number(service.rows[0]?.count ?? Number.NaN);
  if (
    !Number.isSafeInteger(userUsageEventsReferencing) ||
    userUsageEventsReferencing < 0 ||
    !Number.isSafeInteger(serviceHealthEventsReferencing) ||
    serviceHealthEventsReferencing < 0
  ) {
    throw new Error('Export dependency inventory is invalid; cleanup blocked');
  }
  return {
    alertErrorLogIds: alerts.rows.map((row) => String(row.error_log_id)),
    userUsageEventsReferencing,
    serviceHealthEventsReferencing,
  };
}

export async function fetchProductionErrorSnapshot(
  client: PgClientLike,
  now = new Date()
): Promise<ErrorSnapshotExport> {
  const relations = getRelations();
  await client.query('/* fixerrors:export-begin */ BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query(
      "/* fixerrors:export-timeouts */ SET LOCAL statement_timeout = '30s'"
    );
    const transactionResult = await client.query<{
      transaction_started_at: unknown;
    }>(
      '/* fixerrors:transaction-time */ SELECT transaction_timestamp() AS transaction_started_at'
    );
    const transactionStartedAt = normalizeOperationalTimestamp(
      transactionResult.rows[0]?.transaction_started_at,
      'transaction timestamp'
    );

    const databaseTargetFingerprint = await fetchDatabaseTargetFingerprint(client);
    const schemaFingerprint = assertSchemaCatalogContract(await fetchSchemaCatalog(client));

    const boundaryResult = await client.query<{
      id: unknown;
      created_at: unknown;
    }>(`
      /* fixerrors:snapshot-boundary */
      SELECT
        error_logs.id::text AS id,
        ${snapshotTimestamptzTextSql('created_at', 'error_logs')} AS created_at
      FROM ${qualifiedTable(relations.errorLogsTable)}
      WHERE ${ACTIVE_ERROR_LOG_PREDICATE}
      ORDER BY error_logs.created_at DESC, error_logs.id DESC
      LIMIT 1
    `);
    const boundaryRow = boundaryResult.rows[0];
    const boundary = boundaryRow
      ? {
          id: requireSnapshotUuid(boundaryRow.id, 'boundary ID'),
          createdAt: canonicalizeSnapshotTimestamp(
            boundaryRow.created_at,
            'boundary created_at'
          ),
        }
      : null;

    const countResult = await client.query<{ count: unknown }>(
      `
        /* fixerrors:snapshot-count */
        SELECT COUNT(*)::text AS count
        FROM ${qualifiedTable(relations.errorLogsTable)} AS error_logs
        WHERE ${ACTIVE_ERROR_LOG_PREDICATE}
        AND (
          $1::timestamptz IS NULL
          OR ROW(error_logs.created_at, error_logs.id) <= ROW($1::timestamptz, $2::uuid)
        )
      `,
      [boundary?.createdAt ?? null, boundary?.id ?? null]
    );
    const expectedRowCount = Number(countResult.rows[0]?.count ?? Number.NaN);
    if (!Number.isSafeInteger(expectedRowCount) || expectedRowCount < 0) {
      throw new Error('Production error snapshot count is invalid; cleanup blocked');
    }

    const errors: ErrorLogEntry[] = [];
    let cursor: ErrorSnapshotBoundary | null = null;
    while (errors.length < expectedRowCount || (expectedRowCount > 0 && errors.length % ERROR_FETCH_PAGE_SIZE === 0)) {
      const pageResult: {
        rows: Record<string, unknown>[];
        rowCount: number | null;
      } = await client.query<Record<string, unknown>>(
        `
          /* fixerrors:snapshot-page */
          SELECT
            ${ERROR_LOG_SNAPSHOT_PROJECTION}
          FROM ${qualifiedTable(relations.errorLogsTable)} AS error_logs
          WHERE ${ACTIVE_ERROR_LOG_PREDICATE}
          AND (
            $1::timestamptz IS NULL
            OR ROW(error_logs.created_at, error_logs.id) <= ROW($1::timestamptz, $2::uuid)
          )
          AND (
            $3::timestamptz IS NULL
            OR ROW(error_logs.created_at, error_logs.id) > ROW($3::timestamptz, $4::uuid)
          )
          ORDER BY error_logs.created_at ASC, error_logs.id ASC
          LIMIT $5
        `,
        [
          boundary?.createdAt ?? null,
          boundary?.id ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          ERROR_FETCH_PAGE_SIZE,
        ]
      );
      const page: ErrorLogEntry[] = pageResult.rows.map(normalizeErrorRow);
      if (page.length === 0) break;

      for (let index = 1; index < page.length; index += 1) {
        if (compareSnapshotRows(page[index - 1], page[index]) >= 0) {
          throw new Error('Production error snapshot page is not strictly ordered; cleanup blocked');
        }
      }
      const previousCursor = cursor;
      const last: ErrorLogEntry = page[page.length - 1];
      cursor = { createdAt: last.created_at, id: last.id };
      if (
        previousCursor &&
        (cursor.createdAt < previousCursor.createdAt ||
          (cursor.createdAt === previousCursor.createdAt &&
            cursor.id <= previousCursor.id))
      ) {
        throw new Error('Production error snapshot cursor did not advance; cleanup blocked');
      }

      errors.push(...page);
      if (page.length < ERROR_FETCH_PAGE_SIZE) break;
    }

    const uniqueIds = new Set(errors.map((error) => error.id));
    if (uniqueIds.size !== errors.length) {
      throw new Error('Production error snapshot contained duplicate IDs; cleanup blocked');
    }
    if (errors.length !== expectedRowCount) {
      throw new Error(
        `Production error snapshot count mismatch: expected ${expectedRowCount}, fetched ${errors.length}; cleanup blocked`
      );
    }
    if (boundary && errors.length > 0) {
      const last = errors[errors.length - 1];
      if (last.id !== boundary.id || last.created_at !== boundary.createdAt) {
        throw new Error('Production error snapshot boundary mismatch; cleanup blocked');
      }
    }

    const exactIds = errors.map((error) => error.id);
    const dependencies = await inventorySnapshotDependencies(client, exactIds);

    await client.query('/* fixerrors:export-commit */ COMMIT');
    const exportedAt = now.toISOString();
    const snapshotWithoutManifest: Omit<
      ErrorSnapshotExport,
      'manifestChecksum'
    > = {
      version: 3,
      commandId: 'fixerrors',
      safetyContract: OPERATION.safetyContract,
      snapshotId: randomUUID(),
      databaseTargetFingerprint,
      schemaFingerprint,
      exportedAt,
      expiresAt: new Date(now.getTime() + ERROR_SNAPSHOT_MAX_AGE_MS).toISOString(),
      transactionStartedAt,
      table: relationTableName(),
      boundary,
      expectedRowCount,
      rowCount: errors.length,
      exactIds,
      checksum: snapshotChecksum(errors),
      dependencies,
      errors,
      analysis: {
        status: 'pending',
        reportPath: 'docs_private/error-analysis.md',
        reportChecksum: null,
        completedAt: null,
        clusterCount: 0,
        clusterLanes: {},
      },
      cleanup: emptyCleanup(),
    };
    return {
      ...snapshotWithoutManifest,
      manifestChecksum: snapshotManifestChecksum(snapshotWithoutManifest),
    };
  } catch (error) {
    try {
      await client.query('/* fixerrors:export-rollback */ ROLLBACK');
    } catch {
      // Read-only export failed; preserve the original error.
    }
    throw error;
  }
}

export function verifyErrorSnapshot(
  snapshot: unknown,
  expected?: ErrorSnapshotExport
): ErrorSnapshotExport {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Production error snapshot verification failed; cleanup blocked');
  }
  const verified = snapshot as Partial<ErrorSnapshotExport>;
  if (!Array.isArray(verified.errors) || !Array.isArray(verified.exactIds)) {
    throw new Error('Production error snapshot verification failed; cleanup blocked');
  }
  const normalizedErrors = verified.errors.map((row) =>
    normalizeErrorRow(row as unknown as Record<string, unknown>)
  );
  const ids = normalizedErrors.map((error) => error.id);
  const uniqueIds = new Set(ids);
  const boundaryMatches =
    normalizedErrors.length === 0
      ? verified.boundary === null
      : verified.boundary?.id === normalizedErrors.at(-1)?.id &&
        verified.boundary?.createdAt === normalizedErrors.at(-1)?.created_at;
  const analysisValid =
    (verified.analysis?.status === 'pending' &&
      verified.analysis.reportChecksum === null &&
      verified.analysis.completedAt === null) ||
    (verified.analysis?.status === 'completed' &&
      typeof verified.analysis.reportChecksum === 'string' &&
      verified.analysis.reportChecksum.length === 64 &&
      isValidIsoTimestamp(verified.analysis.completedAt));
  const validCleanupStatuses = new Set([
    'not_started',
    'in_progress',
    'completed',
    'failed',
    'indeterminate',
  ]);
  const validReconciliationStates = new Set<ErrorSnapshotReconciliationState>([
    'not_started',
    'archived',
    'already_archived',
    'failed',
    'indeterminate',
  ]);
  const cleanup = verified.cleanup;
  const cleanupArraysValid =
    cleanup &&
    Array.isArray(cleanup.archivedErrorLogIds) &&
    cleanup.archivedErrorLogIds.every((id) => typeof id === 'string') &&
    new Set(cleanup.archivedErrorLogIds).size ===
      cleanup.archivedErrorLogIds.length &&
    Array.isArray(cleanup.attemptedErrorLogIds) &&
    cleanup.attemptedErrorLogIds.every((id) => typeof id === 'string') &&
    new Set(cleanup.attemptedErrorLogIds).size ===
      cleanup.attemptedErrorLogIds.length &&
    cleanup.archivedErrorLogIds.every((id) => uniqueIds.has(id)) &&
    cleanup.attemptedErrorLogIds.every((id) => uniqueIds.has(id)) &&
    validReconciliationStates.has(cleanup.reconciliationState) &&
    (cleanup.remainingActiveCount === null ||
      (Number.isSafeInteger(cleanup.remainingActiveCount) &&
        cleanup.remainingActiveCount >= 0)) &&
    (cleanup.error === null || typeof cleanup.error === 'string');
  const emptyCleanupArrays =
    cleanupArraysValid &&
    cleanup.archivedErrorLogIds.length === 0 &&
    cleanup.attemptedErrorLogIds.length === 0;
  const cleanupStateValid =
    cleanupArraysValid &&
    (
      (cleanup.status === 'not_started' &&
        cleanup.attemptedAt === null &&
        cleanup.completedAt === null &&
        cleanup.error === null &&
        cleanup.reconciliationState === 'not_started' &&
        cleanup.remainingActiveCount === null &&
        emptyCleanupArrays) ||
      (cleanup.status === 'in_progress' &&
        isValidIsoTimestamp(cleanup.attemptedAt) &&
        cleanup.completedAt === null &&
        cleanup.error === null &&
        cleanup.reconciliationState === 'not_started' &&
        cleanup.remainingActiveCount === null &&
        emptyCleanupArrays) ||
      (cleanup.status === 'completed' &&
        isValidIsoTimestamp(cleanup.attemptedAt) &&
        isValidIsoTimestamp(cleanup.completedAt) &&
        cleanup.error === null &&
        (cleanup.reconciliationState === 'archived' ||
          cleanup.reconciliationState === 'already_archived') &&
        Number.isSafeInteger(cleanup.remainingActiveCount) &&
        cleanup.attemptedErrorLogIds.length === ids.length &&
        cleanup.attemptedErrorLogIds.every((id, index) => id === ids[index]) &&
        cleanup.archivedErrorLogIds.length === ids.length &&
        cleanup.archivedErrorLogIds.every((id, index) => id === ids[index])) ||
      ((cleanup.status === 'failed' || cleanup.status === 'indeterminate') &&
        isValidIsoTimestamp(cleanup.attemptedAt) &&
        cleanup.completedAt === null &&
        typeof cleanup.error === 'string' &&
        cleanup.error.length > 0 &&
        cleanup.archivedErrorLogIds.length === 0 &&
        cleanup.remainingActiveCount === null &&
        cleanup.reconciliationState === cleanup.status)
    );
  const structurallyValid =
    verified.version === 3 &&
    verified.commandId === 'fixerrors' &&
    verified.safetyContract === OPERATION.safetyContract &&
    verified.table === relationTableName() &&
    typeof verified.snapshotId === 'string' &&
    isUuid(verified.snapshotId) &&
    typeof verified.databaseTargetFingerprint === 'string' &&
    verified.databaseTargetFingerprint.length === 64 &&
    typeof verified.schemaFingerprint === 'string' &&
    verified.schemaFingerprint.length === 64 &&
    isValidIsoTimestamp(verified.exportedAt) &&
    isValidIsoTimestamp(verified.expiresAt) &&
    isValidIsoTimestamp(verified.transactionStartedAt) &&
    new Date(verified.expiresAt).getTime() >
      new Date(verified.exportedAt).getTime() &&
    verified.expectedRowCount === normalizedErrors.length &&
    verified.rowCount === normalizedErrors.length &&
    boundaryMatches &&
    uniqueIds.size === normalizedErrors.length &&
    verified.exactIds.length === ids.length &&
    verified.exactIds.every((id, index) => id === ids[index]) &&
    isValidDependencies(verified.dependencies, ids) &&
    verified.checksum === snapshotChecksum(normalizedErrors) &&
    typeof verified.manifestChecksum === 'string' &&
    verified.manifestChecksum.length === 64 &&
    verified.analysis?.reportPath === 'docs_private/error-analysis.md' &&
    analysisValid &&
    verified.cleanup &&
    validCleanupStatuses.has(verified.cleanup.status) &&
    cleanupStateValid;

  if (!structurallyValid) {
    throw new Error('Production error snapshot verification failed; cleanup blocked');
  }
  const result = {
    ...verified,
    errors: normalizedErrors,
  } as ErrorSnapshotExport;
  const { manifestChecksum, ...manifestSource } = result;
  if (manifestChecksum !== snapshotManifestChecksum(manifestSource)) {
    throw new Error('Production error snapshot manifest verification failed; cleanup blocked');
  }
  if (
    expected &&
    (result.snapshotId !== expected.snapshotId ||
      result.checksum !== expected.checksum ||
      result.manifestChecksum !== expected.manifestChecksum ||
      result.rowCount !== expected.rowCount ||
      result.cleanup.status !== expected.cleanup.status ||
      result.analysis.status !== expected.analysis.status ||
      result.schemaFingerprint !== expected.schemaFingerprint)
  ) {
    throw new Error('Production error snapshot readback mismatch; cleanup blocked');
  }
  return result;
}

export function writeAndVerifyErrorSnapshot(
  snapshot: ErrorSnapshotExport,
  snapshotPath = ERROR_SNAPSHOT_PATH,
  io: SnapshotIo = DEFAULT_SNAPSHOT_IO
): ErrorSnapshotExport {
  const verifiedBeforeWrite = verifyErrorSnapshot(snapshot);
  io.writeAtomic(snapshotPath, JSON.stringify(verifiedBeforeWrite, null, 2));
  return verifyErrorSnapshot(JSON.parse(io.read(snapshotPath)), verifiedBeforeWrite);
}

export function readAndVerifyErrorSnapshot(
  snapshotPath = ERROR_SNAPSHOT_PATH,
  io: SnapshotIo = DEFAULT_SNAPSHOT_IO
): ErrorSnapshotExport {
  return verifyErrorSnapshot(JSON.parse(io.read(snapshotPath)));
}

export function writeAndVerifyTextArtifactAtomic(
  artifactPath: string,
  content: string,
  io: SnapshotIo = DEFAULT_SNAPSHOT_IO
): void {
  io.writeAtomic(artifactPath, content);
  if (io.read(artifactPath) !== content) {
    throw new Error('Text artifact readback mismatch');
  }
}

export function markSnapshotAnalysisCompleted(
  snapshot: ErrorSnapshotExport,
  reportContent: string,
  clusterLanes: Record<string, number>,
  now = new Date()
): ErrorSnapshotExport {
  return verifyErrorSnapshot({
    ...snapshot,
    analysis: {
      status: 'completed',
      reportPath: 'docs_private/error-analysis.md',
      reportChecksum: sha256(reportContent),
      completedAt: now.toISOString(),
      clusterCount: Object.values(clusterLanes).reduce(
        (total, count) => total + count,
        0
      ),
      clusterLanes,
    },
  });
}

export function markSnapshotCleanupNotRequired(
  snapshot: ErrorSnapshotExport,
  now = new Date()
): ErrorSnapshotExport {
  if (snapshot.rowCount !== 0 || snapshot.analysis.status !== 'completed') {
    throw new Error('No-op cleanup completion requires an analyzed empty snapshot');
  }
  const completedAt = now.toISOString();
  return withCleanupState(snapshot, {
    status: 'completed',
    attemptedAt: completedAt,
    completedAt,
    archivedErrorLogIds: [],
    attemptedErrorLogIds: [],
    reconciliationState: 'already_archived',
    remainingActiveCount: 0,
    error: null,
  });
}

export class ErrorCleanupTransactionError extends Error {
  readonly outcome: 'failed' | 'indeterminate';
  readonly attemptedErrorLogIds: string[];

  constructor(
    message: string,
    outcome: 'failed' | 'indeterminate',
    attemptedErrorLogIds: string[]
  ) {
    super(message);
    this.name = 'ErrorCleanupTransactionError';
    this.outcome = outcome;
    this.attemptedErrorLogIds = attemptedErrorLogIds;
  }
}

async function countRemainingActiveRows(client: PgClientLike): Promise<number> {
  const relations = getRelations();
  const remaining = await client.query<{ count: unknown }>(
    `/* fixerrors:remaining-count */ SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.errorLogsTable)} AS error_logs WHERE ${ACTIVE_ERROR_LOG_PREDICATE}`
  );
  const remainingCount = Number(remaining.rows[0]?.count ?? Number.NaN);
  if (!Number.isSafeInteger(remainingCount) || remainingCount < 0) {
    throw new Error('Remaining active error log count is invalid; cleanup rolled back');
  }
  return remainingCount;
}

async function clearProductionErrorLogs(
  client: PgClientLike,
  snapshot: ErrorSnapshotExport
): Promise<ErrorLogClearResult> {
  const verified = verifyErrorSnapshot(snapshot);
  if (
    verified.analysis.status !== 'completed' ||
    (verified.cleanup.status !== 'in_progress' &&
      verified.cleanup.status !== 'indeterminate')
  ) {
    throw new Error(
      'Cleanup requires a verified analyzed snapshot with durable in-progress evidence'
    );
  }
  const relations = getRelations();
  const targetIds = verified.exactIds;
  const attemptedErrorLogIds: string[] = [];
  let commitAttempted = false;

  await client.query('/* fixerrors:cleanup-begin */ BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(
      "/* fixerrors:cleanup-timeouts */ SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'"
    );

    const liveTargetFingerprint = await fetchDatabaseTargetFingerprint(client);
    if (liveTargetFingerprint !== verified.databaseTargetFingerprint) {
      throw new Error('Snapshot database target does not match; cleanup blocked');
    }

    await client.query(`
      /* fixerrors:cleanup-lock */
      LOCK TABLE
        ${qualifiedTable(relations.errorLogsTable)},
        ${qualifiedTable(relations.errorLogAlertsTable)},
        ${qualifiedTable(relations.serviceHealthEventsTable)},
        ${qualifiedTable(relations.userUsageEventsTable)}
      IN SHARE ROW EXCLUSIVE MODE
    `);

    if (targetIds.length === 0) {
      const schemaFingerprint = assertSchemaCatalogContract(await fetchSchemaCatalog(client));
      if (schemaFingerprint !== verified.schemaFingerprint) {
        throw new Error('Snapshot schema fingerprint mismatch; cleanup blocked');
      }
      const remainingCount = await countRemainingActiveRows(client);
      commitAttempted = true;
      await client.query('/* fixerrors:cleanup-commit */ COMMIT');
      return {
        clearedCount: 0,
        clearedAlertCount: 0,
        remainingCount,
        archivedErrorLogIds: [],
        reconciliationState: 'already_archived',
        collateral: emptyRetentionCollateral(),
      };
    }

    // Lock exact target rows before dependent / collateral inventory.
    const currentRowsResult = await client.query<Record<string, unknown>>(
      `
        /* fixerrors:lock-target-rows */
        SELECT
          ${ERROR_LOG_SNAPSHOT_PROJECTION},
          error_logs.status::text AS status
        FROM ${qualifiedTable(relations.errorLogsTable)} AS error_logs
        WHERE error_logs.id = ANY($1::uuid[])
        ORDER BY error_logs.created_at ASC, error_logs.id ASC
        FOR UPDATE
      `,
      [targetIds]
    );
    if (currentRowsResult.rows.length !== targetIds.length) {
      throw new Error('Verified snapshot rows changed or are missing; cleanup blocked');
    }
    const currentRows = currentRowsResult.rows.map(normalizeErrorRow);
    const statuses = currentRowsResult.rows.map((row) => String(row.status ?? ''));
    const allActive = statuses.every((status) => status === 'active');
    const allArchived = statuses.every((status) => status === 'archived');
    if (!allActive && !allArchived) {
      throw new Error('Verified snapshot rows have mixed archive state; cleanup blocked');
    }
    if (snapshotChecksum(currentRows) !== verified.checksum) {
      throw new Error('Verified snapshot rows changed or are missing; cleanup blocked');
    }

    const schemaFingerprint = assertSchemaCatalogContract(await fetchSchemaCatalog(client));
    if (schemaFingerprint !== verified.schemaFingerprint) {
      throw new Error('Snapshot schema fingerprint mismatch; cleanup blocked');
    }

    if (allArchived) {
      const remainingCount = await countRemainingActiveRows(client);
      commitAttempted = true;
      await client.query('/* fixerrors:cleanup-commit */ COMMIT');
      return {
        clearedCount: targetIds.length,
        clearedAlertCount: 0,
        remainingCount,
        archivedErrorLogIds: [...targetIds],
        reconciliationState: 'already_archived',
        collateral: emptyRetentionCollateral(),
      };
    }

    const archivedErrorLogIds: string[] = [];
    for (
      let index = 0;
      index < targetIds.length;
      index += ERROR_ARCHIVE_BATCH_SIZE
    ) {
      const batchIds = targetIds.slice(index, index + ERROR_ARCHIVE_BATCH_SIZE);
      attemptedErrorLogIds.push(...batchIds);
      const archived = await client.query<{ id: unknown }>(
        `
          /* fixerrors:archive-error-batch */
          UPDATE ${qualifiedTable(relations.errorLogsTable)}
          SET status = 'archived',
              archived_at = NOW()
          WHERE id = ANY($1::uuid[])
            AND status = 'active'
          RETURNING id
        `,
        [batchIds]
      );
      const archivedIds = archived.rows.map((row) => String(row.id));
      const archivedIdSet = new Set(archivedIds);
      if (
        archivedIds.length !== batchIds.length ||
        archivedIdSet.size !== batchIds.length ||
        batchIds.some((id) => !archivedIdSet.has(id))
      ) {
        throw new Error(
          `Archived ${archivedIds.length} of ${batchIds.length} exported error logs; cleanup rolled back`
        );
      }
      archivedErrorLogIds.push(...batchIds);
    }

    const remainingCount = await countRemainingActiveRows(client);

    commitAttempted = true;
    await client.query('/* fixerrors:cleanup-commit */ COMMIT');
    return {
      clearedCount: archivedErrorLogIds.length,
      clearedAlertCount: 0,
      remainingCount,
      archivedErrorLogIds,
      reconciliationState: 'archived',
      collateral: emptyRetentionCollateral(),
    };
  } catch (error) {
    if (!commitAttempted) {
      try {
        await client.query('/* fixerrors:cleanup-rollback */ ROLLBACK');
      } catch {
        throw new ErrorCleanupTransactionError(
          `Cleanup outcome is indeterminate after rollback failure: ${safeErrorMessage(error)}`,
          'indeterminate',
          attemptedErrorLogIds
        );
      }
      throw new ErrorCleanupTransactionError(
        `Cleanup transaction rolled back: ${safeErrorMessage(error)}`,
        'failed',
        attemptedErrorLogIds
      );
    }
    throw new ErrorCleanupTransactionError(
      `Cleanup commit outcome is indeterminate: ${safeErrorMessage(error)}`,
      'indeterminate',
      attemptedErrorLogIds
    );
  }
}

function withCleanupState(
  snapshot: ErrorSnapshotExport,
  cleanup: ErrorSnapshotCleanup
): ErrorSnapshotExport {
  return verifyErrorSnapshot({ ...snapshot, cleanup });
}

type VerifiedSnapshotCleanupCoreOptions = {
  client: PgClientLike;
  confirmation: CleanupConfirmation;
  databaseTargetFingerprint: string;
  snapshotPath?: string;
  latestSnapshotPath?: string | null;
  analysisPath?: string;
  io?: SnapshotIo;
  lock?: SnapshotLock;
  lockPath?: string;
  lockAlreadyHeld?: boolean;
  now?: Date;
};

async function executeVerifiedSnapshotCleanupCore(
  options: VerifiedSnapshotCleanupCoreOptions
): Promise<ErrorLogClearResult> {
  const snapshotPath =
    options.snapshotPath ??
    getErrorSnapshotArtifactPath(options.confirmation.snapshotId);
  const latestSnapshotPath =
    options.latestSnapshotPath !== undefined
      ? options.latestSnapshotPath
      : options.snapshotPath
        ? null
        : ERROR_SNAPSHOT_PATH;
  const analysisPath = options.analysisPath ?? ERROR_ANALYSIS_PATH;
  const io = options.io ?? DEFAULT_SNAPSHOT_IO;
  const now = options.now ?? new Date();
  const releaseLock = options.lockAlreadyHeld
    ? () => undefined
    : acquireErrorSnapshotArtifactLock(
        options.confirmation.snapshotId,
        options.lock ?? DEFAULT_SNAPSHOT_LOCK,
        options.lockPath ?? ERROR_SNAPSHOT_PATH
      );
  const persist = (snapshot: ErrorSnapshotExport): ErrorSnapshotExport => {
    const verified = writeAndVerifyErrorSnapshot(snapshot, snapshotPath, io);
    if (latestSnapshotPath && latestSnapshotPath !== snapshotPath) {
      try {
        writeAndVerifyErrorSnapshot(verified, latestSnapshotPath, io);
      } catch {
        // The immutable per-snapshot artifact is authoritative.
      }
    }
    return verified;
  };
  try {
    const snapshot = readAndVerifyErrorSnapshot(snapshotPath, io);
    if (
      snapshot.snapshotId !== options.confirmation.snapshotId ||
      snapshot.checksum !== options.confirmation.checksum ||
      snapshot.rowCount !== options.confirmation.rowCount ||
      snapshot.databaseTargetFingerprint !==
        options.confirmation.databaseTargetFingerprint ||
      snapshot.expiresAt !== options.confirmation.expiresAt ||
      snapshot.safetyContract !== options.confirmation.safetyContract ||
      snapshot.manifestChecksum !== options.confirmation.manifestChecksum
    ) {
      throw new Error('Cleanup confirmation does not match the verified snapshot manifest');
    }
    if (
      options.confirmation.databaseTargetFingerprint !==
        options.databaseTargetFingerprint ||
      snapshot.databaseTargetFingerprint !== options.databaseTargetFingerprint
    ) {
      throw new Error('Snapshot database target does not match; cleanup blocked');
    }
    const liveDatabaseTargetFingerprint = await fetchDatabaseTargetFingerprint(
      options.client
    );
    if (
      liveDatabaseTargetFingerprint !== options.databaseTargetFingerprint ||
      liveDatabaseTargetFingerprint !== snapshot.databaseTargetFingerprint
    ) {
      throw new Error('Snapshot database target does not match; cleanup blocked');
    }
    if (now.getTime() > new Date(snapshot.expiresAt).getTime()) {
      throw new Error('Snapshot confirmation has expired; export a fresh snapshot');
    }
    if (
      snapshot.analysis.status !== 'completed' ||
      !snapshot.analysis.reportChecksum
    ) {
      throw new Error('Error analysis artifact is incomplete; cleanup blocked');
    }
    const reportContent = io.read(analysisPath);
    if (sha256(reportContent) !== snapshot.analysis.reportChecksum) {
      throw new Error('Error analysis artifact verification failed; cleanup blocked');
    }
    if (snapshot.cleanup.status === 'completed') {
      throw new Error('Snapshot cleanup has already completed');
    }

    const resumeExistingAttempt =
      snapshot.cleanup.status === 'in_progress' ||
      snapshot.cleanup.status === 'indeterminate';
    const attemptedAt =
      resumeExistingAttempt && isValidIsoTimestamp(snapshot.cleanup.attemptedAt)
        ? snapshot.cleanup.attemptedAt
        : now.toISOString();
    const inProgress = resumeExistingAttempt
      ? snapshot
      : persist(
          withCleanupState(snapshot, {
            ...emptyCleanup(),
            status: 'in_progress',
            attemptedAt,
          })
        );
    try {
      const result = await clearProductionErrorLogs(options.client, inProgress);
      const completed = withCleanupState(inProgress, {
        status: 'completed',
        attemptedAt,
        completedAt: new Date().toISOString(),
        archivedErrorLogIds: result.archivedErrorLogIds,
        attemptedErrorLogIds: result.archivedErrorLogIds,
        reconciliationState: result.reconciliationState,
        remainingActiveCount: result.remainingCount,
        error: null,
      });
      try {
        persist(completed);
      } catch (artifactError) {
        const indeterminate = withCleanupState(inProgress, {
          status: 'indeterminate',
          attemptedAt,
          completedAt: null,
          archivedErrorLogIds: [],
          attemptedErrorLogIds: result.archivedErrorLogIds,
          reconciliationState: 'indeterminate',
          remainingActiveCount: null,
          error: `Post-commit artifact update failed: ${safeErrorMessage(artifactError)}`,
        });
        try {
          persist(indeterminate);
        } catch {
          // The durable in-progress artifact still prevents a second cleanup attempt.
        }
        throw new Error('Cleanup committed but audit outcome is indeterminate');
      }
      return result;
    } catch (error) {
      if (!(error instanceof ErrorCleanupTransactionError)) throw error;
      const outcome = withCleanupState(inProgress, {
        status: error.outcome,
        attemptedAt,
        completedAt: null,
        archivedErrorLogIds: [],
        attemptedErrorLogIds: error.attemptedErrorLogIds,
        reconciliationState: error.outcome,
        remainingActiveCount: null,
        error: safeErrorMessage(error),
      });
      try {
        persist(outcome);
      } catch {
        // Keep the durable in-progress state, which blocks unsafe retry.
      }
      throw error;
    }
  } finally {
    releaseLock();
  }
}

export function executeVerifiedSnapshotCleanup(options: {
  client: PgClientLike;
  confirmation: CleanupConfirmation;
  databaseTargetFingerprint: string;
  lockAlreadyHeld?: boolean;
}): Promise<ErrorLogClearResult> {
  return executeVerifiedSnapshotCleanupCore({
    client: options.client,
    confirmation: options.confirmation,
    databaseTargetFingerprint: options.databaseTargetFingerprint,
    lockAlreadyHeld: options.lockAlreadyHeld === true,
  });
}

/** @internal Test-only deterministic harness; unavailable outside Vitest. */
export function __testOnlyExecuteVerifiedSnapshotCleanup(
  options: VerifiedSnapshotCleanupCoreOptions
): Promise<ErrorLogClearResult> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('The fixerrors cleanup test harness is unavailable');
  }
  return executeVerifiedSnapshotCleanupCore(options);
}

export function assertNoClearRejected(args: readonly string[]): void {
  if (
    args.some(
      (argument) =>
        argument === '--no-clear' || argument.startsWith('--no-clear=')
    )
  ) {
    throw new Error(
      '--no-clear is not supported by fixerrors v4; the registered command archives its exact analyzed snapshot'
    );
  }
}

function parseSnapshotArtifactJson(raw: string): {
  version?: unknown;
  safetyContract?: unknown;
} | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const row = parsed as { version?: unknown; safetyContract?: unknown };
    if (row.version === undefined && row.safetyContract === undefined) {
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

function isLeftoverLegacySnapshot(artifact: {
  version?: unknown;
  safetyContract?: unknown;
}): boolean {
  if (
    typeof artifact.safetyContract === 'string' &&
    artifact.safetyContract !== OPERATION.safetyContract
  ) {
    return true;
  }
  return artifact.version !== undefined && artifact.version !== 3;
}

function collectLegacySnapshotScanPaths(fs: LegacySnapshotScanFs): string[] {
  const directoryFiles = fs
    .list(ERROR_SNAPSHOT_DIRECTORY)
    .filter((path) => path.endsWith('.json'));
  return [...new Set([ERROR_SNAPSHOT_PATH, ...directoryFiles])];
}

/**
 * Filesystem-only leftover scan for every fixerrors entrypoint. Opens no
 * database connection and rejects leftover v1/v2/v3 artifacts before DB setup.
 */
export function assertNoLeftoverLegacySnapshots(
  fs: LegacySnapshotScanFs = DEFAULT_LEGACY_SNAPSHOT_SCAN_FS
): void {
  for (const artifactPath of collectLegacySnapshotScanPaths(fs)) {
    if (!fs.exists(artifactPath)) continue;
    const artifact = parseSnapshotArtifactJson(fs.read(artifactPath));
    if (artifact && isLeftoverLegacySnapshot(artifact)) {
      throw new Error(
        'rejects leftover v1/v2/v3 fixerrors snapshots before any database connection'
      );
    }
  }
}

export function assertFixerrorsEntrypointPreconditions(
  args: readonly string[],
  fs: LegacySnapshotScanFs = DEFAULT_LEGACY_SNAPSHOT_SCAN_FS
): void {
  assertNoClearRejected(args);
  assertNoLeftoverLegacySnapshots(fs);
}

function assertConfirmationMatchesSnapshot(
  confirmation: CleanupConfirmation,
  snapshot: ErrorSnapshotExport
): void {
  if (
    snapshot.snapshotId !== confirmation.snapshotId ||
    snapshot.checksum !== confirmation.checksum ||
    snapshot.rowCount !== confirmation.rowCount ||
    snapshot.databaseTargetFingerprint !==
      confirmation.databaseTargetFingerprint ||
    snapshot.expiresAt !== confirmation.expiresAt ||
    snapshot.safetyContract !== confirmation.safetyContract ||
    snapshot.manifestChecksum !== confirmation.manifestChecksum
  ) {
    throw new Error('Cleanup confirmation does not match the verified snapshot manifest');
  }
}

/**
 * Filesystem-only preflight for crash-recovery cleanup. This deliberately opens
 * no database connection and rejects every pre-v4 artifact before DB startup.
 */
function assertLocalV4SnapshotCore(
  confirmation: CleanupConfirmation,
  snapshotPath: string,
  io: SnapshotIo
): ErrorSnapshotExport {
  const raw = JSON.parse(io.read(snapshotPath)) as {
    version?: unknown;
    safetyContract?: unknown;
  };
  if (
    raw.version !== 3 ||
    raw.safetyContract !== OPERATION.safetyContract
  ) {
    throw new Error(
      'Crash recovery rejects leftover v1/v2/v3 fixerrors snapshots; export a fresh v4 snapshot'
    );
  }
  const snapshot = verifyErrorSnapshot(raw);
  assertConfirmationMatchesSnapshot(confirmation, snapshot);
  return snapshot;
}

export function assertLocalV4SnapshotOrThrow(
  confirmation: CleanupConfirmation
): ErrorSnapshotExport {
  return assertLocalV4SnapshotCore(
    confirmation,
    getErrorSnapshotArtifactPath(confirmation.snapshotId),
    DEFAULT_SNAPSHOT_IO
  );
}

/** @internal Test-only filesystem-preflight harness; unavailable outside Vitest. */
export function __testOnlyAssertLocalV4SnapshotOrThrow(options: {
  confirmation: CleanupConfirmation;
  snapshotPath: string;
  io: SnapshotIo;
}): ErrorSnapshotExport {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('The fixerrors local snapshot test harness is unavailable');
  }
  return assertLocalV4SnapshotCore(
    options.confirmation,
    options.snapshotPath,
    options.io
  );
}

export type ErrorLogRetentionResult = {
  eligibleCount: number;
  purgedCount: number;
  remainingExpiredCount: number;
  remainingActiveCount: number;
  cutoffAt: string;
  schemaFingerprint: string;
  reconciliationState: 'purged' | 'none_eligible';
  collateral: ErrorLogRetentionCollateral;
};

export type RetentionArchivePhase =
  | 'archived'
  | 'already_archived'
  | 'empty-noop'
  | 'failed'
  | 'mixed'
  | 'indeterminate'
  | 'not-ready';

export async function runRetentionAfterArchivePhase<T>(
  archivePhase: RetentionArchivePhase,
  purge: () => Promise<T>
): Promise<T | null> {
  if (
    archivePhase !== 'archived' &&
    archivePhase !== 'already_archived' &&
    archivePhase !== 'empty-noop'
  ) {
    return null;
  }
  return purge();
}

async function countMatchingErrorLogs(
  client: PgClientLike,
  tag: string,
  sql: string,
  values: unknown[] = []
): Promise<number> {
  const counted = await client.query<{ count: unknown }>(
    `/* ${tag} */ ${sql}`,
    values
  );
  const count = Number(counted.rows[0]?.count ?? Number.NaN);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Retention count is invalid; purge rolled back');
  }
  return count;
}

async function inventoryRetentionCollateral(
  client: PgClientLike,
  targetIds: string[]
): Promise<ErrorLogRetentionCollateral> {
  if (targetIds.length === 0) {
    return {
      cascadedAlertCount: 0,
      userUsageEventsNulled: 0,
      serviceHealthEventsNulled: 0,
      notes: [],
    };
  }
  const relations = getRelations();
  const alerts = await countMatchingErrorLogs(
    client,
    'fixerrors:retention-alert-collateral',
    `SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.errorLogAlertsTable)} WHERE error_log_id = ANY($1::uuid[])`,
    [targetIds]
  );
  const usage = await countMatchingErrorLogs(
    client,
    'fixerrors:retention-usage-collateral',
    `SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.userUsageEventsTable)} WHERE error_log_id = ANY($1::uuid[])`,
    [targetIds]
  );
  const service = await countMatchingErrorLogs(
    client,
    'fixerrors:retention-service-collateral',
    `SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.serviceHealthEventsTable)} WHERE recovery_error_log_id = ANY($1::uuid[])`,
    [targetIds]
  );
  const notes: string[] = [];
  if (alerts > 0) notes.push(CASCADE_COLLATERAL_NOTE);
  if (usage > 0 || service > 0) notes.push(SET_NULL_COLLATERAL_NOTE);
  return {
    cascadedAlertCount: alerts,
    userUsageEventsNulled: usage,
    serviceHealthEventsNulled: service,
    notes,
  };
}

export async function purgeExpiredArchivedErrorLogs(
  client: PgClientLike,
  expectedSchemaFingerprint: string
): Promise<ErrorLogRetentionResult> {
  if (!/^[a-f0-9]{64}$/u.test(expectedSchemaFingerprint)) {
    throw new Error('Retention requires the archived snapshot schema fingerprint');
  }
  const relations = getRelations();
  let commitAttempted = false;
  await client.query(
    '/* fixerrors:retention-begin */ BEGIN ISOLATION LEVEL SERIALIZABLE'
  );
  try {
    await client.query(
      "/* fixerrors:retention-timeouts */ SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'"
    );
    await client.query(`
      /* fixerrors:retention-lock */
      LOCK TABLE
        ${qualifiedTable(relations.errorLogsTable)},
        ${qualifiedTable(relations.errorLogAlertsTable)},
        ${qualifiedTable(relations.serviceHealthEventsTable)},
        ${qualifiedTable(relations.userUsageEventsTable)}
      IN SHARE ROW EXCLUSIVE MODE
    `);
    const schemaFingerprint = assertSchemaCatalogContract(
      await fetchSchemaCatalog(client)
    );
    if (schemaFingerprint !== expectedSchemaFingerprint) {
      throw new Error('Snapshot schema fingerprint mismatch; retention blocked');
    }

    const cutoffResult = await client.query<{ cutoff: unknown }>(
      `
        /* fixerrors:retention-cutoff */
        SELECT
          to_char(
            (transaction_timestamp() - ($1::int * INTERVAL '1 month')) AT TIME ZONE 'UTC',
            '${SNAPSHOT_TIMESTAMPTZ_TEXT_FORMAT}'
          ) AS cutoff
      `,
      [ERROR_LOG_RETENTION_MONTHS]
    );
    const cutoffAt = canonicalizeSnapshotTimestamp(
      cutoffResult.rows[0]?.cutoff,
      'retention cutoff'
    );
    const eligible = await client.query<{ id: unknown }>(
      `
        /* fixerrors:retention-eligible */
        SELECT error_logs.id::text AS id
        FROM ${qualifiedTable(relations.errorLogsTable)} AS error_logs
        WHERE error_logs.status = 'archived'
          AND error_logs.archived_at IS NOT NULL
          AND error_logs.archived_at < $1::timestamptz
        ORDER BY error_logs.archived_at ASC, error_logs.id ASC
      `,
      [cutoffAt]
    );
    const eligibleIds = eligible.rows.map((row) =>
      requireSnapshotUuid(row.id, 'retention candidate ID')
    );
    if (new Set(eligibleIds).size !== eligibleIds.length) {
      throw new Error('Retention candidate set contained duplicate IDs; purge rolled back');
    }
    const collateral = await inventoryRetentionCollateral(client, eligibleIds);
    const activeBefore = await countMatchingErrorLogs(
      client,
      'fixerrors:retention-active-before',
      `SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.errorLogsTable)} AS error_logs WHERE ${ACTIVE_ERROR_LOG_PREDICATE}`
    );

    if (eligibleIds.length === 0) {
      commitAttempted = true;
      await client.query('/* fixerrors:retention-commit */ COMMIT');
      return {
        eligibleCount: 0,
        purgedCount: 0,
        remainingExpiredCount: 0,
        remainingActiveCount: activeBefore,
        cutoffAt,
        schemaFingerprint,
        reconciliationState: 'none_eligible',
        collateral,
      };
    }

    let purgedCount = 0;
    for (
      let index = 0;
      index < eligibleIds.length;
      index += ERROR_ARCHIVE_BATCH_SIZE
    ) {
      const batchIds = eligibleIds.slice(index, index + ERROR_ARCHIVE_BATCH_SIZE);
      const deleted = await client.query<{ id: unknown }>(
        `
          /* fixerrors:retention-delete-batch */
          DELETE FROM ${qualifiedTable(relations.errorLogsTable)}
          WHERE id = ANY($1::uuid[])
            AND status = 'archived'
            AND archived_at IS NOT NULL
            AND archived_at < $2::timestamptz
          RETURNING id::text AS id
        `,
        [batchIds, cutoffAt]
      );
      const deletedIds = deleted.rows.map((row) =>
        requireSnapshotUuid(row.id, 'retention deleted ID')
      );
      const deletedIdSet = new Set(deletedIds);
      if (
        deletedIds.length !== batchIds.length ||
        deletedIdSet.size !== batchIds.length ||
        batchIds.some((id) => !deletedIdSet.has(id))
      ) {
        throw new Error(
          `Retention deleted ${deletedIds.length} of ${batchIds.length} eligible rows; purge rolled back`
        );
      }
      purgedCount += deletedIds.length;
    }

    const remainingExpiredCount = await countMatchingErrorLogs(
      client,
      'fixerrors:retention-remaining-expired',
      `
        SELECT COUNT(*)::text AS count
        FROM ${qualifiedTable(relations.errorLogsTable)}
        WHERE status = 'archived'
          AND archived_at IS NOT NULL
          AND archived_at < $1::timestamptz
      `,
      [cutoffAt]
    );
    const remainingActiveCount = await countMatchingErrorLogs(
      client,
      'fixerrors:retention-active-after',
      `SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.errorLogsTable)} AS error_logs WHERE ${ACTIVE_ERROR_LOG_PREDICATE}`
    );
    const postDeleteCollateral = await inventoryRetentionCollateral(
      client,
      eligibleIds
    );
    if (
      purgedCount !== eligibleIds.length ||
      remainingExpiredCount !== 0 ||
      remainingActiveCount !== activeBefore ||
      postDeleteCollateral.cascadedAlertCount !== 0 ||
      postDeleteCollateral.userUsageEventsNulled !== 0 ||
      postDeleteCollateral.serviceHealthEventsNulled !== 0
    ) {
      throw new Error('Retention reconciliation mismatch; purge rolled back');
    }

    commitAttempted = true;
    await client.query('/* fixerrors:retention-commit */ COMMIT');
    return {
      eligibleCount: eligibleIds.length,
      purgedCount,
      remainingExpiredCount,
      remainingActiveCount,
      cutoffAt,
      schemaFingerprint,
      reconciliationState: 'purged',
      collateral,
    };
  } catch (error) {
    if (!commitAttempted) {
      try {
        await client.query('/* fixerrors:retention-rollback */ ROLLBACK');
      } catch {
        throw new ErrorCleanupTransactionError(
          `Retention outcome is indeterminate after rollback failure: ${safeErrorMessage(error)}`,
          'indeterminate',
          []
        );
      }
      throw error instanceof ErrorCleanupTransactionError
        ? error
        : new ErrorCleanupTransactionError(
            safeErrorMessage(error),
            'failed',
            []
          );
    }
    throw new ErrorCleanupTransactionError(
      `Retention commit outcome is indeterminate: ${safeErrorMessage(error)}`,
      'indeterminate',
      []
    );
  }
}
