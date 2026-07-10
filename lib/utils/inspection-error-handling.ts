function extractInspectionErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }

  return '';
}

function extractInspectionErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }

  return '';
}

export function getInspectionErrorMessage(error: unknown, fallback: string): string {
  const message = extractInspectionErrorMessage(error).trim();
  return message.length > 0 ? message : fallback;
}

export function isDuplicateInspectionError(error: unknown): boolean {
  const message = extractInspectionErrorMessage(error).toLowerCase();
  const code = extractInspectionErrorCode(error).trim();

  return (
    code === '23505' ||
    message.includes('duplicate key') ||
    message.includes('already exists') ||
    message.includes('unique constraint')
  );
}

export function isMissingDraftError(error: unknown): boolean {
  const message = extractInspectionErrorMessage(error).trim().toLowerCase();
  return message === 'draft not found';
}
