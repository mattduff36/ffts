const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportDateRange {
  dateFrom: string | null;
  dateTo: string | null;
  filenameDateRange: string;
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseReportDateRange(searchParams: URLSearchParams): { range: ReportDateRange | null; error: string | null } {
  const dateFrom = searchParams.get('dateFrom')?.trim() || null;
  const dateTo = searchParams.get('dateTo')?.trim() || null;

  if (dateFrom && !isValidIsoDate(dateFrom)) {
    return { range: null, error: 'dateFrom must be a valid YYYY-MM-DD date.' };
  }

  if (dateTo && !isValidIsoDate(dateTo)) {
    return { range: null, error: 'dateTo must be a valid YYYY-MM-DD date.' };
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { range: null, error: 'dateFrom must be before or equal to dateTo.' };
  }

  return {
    range: {
      dateFrom,
      dateTo,
      filenameDateRange: dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : new Date().toISOString().slice(0, 10),
    },
    error: null,
  };
}

export function buildSafeReportFilename(prefix: string, dateRange: string, extension: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '_');
  const safeDateRange = dateRange.replace(/[^0-9A-Za-z_-]/g, '_');
  const safeExtension = extension.replace(/[^A-Za-z0-9]/g, '');

  return `${safePrefix}_${safeDateRange}.${safeExtension}`;
}

export function getReportDateRangeSpanDays(range: Pick<ReportDateRange, 'dateFrom' | 'dateTo'>): number | null {
  if (!range.dateFrom || !range.dateTo) return null;

  const start = new Date(`${range.dateFrom}T00:00:00.000Z`).getTime();
  const end = new Date(`${range.dateTo}T00:00:00.000Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return Math.floor((end - start) / 86_400_000) + 1;
}

export function validateRequiredReportDateRange(
  range: ReportDateRange | null,
  maxDays: number
): string | null {
  if (!range?.dateFrom || !range.dateTo) {
    return 'dateFrom and dateTo are required.';
  }

  const spanDays = getReportDateRangeSpanDays(range);
  if (spanDays === null) {
    return 'Invalid date range.';
  }

  if (spanDays > maxDays) {
    return `Date range must be ${maxDays} days or fewer.`;
  }

  return null;
}
