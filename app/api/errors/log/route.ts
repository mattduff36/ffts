import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { insertErrorLogs } from '@/lib/server/error-logs';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { Database } from '@/types/database';

type ErrorLogInsertRow = Database['public']['Tables']['error_logs']['Insert'];
type ErrorLogAdditionalData = ErrorLogInsertRow['additional_data'];

interface ClientErrorLogPayload {
  timestamp?: unknown;
  error_message?: unknown;
  error_stack?: unknown;
  error_type?: unknown;
  page_url?: unknown;
  user_agent?: unknown;
  component_name?: unknown;
  additional_data?: unknown;
}

const MAX_BATCH_SIZE = 50;
const MAX_ERROR_MESSAGE_LENGTH = 4_000;
const MAX_STACK_LENGTH = 24_000;
const MAX_ERROR_TYPE_LENGTH = 255;
const MAX_PAGE_URL_LENGTH = 2_048;
const MAX_USER_AGENT_LENGTH = 2_048;
const MAX_COMPONENT_NAME_LENGTH = 255;

function normalizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
}

function normalizeAdditionalData(value: unknown): ErrorLogAdditionalData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as ErrorLogAdditionalData;
  } catch {
    return {
      normalization_error: 'Failed to serialize additional_data',
    } as ErrorLogAdditionalData;
  }
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

function normalizePayload(
  payload: ClientErrorLogPayload,
  request: NextRequest,
  userId: string | null,
  userEmail: string | null
): ErrorLogInsertRow | null {
  const errorMessage = normalizeString(payload.error_message, MAX_ERROR_MESSAGE_LENGTH);
  if (!errorMessage) {
    return null;
  }

  return {
    timestamp: normalizeTimestamp(payload.timestamp),
    error_message: errorMessage,
    error_stack: normalizeString(payload.error_stack, MAX_STACK_LENGTH),
    error_type: normalizeString(payload.error_type, MAX_ERROR_TYPE_LENGTH) || 'Error',
    user_id: userId,
    user_email: userEmail,
    page_url:
      normalizeString(payload.page_url, MAX_PAGE_URL_LENGTH) ||
      request.headers.get('referer') ||
      request.nextUrl.origin,
    user_agent:
      normalizeString(payload.user_agent, MAX_USER_AGENT_LENGTH) ||
      request.headers.get('user-agent') ||
      'N/A',
    component_name: normalizeString(payload.component_name, MAX_COMPONENT_NAME_LENGTH),
    additional_data: normalizeAdditionalData(payload.additional_data),
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!originMatchesRequest(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const rawLogs: unknown[] = Array.isArray(body?.logs)
      ? body.logs
      : body && typeof body === 'object'
        ? [body]
        : [];

    if (rawLogs.length === 0) {
      return NextResponse.json({ error: 'No error logs supplied' }, { status: 400 });
    }

    const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
    const userId = current?.profile.id || null;
    const userEmail = current?.profile.email || null;
    const logs = rawLogs
      .slice(0, MAX_BATCH_SIZE)
      .map((entry: unknown) =>
        normalizePayload(
          (entry || {}) as ClientErrorLogPayload,
          request,
          userId,
          userEmail
        )
      )
      .filter((entry): entry is ErrorLogInsertRow => entry !== null);

    if (logs.length === 0) {
      return NextResponse.json({ error: 'No valid error logs supplied' }, { status: 400 });
    }

    await insertErrorLogs(logs);

    return NextResponse.json({
      success: true,
      inserted: logs.length,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/errors/log',
      additionalData: {
        endpoint: '/api/errors/log',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
