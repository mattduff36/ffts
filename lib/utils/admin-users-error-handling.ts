const EXPECTED_USER_ADMIN_MESSAGES = ['Forbidden:'];

const EXPECTED_CREATE_USER_MESSAGES = [
  'A user with this email address has already been registered',
  'User already registered',
];

function extractErrorMessage(error: unknown): string {
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

function matchesExpectedMessage(error: unknown, expectedMessages: readonly string[]): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }

  return expectedMessages.some((value) => message.includes(value));
}

export function isExpectedUserAdminError(error: unknown): boolean {
  return matchesExpectedMessage(error, EXPECTED_USER_ADMIN_MESSAGES);
}

export function shouldLogCreateUserError(error: unknown): boolean {
  return !matchesExpectedMessage(error, EXPECTED_CREATE_USER_MESSAGES);
}
