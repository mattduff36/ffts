/**
 * Sitemap parent route configuration
 * Maps current pathnames to their logical parent routes
 */

/**
 * Get the parent route for a given pathname
 * @param pathname - The current pathname
 * @param searchParams - Optional search params (for context like fromTab)
 * @param userRole - Optional user role context (for role-specific navigation)
 * @returns The parent route path
 */
export function getParentHref(
  pathname: string, 
  searchParams?: URLSearchParams | null,
  userRole?: { isManager?: boolean; isAdmin?: boolean }
): string {
  // Normalize pathname (remove trailing slashes)
  const normalizedPath = pathname.replace(/\/$/, '');
  
  // Projects routes (formerly RAMS)
  if (normalizedPath === '/projects/manage') {
    return '/projects';
  }
  if (normalizedPath === '/projects/settings') {
    return '/projects/manage';
  }
  if (normalizedPath.match(/^\/projects\/[^/]+$/)) {
    return (userRole?.isManager || userRole?.isAdmin) ? '/projects/manage' : '/projects';
  }
  if (normalizedPath.match(/^\/projects\/[^/]+\/read$/)) {
    return '/projects';
  }
  
  // Legacy RAMS redirects
  if (normalizedPath.startsWith('/rams')) {
    return '/projects';
  }
  
  // Fleet routes - support fromTab query param
  if (normalizedPath.match(/^\/fleet\/vans\/[^/]+\/history$/)) {
    const fromTab = searchParams?.get('fromTab');
    if (fromTab === 'maintenance') return '/maintenance';
    const validFleetTabs = ['plant', 'vans', 'hgvs', 'settings'];
    if (fromTab && validFleetTabs.includes(fromTab)) {
      return `/fleet?tab=${fromTab}`;
    }
    return '/fleet?tab=vans';
  }
  
  // Plant history routes
  if (normalizedPath.match(/^\/fleet\/plant\/[^/]+\/history$/)) {
    const fromTab = searchParams?.get('fromTab');
    if (fromTab === 'maintenance') return '/maintenance';
    const validFleetTabs = ['plant', 'vans', 'hgvs', 'settings'];
    if (fromTab && validFleetTabs.includes(fromTab)) {
      return `/fleet?tab=${fromTab}`;
    }
    return '/fleet?tab=plant';
  }
  
  // HGV history routes
  if (normalizedPath.match(/^\/fleet\/hgvs\/[^/]+\/history$/)) {
    const fromTab = searchParams?.get('fromTab');
    if (fromTab === 'maintenance') return '/maintenance';
    const validFleetTabs = ['plant', 'vans', 'hgvs', 'settings'];
    if (fromTab && validFleetTabs.includes(fromTab)) {
      return `/fleet?tab=${fromTab}`;
    }
    return '/fleet?tab=hgvs';
  }
  
  // Inspection routes
  if (normalizedPath === '/van-inspections/new') {
    return '/van-inspections';
  }
  if (normalizedPath.match(/^\/van-inspections\/[^/]+$/)) {
    return '/van-inspections';
  }
  if (normalizedPath === '/hgv-inspections/new') {
    return '/hgv-inspections';
  }
  if (normalizedPath.match(/^\/hgv-inspections\/[^/]+$/)) {
    return '/hgv-inspections';
  }
  
  // Timesheet routes
  if (normalizedPath === '/timesheets/new') {
    return '/timesheets';
  }
  if (normalizedPath.match(/^\/timesheets\/[^/]+$/)) {
    return '/timesheets';
  }
  
  // Absence routes
  if (normalizedPath === '/absence/manage') {
    return '/absence';
  }
  if (normalizedPath === '/absence/archive-report') {
    return '/absence/manage';
  }
  
  // Workshop tasks routes
  if (normalizedPath.match(/^\/workshop-tasks\/[^/]+$/)) {
    return '/workshop-tasks';
  }
  
  // Suggestions routes
  if (normalizedPath === '/suggestions/manage') {
    return '/dashboard'; // or '/suggestions' if there's a list view
  }
  
  // Admin routes
  if (normalizedPath === '/admin/faq') {
    return '/dashboard';
  }
  if (normalizedPath === '/admin/users') {
    return '/dashboard';
  }
  if (normalizedPath === '/admin/vehicles') {
    return '/dashboard';
  }
  
  // Approvals
  if (normalizedPath === '/approvals') {
    return '/dashboard';
  }
  
  // Actions
  if (normalizedPath === '/actions') {
    return '/dashboard';
  }
  
  // Debug
  if (normalizedPath === '/debug') {
    return '/dashboard';
  }
  
  // Maintenance routes
  if (normalizedPath.match(/^\/maintenance\/[^/]+$/)) {
    return '/maintenance';
  }
  
  // Toolbox talks
  if (normalizedPath === '/toolbox-talks') {
    return '/dashboard';
  }
  
  // Default fallback to dashboard
  return '/dashboard';
}
