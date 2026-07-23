import { NextRequest, NextResponse } from 'next/server';
import {
  createDebugAccessErrorBody,
  requireDebugConsoleAccess,
} from '@/lib/server/debug-console-access';
import { getManagedSampleDataStatus } from '@/lib/server/sample-data/registry';
import { logServerError } from '@/lib/utils/server-error-logger';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), {
      status: access.status,
      headers: NO_STORE_HEADERS,
    });
  }

  try {
    const status = await getManagedSampleDataStatus();
    return NextResponse.json(
      { success: true, status },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/sample-data',
      additionalData: { endpoint: 'GET /api/debug/sample-data' },
    });
    return NextResponse.json(
      { error: 'Unable to inspect managed sample data.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
