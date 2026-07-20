import { describe, expect, it } from 'vitest';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import { ALL_MODULES } from '@/types/roles';

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

  it('does not grant access from email identity alone', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin@mpdee.co.uk',
        isActualSuperAdmin: false,
        isViewingAs: false,
      })
    ).toBe(false);
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
