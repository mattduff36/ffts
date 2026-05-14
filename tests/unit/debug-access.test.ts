import { describe, expect, it } from 'vitest';
import { canAccessDebugConsole, isAdditionalDebugAccessUser } from '@/lib/utils/debug-access';

describe('isAdditionalDebugAccessUser', () => {
  it('matches additional debug email case-insensitively', () => {
    expect(isAdditionalDebugAccessUser('DEBUG.USER@example.com')).toBe(true);
  });

  it('rejects other emails', () => {
    expect(isAdditionalDebugAccessUser('someone@example.com')).toBe(false);
  });
});

describe('canAccessDebugConsole', () => {
  it('allows actual superadmins in actual-role mode', () => {
    expect(
      canAccessDebugConsole({
        email: 'template-admin@example.com',
        isActualSuperAdmin: true,
        isViewingAs: false,
      })
    ).toBe(true);
  });

  it('allows an additional debug user without superadmin access', () => {
    expect(
      canAccessDebugConsole({
        email: 'debug.user@example.com',
        isActualSuperAdmin: false,
        isViewingAs: false,
      })
    ).toBe(true);
  });

  it('blocks view-as mode even for otherwise eligible users', () => {
    expect(
      canAccessDebugConsole({
        email: 'debug.user@example.com',
        isActualSuperAdmin: false,
        isViewingAs: true,
      })
    ).toBe(false);
  });

  it('blocks other users', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin.user@example.com',
        isActualSuperAdmin: false,
        isViewingAs: false,
      })
    ).toBe(false);
  });
});
