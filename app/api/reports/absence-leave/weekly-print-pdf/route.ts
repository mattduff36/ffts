import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { AbsenceWeeklyPrintPdf } from '@/lib/pdf/absence-weekly-print-pdf';
import { buildSafeReportFilename, parseReportDateRange, validateRequiredReportDateRange } from '@/lib/server/report-date-range';
import { getPrintableAbsenceWeeklyReportData } from '@/lib/server/absence-weekly-print-report';
import { logServerError } from '@/lib/utils/server-error-logger';

function resolveErrorStatus(message: string): number {
  if (message === 'Unauthorized') return 401;
  if (message === 'Forbidden') return 403;
  if (message.includes('dateFrom') || message.includes('dateTo') || message.includes('YYYY-MM-DD')) return 400;
  return 500;
}

export async function GET(request: NextRequest) {
  const { range, error: dateRangeError } = parseReportDateRange(request.nextUrl.searchParams);
  const requiredRangeError = validateRequiredReportDateRange(range, 366);
  if (dateRangeError || requiredRangeError || !range?.dateFrom || !range.dateTo) {
    return NextResponse.json(
      { error: dateRangeError || requiredRangeError || 'dateFrom and dateTo are required.' },
      { status: 400 }
    );
  }

  const { dateFrom, dateTo } = range;

  try {
    const report = await getPrintableAbsenceWeeklyReportData({ dateFrom, dateTo });
    const pdfBuffer = await renderToBuffer(AbsenceWeeklyPrintPdf({ report }));
    const fileName = buildSafeReportFilename('Absence_Weekly_Print', range.filenameDateRange, 'pdf');

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate weekly print PDF';
    const status = resolveErrorStatus(message);

    if (status === 500) {
      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/reports/absence-leave/weekly-print-pdf',
        additionalData: {
          endpoint: '/api/reports/absence-leave/weekly-print-pdf',
          dateFrom,
          dateTo,
        },
      });
    }

    return NextResponse.json({ error: message }, { status });
  }
}
