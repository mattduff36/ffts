/**
 * Navigation Configuration - Single Source of Truth
 * 
 * This file defines all navigation items used across:
 * - Dashboard tiles (Quick Actions & Management Tools)
 * - Top navigation bar
 * - Left sidebar navigation
 * 
 * To add a new module:
 * 1. Add it to the appropriate array below
 * 2. It will automatically appear in all navigation areas
 */

import {
  Home,
  FileText,
  ClipboardCheck,
  CheckSquare,
  Calendar,
  Wrench,
  Settings,
  ListTodo,
  MessageSquare,
  BarChart3,
  Users,
  Truck,
  HelpCircle,
  Lightbulb,
  AlertTriangle,
  Building2,
  Receipt,
  SlidersHorizontal,
  PackageSearch,
  GraduationCap,
  LucideIcon
} from 'lucide-react';
import { ModuleName } from '@/types/roles';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleName; // For permission checking
  category?: 'employee' | 'manager' | 'admin'; // Which nav area it belongs to
  dropdownItems?: NavItem[]; // For dropdown menus
}

const clientNavigationPriorityHrefs: string[] = [
  '/projects',
  '/inventory',
  '/quotes',
  '/customers',
  '/reports',
  '/van-inspections',
  '/plant-inspections',
  '/hgv-inspections',
];

function orderNavItemsForClientPriorities(items: NavItem[]): NavItem[] {
  if (clientNavigationPriorityHrefs.length === 0) {
    return items;
  }

  const priorityByHref = new Map(
    clientNavigationPriorityHrefs.map((href, index) => [href, index])
  );

  return [...items].sort((left, right) => {
    const leftPriority = priorityByHref.get(left.href) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priorityByHref.get(right.href) ?? Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority;
  });
}

/**
 * Employee Navigation Items
 * These appear in:
 * - Dashboard Quick Actions tiles
 * - Top navigation bar
 */
const baseEmployeeNavItems: NavItem[] = [
  { 
    href: '/timesheets', 
    label: 'Timesheets', 
    icon: FileText, 
    module: 'timesheets',
    category: 'employee'
  },
  { 
    href: '/van-inspections', 
    label: 'Van Daily Checks', 
    icon: ClipboardCheck, 
    module: 'inspections',
    category: 'employee'
  },
  { 
    href: '/plant-inspections', 
    label: 'Plant Daily Checks', 
    icon: ClipboardCheck, 
    module: 'plant-inspections',
    category: 'employee'
  },
  { 
    href: '/hgv-inspections', 
    label: 'HGV Daily Checks', 
    icon: ClipboardCheck, 
    module: 'hgv-inspections',
    category: 'employee'
  },
  { 
    href: '/projects', 
    label: 'Projects', 
    icon: CheckSquare, 
    module: 'rams',
    category: 'employee'
  },
  { 
    href: '/absence', 
    label: 'Absence', 
    icon: Calendar, 
    module: 'absence',
    category: 'employee'
  },
  { 
    href: '/maintenance', 
    label: 'Maintenance', 
    icon: Wrench, 
    module: 'maintenance',
    category: 'employee'
  },
  { 
    href: '/fleet', 
    label: 'Fleet', 
    icon: Truck, 
    module: 'admin-vans',
    category: 'employee'
  },
  { 
    href: '/workshop-tasks', 
    label: 'Workshop', 
    icon: Settings, 
    module: 'workshop-tasks',
    category: 'employee'
  },
  {
    href: '/inventory',
    label: 'Inventory',
    icon: PackageSearch,
    module: 'inventory',
    category: 'employee'
  },
  { 
    href: '/help', 
    label: 'Help', 
    icon: HelpCircle, 
    // No module - always visible to all authenticated users
    category: 'employee'
  },
];

export const employeeNavItems: NavItem[] = orderNavItemsForClientPriorities(baseEmployeeNavItems);

/**
 * Manager Navigation Items
 * These appear in:
 * - Dashboard Management Tools tiles
 * - Top navigation bar (mobile menu)
 * - Left sidebar navigation
 */
