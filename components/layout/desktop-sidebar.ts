/**
 * Desktop icon sidebar visibility (SidebarNav) and content inset
 * (DashboardContent) must use the same role gate so the nav never
 * covers the page for one account class and not another.
 */
export function hasDesktopSidebarAccess(options: {
  isManager: boolean;
  isAdmin: boolean;
  isActualSuperAdmin: boolean;
}): boolean {
  return options.isManager || options.isAdmin || options.isActualSuperAdmin;
}

export function shouldReserveDesktopSidebarSpace(options: {
  tabletModeEnabled: boolean;
  isManager: boolean;
  isAdmin: boolean;
  isActualSuperAdmin: boolean;
}): boolean {
  return !options.tabletModeEnabled && hasDesktopSidebarAccess(options);
}
