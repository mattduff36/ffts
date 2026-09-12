import { describe, expect, it } from 'vitest';
import {
  isExpectedUserAdminError,
  shouldLogCreateUserError,
} from '@/lib/utils/admin-users-error-handling';

describe('admin-users-error-handling', () => {
  it('FE-ADMIN-USERS-DUPLICATE-EMAIL-EXPECTED treats duplicate-email rejection as expected and does not log it', () => {
    const error = new Error('A user with this email address has already been registered');

    expect(shouldLogCreateUserError(error)).toBe(false);
  });

  it('FE-ADMIN-USERS-UNEXPECTED-CREATE-ERROR-LOGGED still logs unexpected create-user failures', () => {
    const genericFailure = new Error('Failed to create user');
    const authorizationFailure = new Error('Forbidden: you cannot assign this role');

    expect(isExpectedUserAdminError(genericFailure)).toBe(false);
    expect(shouldLogCreateUserError(genericFailure)).toBe(true);
    expect(shouldLogCreateUserError(authorizationFailure)).toBe(true);
  });
});
