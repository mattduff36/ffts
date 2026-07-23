import { NextRequest, NextResponse } from 'next/server';
import {
  createDebugAccessErrorBody,
  requireDebugConsoleAccess,
} from '@/lib/server/debug-console-access';
import { originMatchesRequest } from '@/lib/server/sample-data/api';

const RETIRED_MESSAGE =
  'The broad Test Fleet prefix purge is retired. Use Debug > Sample Data to manage exact fixture-owned assets.';

async function retiredResponse(request: NextRequest, isMutation: boolean) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), {
      status: access.status,
    });
  }
  if (isMutation && !originMatchesRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(
    {
      success: false,
      retired: true,
      error: RETIRED_MESSAGE,
      replacement: '/debug?tab=sample-data',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET(request: NextRequest) {
  return retiredResponse(request, false);
}

export async function POST(request: NextRequest) {
  return retiredResponse(request, true);
}

export async function DELETE(request: NextRequest) {
  return retiredResponse(request, true);
}
