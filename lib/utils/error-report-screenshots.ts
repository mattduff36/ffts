export const ERROR_REPORT_SCREENSHOT_BUCKET = 'error-report-screenshots';
export const MAX_ERROR_REPORT_SCREENSHOTS = 3;
export const MAX_ERROR_REPORT_SCREENSHOT_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface ErrorReportScreenshot {
  id: string;
  file_name: string;
  file_path: string;
  content_type: string | null;
  file_size: number;
}

export function isAllowedErrorReportScreenshot(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.has(file.type);
}

export function getErrorReportScreenshots(additionalContext: unknown): ErrorReportScreenshot[] {
  if (!additionalContext || typeof additionalContext !== 'object') return [];

  const screenshots = (additionalContext as { screenshots?: unknown }).screenshots;
  if (!Array.isArray(screenshots)) return [];

  return screenshots.filter((screenshot): screenshot is ErrorReportScreenshot => {
    if (!screenshot || typeof screenshot !== 'object') return false;
    const candidate = screenshot as Partial<ErrorReportScreenshot>;

    return (
      typeof candidate.id === 'string' &&
      typeof candidate.file_name === 'string' &&
      typeof candidate.file_path === 'string' &&
      (typeof candidate.content_type === 'string' || candidate.content_type === null) &&
      typeof candidate.file_size === 'number'
    );
  });
}

export function mergeAdditionalContextWithScreenshots(
  additionalContext: unknown,
  screenshots: ErrorReportScreenshot[]
): Record<string, unknown> | null {
  const baseContext = additionalContext && typeof additionalContext === 'object' && !Array.isArray(additionalContext)
    ? additionalContext as Record<string, unknown>
    : {};

  const mergedContext = {
    ...baseContext,
    ...(screenshots.length > 0 ? { screenshots } : {}),
  };

  return Object.keys(mergedContext).length > 0 ? mergedContext : null;
}
