import { NextRequest, NextResponse } from 'next/server';
import {
  createDebugAccessErrorBody,
  requireDebugConsoleAccess,
} from '@/lib/server/debug-console-access';
import {
  originMatchesRequest,
  sampleDataRequestSchema,
} from '@/lib/server/sample-data/api';
import { previewSampleDataOperation } from '@/lib/server/sample-data/registry';
import { logServerError } from '@/lib/utils/server-error-logger';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), {
      status: access.status,
      headers: NO_STORE_HEADERS,
    });
  }
  if (!originMatchesRequest(request)) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = sampleDataRequestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Unsupported managed fixture or action.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const preview = await previewSampleDataOperation(parsed.data);
    return NextResponse.json(
      { success: true, preview },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/sample-data/preview',
      additionalData: {
        endpoint: 'POST /api/debug/sample-data/preview',
        fixture_key: parsed.data.fixtureKey,
        action: parsed.data.action,
      },
    });
    return NextResponse.json(
      { error: 'Unable to preview managed sample-data operation.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
