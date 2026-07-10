import { NextRequest, NextResponse } from 'next/server';
import {
  clearAllErrorLogs,
  listErrorLogs,
  requireErrorLogAdminAccess,
} from '@/lib/server/error-logs';
import { createDebugAccessErrorBody } from '@/lib/server/debug-console-access';
import { logServerError } from '@/lib/utils/server-error-logger';

function getRequestedLimit(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('limit');
  if (!raw) {
    return 200;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 200;
}

export async function GET(request: NextRequest) {
  const access = await requireErrorLogAdminAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  try {
    const logs = await listErrorLogs(getRequestedLimit(request));
    return NextResponse.json({
      success: true,
      logs,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/error-logs',
      additionalData: {
        endpoint: '/api/debug/error-logs',
        method: 'GET',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireErrorLogAdminAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  try {
    await clearAllErrorLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/error-logs',
      additionalData: {
        endpoint: '/api/debug/error-logs',
        method: 'DELETE',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
