import { createHash, randomUUID } from 'crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import type { ErrorLogEntry } from './fixerrors';
import { TRUSTED_OPERATIONAL_ACTIONS } from './automation/trusted-operational-actions';

export const ERROR_FETCH_PAGE_SIZE = 200;
export const ERROR_DELETE_BATCH_SIZE = 100;
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

export type ErrorSnapshotCleanupCollateral = {
  userUsageEventsNulled: number;
  serviceHealthEventsNulled: number;
  notes: string[];
};

export type ErrorSnapshotCleanupStatus =
  | 'not_started'
  | 'in_progress'
  | 'rejected'
  | 'rolled_back'
  | 'committed'
  | 'committed_unverified'
  | 'indeterminate';

export type ErrorSnapshotCleanup = {
  status: ErrorSnapshotCleanupStatus;
  attemptedAt: string | null;
  completedAt: string | null;
  deletedErrorLogIds: string[];
  deletedAlertIds: string[];
  attemptedErrorLogIds: string[];
  error: string | null;
  collateral: ErrorSnapshotCleanupCollateral;
};

export type ErrorSnapshotDependencies = {
  alertErrorLogIds: string[];
  userUsageEventsReferencing: number;
  serviceHealthEventsReferencing: number;
};

export type ErrorSnapshotExport = {
  version: 1;
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
  clearedAlertCount: number;
  remainingCount: number;
  deletedErrorLogIds: string[];
  deletedAlertIds: string[];
  collateral: ErrorSnapshotCleanupCollateral;
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
  }>;
  foreignKeys: ForeignKeyContract[];
  triggers: TriggerContract[];
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

function normalizeTimestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Production error snapshot contains invalid ${field}; cleanup blocked`);
  }
  return parsed.toISOString();
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
    timestamp: normalizeTimestamp(row.timestamp, 'timestamp'),
    created_at: normalizeTimestamp(row.created_at, 'created_at'),
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

function emptyCollateral(): ErrorSnapshotCleanupCollateral {
  return {
    userUsageEventsNulled: 0,
    serviceHealthEventsNulled: 0,
    notes: [],
  };
}

function emptyCleanup(): ErrorSnapshotCleanup {
  return {
    status: 'not_started',
    attemptedAt: null,
    completedAt: null,
    deletedErrorLogIds: [],
    deletedAlertIds: [],
    attemptedErrorLogIds: [],
    error: null,
    collateral: emptyCollateral(),
  };
}

function isValidCollateral(
  collateral: ErrorSnapshotCleanupCollateral | undefined
): collateral is ErrorSnapshotCleanupCollateral {
  if (!collateral) return false;
  return (
    Number.isSafeInteger(collateral.userUsageEventsNulled) &&
    collateral.userUsageEventsNulled >= 0 &&
    Number.isSafeInteger(collateral.serviceHealthEventsNulled) &&
    collateral.serviceHealthEventsNulled >= 0 &&
    Array.isArray(collateral.notes) &&
    collateral.notes.every((note) => typeof note === 'string')
  );
}

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
    column_row.attnum AS ordinal_position
  FROM pg_attribute column_row
  JOIN pg_class table_row ON table_row.oid = column_row.attrelid
  JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
  WHERE schema_row.nspname = '${schema}'
    AND table_row.relname = '${table}'
    AND column_row.attnum > 0
    AND NOT column_row.attisdropped
  ORDER BY column_row.attnum
`;
}

