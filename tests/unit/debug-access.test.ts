import { describe, expect, it } from 'vitest';
import { canAccessDebugConsole, isAdditionalDebugAccessUser } from '@/lib/utils/debug-access';
import { ALL_MODULES } from '@/types/roles';

describe('isAdditionalDebugAccessUser', () => {
  it('matches the configured Forest support account case-insensitively', () => {
    expect(isAdditionalDebugAccessUser('ADMIN@MPDEE.CO.UK')).toBe(true);
  });

  it('rejects other emails', () => {
    expect(isAdditionalDebugAccessUser('someone@example.test')).toBe(false);
  });
});

describe('canAccessDebugConsole', () => {
  it('allows actual superadmins in actual-role mode', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin@mpdee.co.uk',
        isActualSuperAdmin: true,
        isViewingAs: false,
      })
    ).toBe(true);
  });

  it('allows the configured support account without superadmin access', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin@mpdee.co.uk',
        isActualSuperAdmin: false,
        isViewingAs: false,
      })
    ).toBe(true);
  });

  it('blocks view-as mode even for otherwise eligible users', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin@mpdee.co.uk',
        isActualSuperAdmin: false,
        isViewingAs: true,
      })
    ).toBe(false);
  });

  it('blocks other users', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin.user@example.test',
        isActualSuperAdmin: false,
        isViewingAs: false,
      })
    ).toBe(false);
  });
});

describe('hidden debug sensitive module', () => {
  it('does not expose debug as a permission matrix module', () => {
    expect(ALL_MODULES).not.toContain('debug');
  });
});
