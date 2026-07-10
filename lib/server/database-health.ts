import 'server-only';

import pg from 'pg';

const { Client } = pg;

export type DatabaseHealthFailureReason =
  | 'database_unreachable'
  | 'database_auth_failed'
  | 'database_health_misconfigured'
  | 'database_probe_failed';

export interface DatabaseHealthProbeSuccess {
  ok: true;
  checkedAt: string;
  latencyMs: number;
}

export interface DatabaseHealthProbeFailure {
  ok: false;
  checkedAt: string;
  latencyMs: number;
  reason: DatabaseHealthFailureReason;
  errorCode?: string;
}

export type DatabaseHealthProbeResult = DatabaseHealthProbeSuccess | DatabaseHealthProbeFailure;

export interface DatabaseRecoveryReport {
  outageStartedAt: string;
  outageConfirmedAt: string;
  recoveredAt: string;
  failureCount: number;
  pageUrl?: string;
  userAgent?: string;
  clientId?: string;
}

export interface DatabaseRecoveryRecordResult {
  incidentId: string;
  errorLogId: string | null;
  deduped: boolean;
}

interface PgClientLike {
  connect(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface ProbeOptions {
  connectionString?: string | null;
  timeoutMs?: number;
  createClient?: (connectionString: string, timeoutMs: number) => PgClientLike;
}

interface RecoveryOptions {
  connectionString?: string | null;
  createClient?: (connectionString: string, timeoutMs: number) => PgClientLike;
}

interface ServiceHealthEventRow {
  id: string;
  outage_started_at: string;
  outage_last_seen_at: string;
  recovered_at: string | null;
  recovery_error_log_id: string | null;
}

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const INCIDENT_MERGE_WINDOW_MS = 2 * 60 * 1000;
const DATABASE_SERVICE = 'database';
const RECOVERY_COMPONENT = 'database-health-monitor';

function getConnectionString(explicitConnectionString?: string | null): string | null {
  return explicitConnectionString || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || null;
}

function createDatabaseClient(connectionString: string, timeoutMs: number): PgClientLike {
  const url = new URL(connectionString);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }

  return String(error || '');
}

export function classifyDatabaseHealthError(error: unknown): DatabaseHealthFailureReason {
  const code = getErrorCode(error);
  if (code === '28P01' || code === '28000' || code === '42501') {
    return 'database_auth_failed';
  }

  const message = getErrorMessage(error).toLowerCase();
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE' ||
    message.includes('connection terminated') ||
    message.includes('connection refused') ||
    message.includes('connect timeout') ||
    message.includes('timeout expired') ||
    message.includes('query read timeout') ||
    message.includes('terminating connection') ||
    message.includes('server closed the connection') ||
    message.includes('getaddrinfo')
  ) {
    return 'database_unreachable';
  }

  return 'database_probe_failed';
}

export async function probeDatabaseHealth(options: ProbeOptions = {}): Promise<DatabaseHealthProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  const connectionString = getConnectionString(options.connectionString);
  if (!connectionString) {
    return {
      ok: false,
      checkedAt,
      latencyMs: 0,
      reason: 'database_health_misconfigured',
    };
  }

  let client: PgClientLike | null = null;
  try {
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    client = (options.createClient || createDatabaseClient)(connectionString, timeoutMs);
    await client.connect();
    const { rows } = await client.query<{ ok: number }>('SELECT 1 AS ok');
    if (rows[0]?.ok !== 1) {
      return {
        ok: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        reason: 'database_probe_failed',
      };
    }

    return {
      ok: true,
      checkedAt,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      reason: classifyDatabaseHealthError(error),
      errorCode: getErrorCode(error),
    };
  } finally {
    if (client) {
      await client.end().catch(() => undefined);
    }
  }
}