const baseManagerNavItems: NavItem[] = [
  { 
    href: '/approvals', 
    label: 'Approvals', 
    icon: CheckSquare,
    module: 'approvals',
    category: 'manager'
  },
  { 
    href: '/actions', 
    label: 'Actions', 
    icon: ListTodo,
    module: 'actions',
    category: 'manager'
  },
  {
    href: '/absence/manage',
    label: 'Manage Absence',
    icon: Calendar,
    module: 'absence',
    category: 'manager'
  },
  { 
    href: '/toolbox-talks', 
    label: 'Toolbox Talks', 
    icon: MessageSquare,
    module: 'toolbox-talks',
    category: 'manager'
  },
  {
    href: '/training',
    label: 'Training',
    icon: GraduationCap,
    module: 'training',
    category: 'manager'
  },
  { 
    href: '/reports', 
    label: 'Reports', 
    icon: BarChart3,
    module: 'reports',
    category: 'manager'
  },
  { 
    href: '/suggestions/manage', 
    label: 'Suggestions', 
    icon: Lightbulb,
    module: 'suggestions',
    category: 'manager'
  },
];

export const managerNavItems: NavItem[] = orderNavItemsForClientPriorities(baseManagerNavItems);

/**
 * Admin Navigation Items
 * These appear in:
 * - Dashboard Management Tools tiles
 * - Top navigation bar (mobile menu)
 * - Left sidebar navigation
 */
const baseAdminNavItems: NavItem[] = [
  { 
    href: '/customers', 
    label: 'Customers', 
    icon: Building2,
    module: 'customers',
    category: 'admin'
  },
  { 
    href: '/quotes', 
    label: 'Quotes', 
    icon: Receipt,
    module: 'quotes',
    category: 'admin'
  },
  { 
    href: '/admin/users', 
    label: 'Users', 
    icon: Users,
    module: 'admin-users',
    category: 'admin'
  },
  {
    href: '/admin/settings',
    label: 'Admin Settings',
    icon: SlidersHorizontal,
    module: 'admin-settings',
    category: 'admin',
  },
  { 
    href: '/admin/faq', 
    label: 'FAQ Editor', 
    icon: HelpCircle,
    module: 'faq-editor',
    category: 'admin'
  },
  { 
    href: '/admin/errors/manage', 
    label: 'Error Reports', 
    icon: AlertTriangle,
    module: 'error-reports',
    category: 'admin'
  },
];

export const adminNavItems: NavItem[] = orderNavItemsForClientPriorities(baseAdminNavItems);

/**
 * Dashboard Navigation Item
 * Always visible
 */
export const dashboardNavItem: NavItem = {
  href: '/dashboard',
  label: 'Dashboard',
  icon: Home,
};

/**
 * Get all navigation items filtered by permissions
 * 
 * @param userPermissions - Set of modules user has access to
 * @param isManager - Whether user is a manager
 * @param isAdmin - Whether user is an admin
 * @param hasRAMSAssignments - Whether user has RAMS assignments (for filtering)
 * @returns Filtered navigation items
 */
export function getFilteredEmployeeNav(
  userPermissions: Set<ModuleName>,
  isManager: boolean,
  isAdmin: boolean,
  hasRAMSAssignments: boolean
): NavItem[] {
  return employeeNavItems.filter(item => {
    // For items with dropdown children, check if user has access to ANY child
    if (item.dropdownItems && item.dropdownItems.length > 0) {
      const hasAccessToAnyChild = item.dropdownItems.some(child => {
        // If child has no module requirement, it's accessible
        if (!child.module) return true;
        // Otherwise check if user has the module permission
        return userPermissions.has(child.module);
      });
      
      // If user has access to at least one child, show the parent
      return hasAccessToAnyChild;
    }
    
    // Check basic permission for employees
    if (item.module && !userPermissions.has(item.module)) {
      return false;
    }
    
    // Special handling for RAMS - hide for employees with no assignments
    if (item.module === 'rams' && !hasRAMSAssignments && !isManager && !isAdmin) {
      return false;
    }
    
    return true;
  });
}

export function getFilteredNavByPermissions(
  items: NavItem[],
  userPermissions: Set<ModuleName>,
  isAdmin: boolean
): NavItem[] {
  if (isAdmin) {
    return items;
  }

  return items.filter((item) => {
    if (!item.module) {
      return true;
    }
    return userPermissions.has(item.module);
  });
}

