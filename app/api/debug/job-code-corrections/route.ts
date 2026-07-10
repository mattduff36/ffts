import { NextRequest, NextResponse } from 'next/server';
import { createDebugAccessErrorBody, requireDebugConsoleAccess } from '@/lib/server/debug-console-access';
import {
  applyJobCodeCorrection,
  buildJobCodeCorrectionPreview,
  searchStoredJobCodeOptions,
  searchJobCodeTimesheets,
  type JobCodeCorrectionScope,
} from '@/lib/server/job-code-corrections';
import { logServerError } from '@/lib/utils/server-error-logger';

interface CorrectionRequestBody {
  action?: unknown;
  scope?: unknown;
  from_job_code?: unknown;
  to_job_code?: unknown;
  timesheet_ids?: unknown;
  delete_old_legacy_quote?: unknown;
  confirm_destructive_change?: unknown;
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getScope(value: unknown): JobCodeCorrectionScope {
  return value === 'individual' ? 'individual' : 'batch';
}

function getTimesheetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function getValidationStatus(message: string): number {
  return /enter|choose|select|confirm/i.test(message) ? 400 : 500;
}

export async function GET(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = Number.parseInt(searchParams.get('limit') || '25', 10);
    if (searchParams.get('mode') === 'stored-codes') {
      const jobCodes = await searchStoredJobCodeOptions({
        query,
        limit: Number.isFinite(limit) ? limit : 25,
      });

      return NextResponse.json({
        success: true,
        job_codes: jobCodes,
      });
    }

    const fromJobCode = searchParams.get('from_job_code') || '';
    const timesheets = await searchJobCodeTimesheets({
      query,
      fromJobCode,
      limit: Number.isFinite(limit) ? limit : 25,
    });

    return NextResponse.json({
      success: true,
      timesheets,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/job-code-corrections',
      additionalData: {
        endpoint: 'GET /api/debug/job-code-corrections',
      },
    });

    return NextResponse.json(
      { error: 'Unable to search timesheets right now.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  try {
    const body = await request.json() as CorrectionRequestBody;
    const action = getString(body.action);
    const input = {
      fromJobCode: getString(body.from_job_code),
      toJobCode: getString(body.to_job_code),
      scope: getScope(body.scope),
      timesheetIds: getTimesheetIds(body.timesheet_ids),
      deleteOldLegacyQuote: body.delete_old_legacy_quote === true,
    };

    if (action === 'preview') {
      const preview = await buildJobCodeCorrectionPreview(input);
      return NextResponse.json({ success: true, preview });
    }

    if (action === 'apply') {
      if (body.confirm_destructive_change !== true) {
        return NextResponse.json(
          { error: 'Confirm the destructive job-code change before applying it.' },
          { status: 400 }
        );
      }

      const result = await applyJobCodeCorrection(input);
      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ error: 'Unsupported job-code correction action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process job-code correction.';
    const status = getValidationStatus(message);

    if (status >= 500) {
      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/debug/job-code-corrections',
        additionalData: {
          endpoint: 'POST /api/debug/job-code-corrections',
        },
      });
    }

    return NextResponse.json(
      { error: status === 400 ? message : 'Unable to process job-code correction right now.' },
      { status }
    );
  }
}
