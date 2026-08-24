import { describe, expect, it } from 'vitest';
import {
  hasDesktopSidebarAccess,
  shouldReserveDesktopSidebarSpace,
} from '@/components/layout/desktop-sidebar';

describe('desktop sidebar space', () => {
  it('grants access to admin, manager, and actual superadmin accounts', () => {
    expect(hasDesktopSidebarAccess({ isManager: false, isAdmin: true, isActualSuperAdmin: false })).toBe(true);
    expect(hasDesktopSidebarAccess({ isManager: true, isAdmin: false, isActualSuperAdmin: false })).toBe(true);
    expect(hasDesktopSidebarAccess({ isManager: false, isAdmin: false, isActualSuperAdmin: true })).toBe(true);
  });

  it('denies access to standard employees', () => {
    expect(hasDesktopSidebarAccess({ isManager: false, isAdmin: false, isActualSuperAdmin: false })).toBe(false);
  });

  it('reserves content inset for admin accounts outside tablet mode', () => {
    expect(
      shouldReserveDesktopSidebarSpace({
        tabletModeEnabled: false,
        isManager: false,
        isAdmin: true,
        isActualSuperAdmin: false,
      })
    ).toBe(true);
  });

  it('does not reserve content inset in tablet mode', () => {
    expect(
      shouldReserveDesktopSidebarSpace({
        tabletModeEnabled: true,
        isManager: true,
        isAdmin: true,
        isActualSuperAdmin: true,
      })
    ).toBe(false);
  });
});
