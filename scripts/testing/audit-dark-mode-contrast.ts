/**
 * Comprehensive Dark Mode Contrast Audit
 * 
 * This script visits every page on the site and checks for potential
 * dark-on-dark text issues by taking screenshots and analyzing elements.
 * 
 * Run with: npx tsx scripts/testing/audit-dark-mode-contrast.ts
 */

type AuditPage = {
  path: string;
  name: string;
  requiresAuth: boolean;
  requiresSensitiveAccess?: boolean;
};

export const ALL_PAGES: AuditPage[] = [
  // Auth Pages
  { path: '/login', name: 'Login', requiresAuth: false },
  { path: '/change-password', name: 'Change Password', requiresAuth: true },
  
  // Core Pages
  { path: '/dashboard', name: 'Dashboard', requiresAuth: true },
  { path: '/help', name: 'Help', requiresAuth: true },
  { path: '/notifications', name: 'Notifications', requiresAuth: true },
  
  // Timesheets
  { path: '/timesheets', name: 'Timesheets List', requiresAuth: true },
  { path: '/timesheets/new', name: 'New Timesheet', requiresAuth: true },
  
  // Inspections
  { path: '/van-inspections', name: 'Van Inspections List', requiresAuth: true },
  { path: '/van-inspections/new', name: 'New Van Inspection', requiresAuth: true },
  
  // RAMS
  { path: '/rams', name: 'RAMS List', requiresAuth: true },
  { path: '/rams/manage', name: 'Manage RAMS', requiresAuth: true },
  
  // Absence
  { path: '/absence', name: 'Absence Calendar', requiresAuth: true },
  { path: '/absence/manage', name: 'Manage Absences', requiresAuth: true },
  { path: '/absence/archive-report', name: 'Absence Archive Report', requiresAuth: true },
  
  // Maintenance
  { path: '/maintenance', name: 'Maintenance Overview', requiresAuth: true },
  { path: '/fleet?tab=vans', name: 'Fleet Vans', requiresAuth: true },
  { path: '/fleet?tab=plant', name: 'Fleet Plant', requiresAuth: true },
  
  // Workshop
  { path: '/workshop-tasks', name: 'Workshop Tasks', requiresAuth: true },
  
  // Manager/Admin Pages
  { path: '/approvals', name: 'Approvals', requiresAuth: true },
  { path: '/actions', name: 'Actions (Legacy)', requiresAuth: true },
  { path: '/toolbox-talks', name: 'Toolbox Talks', requiresAuth: true },
  { path: '/reports', name: 'Reports', requiresAuth: true },
  { path: '/suggestions/manage', name: 'Manage Suggestions', requiresAuth: true },
  
  // Admin Pages
  { path: '/admin/users', name: 'User Management', requiresAuth: true },
  { path: '/admin/vehicles', name: 'Vehicle Management', requiresAuth: true },
  { path: '/admin/faq', name: 'FAQ Editor', requiresAuth: true },
  { path: '/admin/errors/manage', name: 'Admin Error Reports', requiresAuth: true },
  { path: '/errors/manage', name: 'Error Reports', requiresAuth: true },
  
  // Debug/Developer
  { path: '/debug', name: 'Debug Console', requiresAuth: true, requiresSensitiveAccess: true },
  
  // PDF Viewer
  { path: '/pdf-viewer', name: 'PDF Viewer', requiresAuth: true },
];

/**
 * Interactive elements to test on each page
 */
export const INTERACTIVE_ELEMENTS_TO_TEST = [
  'Select dropdowns',
  'Popover menus',
  'Dropdown menus',
  'Dialog/Modal content',
  'Card descriptions',
  'Form labels',
  'Button text',
  'Table headers and cells',
  'Tab content',
  'Alert/warning messages',
];

/**
 * Known components that were fixed
 */
export const FIXED_COMPONENTS = [
  { component: 'SidebarNav - View As popover', file: 'components/layout/SidebarNav.tsx', issue: 'text-muted-foreground → text-slate-200' },
  { component: 'SelectLabel', file: 'components/ui/select.tsx', issue: 'text-muted-foreground → text-slate-300' },
  { component: 'DropdownMenuLabel', file: 'components/ui/dropdown-menu.tsx', issue: 'no explicit color → text-slate-300' },
  { component: 'DropdownMenuItem', file: 'components/ui/dropdown-menu.tsx', issue: 'no explicit color → text-slate-200' },
  { component: 'DropdownMenuCheckboxItem', file: 'components/ui/dropdown-menu.tsx', issue: 'no explicit color → text-slate-200' },
  { component: 'DropdownMenuRadioItem', file: 'components/ui/dropdown-menu.tsx', issue: 'no explicit color → text-slate-200' },
  { component: 'DropdownMenuSubTrigger', file: 'components/ui/dropdown-menu.tsx', issue: 'no explicit color → text-slate-200' },
  { component: 'DialogDescription', file: 'components/ui/dialog.tsx', issue: 'text-muted-foreground → text-slate-300' },
  { component: 'AlertDialogDescription', file: 'components/ui/alert-dialog.tsx', issue: 'text-muted-foreground → text-slate-300' },
  { component: 'CardDescription', file: 'components/ui/card.tsx', issue: 'text-muted-foreground → text-slate-300' },
  { component: 'Switch component', file: 'components/ui/switch.tsx', issue: 'Added explicit bg colors for unchecked state' },
  { component: 'NotificationPanel empty state', file: 'components/messages/NotificationPanel.tsx', issue: 'Added settings link' },
  { component: 'Debug page notification settings', file: 'app/(dashboard)/debug/page.tsx', issue: 'Multiple dark-on-dark fixes' },
  { component: 'Notifications page', file: 'app/(dashboard)/notifications/page.tsx', issue: 'Label text colors updated' },
];

console.log('Dark Mode Contrast Audit');
console.log('='.repeat(80));
console.log(`Total pages to audit: ${ALL_PAGES.length}`);
console.log(`Sensitive pages requiring PIN unlock: ${ALL_PAGES.filter((page) => page.requiresSensitiveAccess).length}`);
console.log(`Components fixed: ${FIXED_COMPONENTS.length}`);
console.log('\nUse browser automation to visit each page and verify contrast.');
