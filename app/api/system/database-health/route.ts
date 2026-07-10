import { NextRequest, NextResponse } from 'next/server';
import {
  probeDatabaseHealth,
  recordDatabaseRecoveryEvent,
  type DatabaseRecoveryReport,
} from '@/lib/server/database-health';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

interface RecoveryPayload {
  outage_started_at?: unknown;
  outage_confirmed_at?: unknown;
  recovered_at?: unknown;
  failure_count?: unknown;
  client_id?: unknown;
}

function originMatchesRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function readIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function normalizeRecoveryPayload(payload: RecoveryPayload, request: NextRequest): DatabaseRecoveryReport | null {
  const outageStartedAt = readIsoTimestamp(payload.outage_started_at);
  const outageConfirmedAt = readIsoTimestamp(payload.outage_confirmed_at);
  const recoveredAt = readIsoTimestamp(payload.recovered_at);
  if (!outageStartedAt || !outageConfirmedAt || !recoveredAt) {
    return null;
  }

  const rawFailureCount = typeof payload.failure_count === 'number' ? payload.failure_count : 0;
  const failureCount = Number.isFinite(rawFailureCount) ? Math.max(0, Math.trunc(rawFailureCount)) : 0;

  return {
    outageStartedAt,
    outageConfirmedAt,
    recoveredAt,
    failureCount,
    clientId: typeof payload.client_id === 'string' ? payload.client_id.slice(0, 128) : undefined,
    pageUrl: request.headers.get('referer') || request.nextUrl.origin,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}

export async function GET() {
  const result = await probeDatabaseHealth();
  if (result.ok) {
    return NextResponse.json(
      {
        ok: true,
        checked_at: result.checkedAt,
        latency_ms: result.latencyMs,
      },
      { headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      reason: result.reason,
      checked_at: result.checkedAt,
      latency_ms: result.latencyMs,
    },
    {
      status: result.reason === 'database_unreachable' ? 503 : 500,
      headers: NO_STORE_HEADERS,
    }
  );
}

export async function POST(request: NextRequest) {
  if (!originMatchesRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
  }

  let payload: RecoveryPayload;
  try {
    payload = (await request.json()) as RecoveryPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid recovery payload' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const report = normalizeRecoveryPayload(payload, request);
  if (!report) {
    return NextResponse.json({ error: 'Invalid recovery payload' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const result = await recordDatabaseRecoveryEvent(report);
    return NextResponse.json(
      {
        ok: true,
        incident_id: result.incidentId,
        error_log_id: result.errorLogId,
        deduped: result.deduped,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record recovery' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