function parseTimestamp(value: string, fieldName: string): Date {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${fieldName} must be a valid ISO timestamp`);
  }
  return new Date(timestamp);
}

function sanitizePageUrl(pageUrl?: string): string {
  if (!pageUrl) {
    return 'database-health-monitor';
  }

  return pageUrl.slice(0, 2_048);
}

function sanitizeUserAgent(userAgent?: string): string {
  if (!userAgent) {
    return 'database-health-monitor';
  }

  return userAgent.slice(0, 2_048);
}

async function insertRecoveryErrorLog(
  client: PgClientLike,
  report: DatabaseRecoveryReport,
  incidentId: string
): Promise<string> {
  const additionalData = JSON.stringify({
    service: DATABASE_SERVICE,
    incident_id: incidentId,
    outage_started_at: report.outageStartedAt,
    outage_confirmed_at: report.outageConfirmedAt,
    recovered_at: report.recoveredAt,
    failure_count: report.failureCount,
    client_id: report.clientId || null,
  });

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO public.error_logs (
        timestamp,
        error_message,
        error_stack,
        error_type,
        user_id,
        user_email,
        page_url,
        user_agent,
        component_name,
        additional_data
      )
      VALUES ($1, $2, NULL, $3, NULL, NULL, $4, $5, $6, $7::jsonb)
      RETURNING id
    `,
    [
      report.recoveredAt,
      'Database connectivity recovered after confirmed outage',
      'DatabaseOutageRecovery',
      sanitizePageUrl(report.pageUrl),
      sanitizeUserAgent(report.userAgent),
      RECOVERY_COMPONENT,
      additionalData,
    ]
  );

  if (!rows[0]?.id) {
    throw new Error('Failed to create database recovery error log');
  }

  return rows[0].id;
}

function shouldMergeIncident(latest: ServiceHealthEventRow | undefined, outageStartedAt: Date): boolean {
  if (!latest) {
    return false;
  }

  if (!latest.recovered_at) {
    return true;
  }

  return new Date(latest.recovered_at).getTime() + INCIDENT_MERGE_WINDOW_MS >= outageStartedAt.getTime();
}

export async function recordDatabaseRecoveryEvent(
  report: DatabaseRecoveryReport,
  options: RecoveryOptions = {}
): Promise<DatabaseRecoveryRecordResult> {
  const outageStartedAt = parseTimestamp(report.outageStartedAt, 'outageStartedAt');
  parseTimestamp(report.outageConfirmedAt, 'outageConfirmedAt');
  const recoveredAt = parseTimestamp(report.recoveredAt, 'recoveredAt');

  if (recoveredAt.getTime() < outageStartedAt.getTime()) {
    throw new Error('recoveredAt must be after outageStartedAt');
  }

  const connectionString = getConnectionString(options.connectionString);
  if (!connectionString) {
    throw new Error('Database health recovery logging is not configured');
  }

  const client = (options.createClient || createDatabaseClient)(connectionString, DEFAULT_PROBE_TIMEOUT_MS);
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`service_health_events:${DATABASE_SERVICE}`]);

    const latestResult = await client.query<ServiceHealthEventRow>(
      `
        SELECT id, outage_started_at, outage_last_seen_at, recovered_at, recovery_error_log_id
        FROM public.service_health_events
        WHERE service = $1
        ORDER BY outage_started_at DESC, created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [DATABASE_SERVICE]
    );

    const latest = latestResult.rows[0];
    const eventResult = shouldMergeIncident(latest, outageStartedAt)
      ? await client.query<ServiceHealthEventRow>(
          `
            UPDATE public.service_health_events
            SET
              status = 'recovered',
              outage_started_at = LEAST(outage_started_at, $2::timestamptz),
              outage_last_seen_at = GREATEST(outage_last_seen_at, $3::timestamptz),
              recovered_at = GREATEST(COALESCE(recovered_at, $4::timestamptz), $4::timestamptz),
              updated_at = NOW()
            WHERE id = $1
            RETURNING id, outage_started_at, outage_last_seen_at, recovered_at, recovery_error_log_id
          `,
          [latest.id, report.outageStartedAt, report.outageConfirmedAt, report.recoveredAt]
        )
      : await client.query<ServiceHealthEventRow>(
          `
            INSERT INTO public.service_health_events (
              service,
              status,
              outage_started_at,
              outage_last_seen_at,
              recovered_at
            )
            VALUES ($1, 'recovered', $2, $3, $4)
            RETURNING id, outage_started_at, outage_last_seen_at, recovered_at, recovery_error_log_id
          `,
          [DATABASE_SERVICE, report.outageStartedAt, report.outageConfirmedAt, report.recoveredAt]
        );

    const event = eventResult.rows[0];
    if (!event) {
      throw new Error('Failed to create database service health event');
    }

    if (event.recovery_error_log_id) {
      await client.query('COMMIT');
      return {
        incidentId: event.id,
        errorLogId: event.recovery_error_log_id,
        deduped: true,
      };
    }

    const errorLogId = await insertRecoveryErrorLog(client, report, event.id);
    await client.query(
      `
        UPDATE public.service_health_events
        SET recovery_error_log_id = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [event.id, errorLogId]
    );

    await client.query('COMMIT');
    return {
      incidentId: event.id,
      errorLogId,
      deduped: false,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
