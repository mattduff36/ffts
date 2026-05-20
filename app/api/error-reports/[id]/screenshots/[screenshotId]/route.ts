import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ERROR_REPORT_SCREENSHOT_BUCKET,
  getErrorReportScreenshots,
} from '@/lib/utils/error-report-screenshots';

interface RouteParams {
  params: Promise<{ id: string; screenshotId: string }>;
}

function buildInlineContentDisposition(fileName: string): string {
  const safeFileName = fileName.replace(/["\r\n]/g, '_');
  return `inline; filename="${safeFileName}"`;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id, screenshotId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: report, error: reportError } = await supabase
      .from('error_reports')
      .select('id, created_by, additional_context')
      .eq('id', id)
      .single();

    if (reportError || !report) {
      return NextResponse.json({ error: 'Screenshot not found.' }, { status: 404 });
    }

    const screenshot = getErrorReportScreenshots(report.additional_context)
      .find((candidate) => candidate.id === screenshotId);

    if (!screenshot || !screenshot.file_path.startsWith(`${report.created_by}/${report.id}/`)) {
      return NextResponse.json({ error: 'Screenshot not found.' }, { status: 404 });
    }

    const { data: fileData, error: downloadError } = await admin.storage
      .from(ERROR_REPORT_SCREENSHOT_BUCKET)
      .download(screenshot.file_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: 'Unable to open this screenshot right now.' }, { status: 500 });
    }

    const fileBuffer = await fileData.arrayBuffer();

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': screenshot.content_type || fileData.type || 'application/octet-stream',
        'Content-Disposition': buildInlineContentDisposition(screenshot.file_name),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error opening error report screenshot:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to open this screenshot right now.' },
      { status: 500 }
    );
  }
}