async function fetchSchemaCatalog(client: PgClientLike): Promise<SchemaCatalog> {
  const columnsResult = await client.query<{
    column_name: unknown;
    data_type: unknown;
    not_null: unknown;
    ordinal_position: unknown;
  }>(buildSchemaColumnsSql());
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
    const transactionStartedAt = normalizeTimestamp(
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
      SELECT id, created_at
      FROM ${qualifiedTable(relations.errorLogsTable)}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    const boundaryRow = boundaryResult.rows[0];
    const boundary = boundaryRow
      ? {
          id: String(boundaryRow.id),
          createdAt: normalizeTimestamp(boundaryRow.created_at, 'boundary created_at'),
        }
      : null;

    const countResult = await client.query<{ count: unknown }>(
      `
        /* fixerrors:snapshot-count */
        SELECT COUNT(*)::text AS count
        FROM ${qualifiedTable(relations.errorLogsTable)}
        WHERE (
          $1::timestamptz IS NULL
          OR ROW(created_at, id) <= ROW($1::timestamptz, $2::uuid)
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
            id,
            timestamp,
            created_at,
            error_message,
            error_stack,
            error_type,
            user_id,
            user_email,
            page_url,
            user_agent,
            component_name,
            additional_data
          FROM ${qualifiedTable(relations.errorLogsTable)}
          WHERE (
            $1::timestamptz IS NULL
            OR ROW(created_at, id) <= ROW($1::timestamptz, $2::uuid)
          )
          AND (
            $3::timestamptz IS NULL
            OR ROW(created_at, id) > ROW($3::timestamptz, $4::uuid)
          )
          ORDER BY created_at ASC, id ASC
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
      version: 1,
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
  const validCleanupStatuses = new Set<ErrorSnapshotCleanupStatus>([
    'not_started',
    'in_progress',
    'rejected',
    'rolled_back',
    'committed',
    'committed_unverified',
    'indeterminate',
  ]);
  const cleanup = verified.cleanup;
  const cleanupArraysValid =
    cleanup &&
    Array.isArray(cleanup.deletedErrorLogIds) &&
    cleanup.deletedErrorLogIds.every((id) => typeof id === 'string') &&
    new Set(cleanup.deletedErrorLogIds).size ===
      cleanup.deletedErrorLogIds.length &&
    Array.isArray(cleanup.deletedAlertIds) &&
    cleanup.deletedAlertIds.every((id) => typeof id === 'string') &&
    new Set(cleanup.deletedAlertIds).size === cleanup.deletedAlertIds.length &&
    Array.isArray(cleanup.attemptedErrorLogIds) &&
    cleanup.attemptedErrorLogIds.every((id) => typeof id === 'string') &&
    new Set(cleanup.attemptedErrorLogIds).size ===
      cleanup.attemptedErrorLogIds.length &&
    cleanup.deletedErrorLogIds.every((id) => uniqueIds.has(id)) &&
    cleanup.deletedAlertIds.every((id) => uniqueIds.has(id)) &&
    cleanup.attemptedErrorLogIds.every((id) => uniqueIds.has(id)) &&
    (cleanup.error === null || typeof cleanup.error === 'string') &&
    isValidCollateral(cleanup.collateral);
  const emptyCleanupArrays =
    cleanupArraysValid &&
    cleanup.deletedErrorLogIds.length === 0 &&
    cleanup.deletedAlertIds.length === 0 &&
    cleanup.attemptedErrorLogIds.length === 0;
  const emptyCollateralState =
    cleanupArraysValid &&
    cleanup.collateral.userUsageEventsNulled === 0 &&
    cleanup.collateral.serviceHealthEventsNulled === 0 &&
    cleanup.collateral.notes.length === 0;
  const cleanupStateValid =
    cleanupArraysValid &&
    (
      (cleanup.status === 'not_started' &&
        cleanup.attemptedAt === null &&
        cleanup.completedAt === null &&
        cleanup.error === null &&
        emptyCleanupArrays &&
        emptyCollateralState) ||
      (cleanup.status === 'in_progress' &&
        isValidIsoTimestamp(cleanup.attemptedAt) &&
        cleanup.completedAt === null &&
        cleanup.error === null &&
        emptyCleanupArrays &&
        emptyCollateralState) ||
      (cleanup.status === 'committed' &&
        isValidIsoTimestamp(cleanup.attemptedAt) &&
        isValidIsoTimestamp(cleanup.completedAt) &&
        cleanup.error === null &&
        cleanup.attemptedErrorLogIds.length === ids.length &&
        cleanup.attemptedErrorLogIds.every((id, index) => id === ids[index]) &&
        cleanup.deletedErrorLogIds.length === ids.length &&
        cleanup.deletedErrorLogIds.every((id, index) => id === ids[index])) ||
      ((cleanup.status === 'rejected' ||
        cleanup.status === 'rolled_back' ||
        cleanup.status === 'indeterminate' ||
        cleanup.status === 'committed_unverified') &&
        isValidIsoTimestamp(cleanup.attemptedAt) &&
        cleanup.completedAt === null &&
        typeof cleanup.error === 'string' &&
        cleanup.error.length > 0 &&
        cleanup.deletedErrorLogIds.length === 0 &&
        cleanup.deletedAlertIds.length === 0)
    );
  const structurallyValid =
    verified.version === 1 &&
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
    status: 'committed',
    attemptedAt: completedAt,
    completedAt,
    deletedErrorLogIds: [],
    deletedAlertIds: [],
    attemptedErrorLogIds: [],
    error: null,
    collateral: emptyCollateral(),
  });
}

export class ErrorCleanupTransactionError extends Error {
  readonly outcome: 'rejected' | 'rolled_back' | 'indeterminate';
  readonly attemptedErrorLogIds: string[];

  constructor(
    message: string,
    outcome: 'rejected' | 'rolled_back' | 'indeterminate',
    attemptedErrorLogIds: string[]
  ) {
    super(message);
    this.name = 'ErrorCleanupTransactionError';
    this.outcome = outcome;
    this.attemptedErrorLogIds = attemptedErrorLogIds;
  }
}

async function clearProductionErrorLogs(
  client: PgClientLike,
  snapshot: ErrorSnapshotExport
): Promise<ErrorLogClearResult> {
  const verified = verifyErrorSnapshot(snapshot);
  if (
    verified.analysis.status !== 'completed' ||
    verified.cleanup.status !== 'in_progress'
  ) {
    throw new Error(
      'Cleanup requires a verified analyzed snapshot with durable in-progress evidence'
    );
  }
  const relations = getRelations();
  const targetIds = verified.exactIds;
  const attemptedErrorLogIds: string[] = [];
  let commitAttempted = false;
  let mutationsStarted = false;

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
      const remaining = await client.query<{ count: unknown }>(
        `/* fixerrors:remaining-count */ SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.errorLogsTable)}`
      );
      const remainingCount = Number(remaining.rows[0]?.count ?? Number.NaN);
      if (!Number.isSafeInteger(remainingCount) || remainingCount < 0) {
        throw new Error('Remaining error log count is invalid; cleanup rolled back');
      }
      commitAttempted = true;
      await client.query('/* fixerrors:cleanup-commit */ COMMIT');
      return {
        clearedCount: 0,
        clearedAlertCount: 0,
        remainingCount,
        deletedErrorLogIds: [],
        deletedAlertIds: [],
        collateral: emptyCollateral(),
      };
    }

    // Lock exact target rows before dependent / collateral inventory.
    const currentRowsResult = await client.query<Record<string, unknown>>(
      `
        /* fixerrors:lock-target-rows */
        SELECT
          id,
          timestamp,
          created_at,
          error_message,
          error_stack,
          error_type,
          user_id,
          user_email,
          page_url,
          user_agent,
          component_name,
          additional_data
        FROM ${qualifiedTable(relations.errorLogsTable)}
        WHERE id = ANY($1::uuid[])
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
      `,
      [targetIds]
    );
    const currentRows = currentRowsResult.rows.map(normalizeErrorRow);
    if (
      currentRows.length !== targetIds.length ||
      snapshotChecksum(currentRows) !== verified.checksum
    ) {
      throw new Error('Verified snapshot rows changed or are missing; cleanup blocked');
    }

    const schemaFingerprint = assertSchemaCatalogContract(await fetchSchemaCatalog(client));
    if (schemaFingerprint !== verified.schemaFingerprint) {
      throw new Error('Snapshot schema fingerprint mismatch; cleanup blocked');
    }

    const liveDependencies = await inventorySnapshotDependencies(client, targetIds);
    if (
      liveDependencies.alertErrorLogIds.length !==
        verified.dependencies.alertErrorLogIds.length ||
      liveDependencies.alertErrorLogIds.some(
        (id, index) => id !== verified.dependencies.alertErrorLogIds[index]
      ) ||
      liveDependencies.userUsageEventsReferencing !==
        verified.dependencies.userUsageEventsReferencing ||
      liveDependencies.serviceHealthEventsReferencing !==
        verified.dependencies.serviceHealthEventsReferencing
    ) {
      throw new Error(
        'Snapshot dependency inventory changed after export; cleanup blocked'
      );
    }

    const collateral: ErrorSnapshotCleanupCollateral = {
      userUsageEventsNulled: liveDependencies.userUsageEventsReferencing,
      serviceHealthEventsNulled: liveDependencies.serviceHealthEventsReferencing,
      notes:
        liveDependencies.serviceHealthEventsReferencing > 0 ||
        liveDependencies.userUsageEventsReferencing > 0
          ? [SET_NULL_COLLATERAL_NOTE]
          : [],
    };

    const expectedAlertIds = liveDependencies.alertErrorLogIds;

    mutationsStarted = true;
    const deletedAlerts = await client.query<{ error_log_id: unknown }>(
      `
        /* fixerrors:delete-alerts */
        DELETE FROM ${qualifiedTable(relations.errorLogAlertsTable)}
        WHERE error_log_id = ANY($1::uuid[])
        RETURNING error_log_id
      `,
      [targetIds]
    );
    const deletedAlertIds = deletedAlerts.rows
      .map((row) => String(row.error_log_id))
      .sort();
    if (
      deletedAlertIds.length !== expectedAlertIds.length ||
      deletedAlertIds.some((id, index) => id !== expectedAlertIds[index])
    ) {
      throw new Error('Dependent diagnostic alert deletion mismatch; cleanup rolled back');
    }

    const deletedErrorLogIds: string[] = [];
    for (
      let index = 0;
      index < targetIds.length;
      index += ERROR_DELETE_BATCH_SIZE
    ) {
      const batchIds = targetIds.slice(index, index + ERROR_DELETE_BATCH_SIZE);
      attemptedErrorLogIds.push(...batchIds);
      const deleted = await client.query<{ id: unknown }>(
        `
          /* fixerrors:delete-error-batch */
          DELETE FROM ${qualifiedTable(relations.errorLogsTable)}
          WHERE id = ANY($1::uuid[])
          RETURNING id
        `,
        [batchIds]
      );
      const deletedIds = deleted.rows.map((row) => String(row.id));
      const deletedIdSet = new Set(deletedIds);
      if (
        deletedIds.length !== batchIds.length ||
        deletedIdSet.size !== batchIds.length ||
        batchIds.some((id) => !deletedIdSet.has(id))
      ) {
        throw new Error(
          `Deleted ${deletedIds.length} of ${batchIds.length} exported error logs; cleanup rolled back`
        );
      }
      deletedErrorLogIds.push(...batchIds);
    }

    const remaining = await client.query<{ count: unknown }>(
      `/* fixerrors:remaining-count */ SELECT COUNT(*)::text AS count FROM ${qualifiedTable(relations.errorLogsTable)}`
    );
    const remainingCount = Number(remaining.rows[0]?.count ?? Number.NaN);
    if (!Number.isSafeInteger(remainingCount) || remainingCount < 0) {
      throw new Error('Remaining error log count is invalid; cleanup rolled back');
    }

    commitAttempted = true;
    await client.query('/* fixerrors:cleanup-commit */ COMMIT');
    return {
      clearedCount: deletedErrorLogIds.length,
      clearedAlertCount: deletedAlertIds.length,
      remainingCount,
      deletedErrorLogIds,
      deletedAlertIds,
      collateral,
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
        mutationsStarted ? 'rolled_back' : 'rejected',
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
  const releaseLock = acquireErrorSnapshotArtifactLock(
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
    if (snapshot.cleanup.status === 'committed') {
      throw new Error('Snapshot cleanup has already completed');
    }
    if (
      snapshot.cleanup.status === 'in_progress' ||
      snapshot.cleanup.status === 'indeterminate' ||
      snapshot.cleanup.status === 'committed_unverified'
    ) {
      throw new Error('Snapshot cleanup outcome requires manual investigation');
    }

    const attemptedAt = now.toISOString();
    const inProgress = persist(
      withCleanupState(snapshot, {
        ...emptyCleanup(),
        status: 'in_progress',
        attemptedAt,
      })
    );
    try {
      const result = await clearProductionErrorLogs(options.client, inProgress);
      const completed = withCleanupState(inProgress, {
        status: 'committed',
        attemptedAt,
        completedAt: new Date().toISOString(),
        deletedErrorLogIds: result.deletedErrorLogIds,
        deletedAlertIds: result.deletedAlertIds,
        attemptedErrorLogIds: result.deletedErrorLogIds,
        error: null,
        collateral: result.collateral,
      });
      try {
        persist(completed);
      } catch (artifactError) {
        const unverified = withCleanupState(inProgress, {
          status: 'committed_unverified',
          attemptedAt,
          completedAt: null,
          deletedErrorLogIds: [],
          deletedAlertIds: [],
          attemptedErrorLogIds: result.deletedErrorLogIds,
          error: `Post-commit artifact update failed: ${safeErrorMessage(artifactError)}`,
          collateral: result.collateral,
        });
        try {
          persist(unverified);
        } catch {
          // The durable in-progress artifact still prevents a second cleanup attempt.
        }
        throw new Error('Cleanup committed but audit outcome is unverified');
      }
      return result;
    } catch (error) {
      if (!(error instanceof ErrorCleanupTransactionError)) throw error;
      const outcome = withCleanupState(inProgress, {
        status: error.outcome,
        attemptedAt,
        completedAt: null,
        deletedErrorLogIds: [],
        deletedAlertIds: [],
        attemptedErrorLogIds: error.attemptedErrorLogIds,
        error: safeErrorMessage(error),
        collateral: emptyCollateral(),
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
}): Promise<ErrorLogClearResult> {
  return executeVerifiedSnapshotCleanupCore({
    client: options.client,
    confirmation: options.confirmation,
    databaseTargetFingerprint: options.databaseTargetFingerprint,
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
