export interface StatusError extends Error {
  status?: number;
  cause?: unknown;
}

function getErrorMessageText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }

  return '';
}

export function createStatusError(message: string, status?: number, cause?: unknown): StatusError {
  const error = new Error(message) as StatusError;
  if (typeof status === 'number') {
    error.status = status;
  }
  if (typeof cause !== 'undefined') {
    error.cause = cause;
  }
  return error;
}

export function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    const message = getErrorMessageText(error).toLowerCase();
    if (message.includes('empty jwt is sent in authorization header')) return 401;
    if (message.includes('unauthorized')) return 401;
    if (message.includes('not authenticated')) return 401;
    if (message.includes('jwt expired')) return 401;
    return null;
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }

  if ('code' in error && typeof error.code === 'number') {
    return error.code;
  }

  const message = getErrorMessageText(error).toLowerCase();
  if (message.includes('empty jwt is sent in authorization header')) return 401;
  if (message.includes('unauthorized')) return 401;
  if (message.includes('not authenticated')) return 401;
  if (message.includes('jwt expired')) return 401;
  return null;
}

export function isAuthErrorStatus(status: number | null | undefined): boolean {
  return status === 401;
}

export function isNetworkFetchError(error: unknown): boolean {
  const message = getErrorMessageText(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('err_internet_disconnected') ||
    message.includes('err_network_changed') ||
    message.includes('aborterror') ||
    message.includes('the user aborted a request') ||
    message.includes('network')
  );
}

export function isServerErrorStatus(status: number | null | undefined): boolean {
  return typeof status === 'number' && status >= 500;
}
