import { NextRequest, NextResponse } from 'next/server';
import { createDebugAccessErrorBody, requireDebugConsoleAccess } from '@/lib/server/debug-console-access';
import { addManualLegacyJobCode } from '@/lib/server/manual-legacy-job-codes';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  try {
    const body = await request.json() as {
      job_code?: unknown;
      name?: unknown;
      customer?: unknown;
    };

    const result = await addManualLegacyJobCode({
      jobCode: typeof body.job_code === 'string' ? body.job_code : '',
      name: typeof body.name === 'string' ? body.name : '',
      customer: typeof body.customer === 'string' ? body.customer : '',
      createdBy: access.profileId || null,
    });

    return NextResponse.json({
      success: true,
      legacy_job_code: result,
      message: result.wasExisting
        ? `Job code ${result.quote_reference} already exists in legacy quotes.`
        : `Job code ${result.quote_reference} added to legacy quotes.`,
    }, { status: result.wasExisting ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to add legacy job code.';
    const status = /enter a/i.test(message) ? 400 : 500;

    if (status >= 500) {
      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/debug/legacy-job-codes',
        additionalData: {
          endpoint: 'POST /api/debug/legacy-job-codes',
        },
      });
    }

    return NextResponse.json({ error: message }, { status });
  }
}
