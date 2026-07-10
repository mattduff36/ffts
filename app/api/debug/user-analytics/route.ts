import { NextRequest, NextResponse } from 'next/server';
import {
  getUserAnalyticsDebugPayload,
  requireDebugAnalyticsAccess,
} from '@/lib/server/user-analytics';
import { createDebugAccessErrorBody } from '@/lib/server/debug-console-access';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  const access = await requireDebugAnalyticsAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  try {
    const payload = await getUserAnalyticsDebugPayload(request.nextUrl.searchParams);
    return NextResponse.json(payload);
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/user-analytics',
      additionalData: {
        endpoint: '/api/debug/user-analytics',
        method: 'GET',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
