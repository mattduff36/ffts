import { NextRequest, NextResponse } from 'next/server';
import {
  createDebugAccessErrorBody,
  requireDebugConsoleAccess,
} from '@/lib/server/debug-console-access';
import {
  originMatchesRequest,
  sampleDataMutationSchema,
} from '@/lib/server/sample-data/api';
import { executeSampleDataOperation } from '@/lib/server/sample-data/registry';
import { logServerError } from '@/lib/utils/server-error-logger';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function getFailureStatus(message: string): number {
  if (/confirmation|preview|unsupported|allowlisted/i.test(message)) return 400;
  if (/already running/i.test(message)) return 409;
  if (/blocked|drift|partial|dependency|collision|not safely/i.test(message)) {
    return 409;
  }
  return 500;
}

export async function POST(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), {
      status: access.status,
      headers: NO_STORE_HEADERS,
    });
  }
  if (!access.profileId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }
  if (!originMatchesRequest(request)) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = sampleDataMutationSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid managed sample-data request.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const result = await executeSampleDataOperation({
      ...parsed.data,
      actorProfileId: access.profileId,
    });
    return NextResponse.json(
      { success: result.success, result },
      {
        status: result.success ? 200 : 207,
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Sample-data operation failed.';
    const status = getFailureStatus(message);
    if (status >= 500) {
      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/debug/sample-data/execute',
        additionalData: {
          endpoint: 'POST /api/debug/sample-data/execute',
          fixture_key: parsed.data.fixtureKey,
          action: parsed.data.action,
        },
      });
    }
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
