/**
 * Module Pages Configuration
 * Defines all modules/pages with their sub-pages for error reporting dropdown
 */

import type { ModuleName } from '@/types/roles';
import { MODULE_DISPLAY_NAMES } from '@/types/roles';

export interface ModulePage {
  module: ModuleName | 'other';
  displayName: string;
  subPages: {
    value: string; // unique identifier
    label: string; // display name
  }[];
}

export const MODULE_PAGES: ModulePage[] = [
  {
    module: 'timesheets',
    displayName: MODULE_DISPLAY_NAMES.timesheets,
    subPages: [
      { value: 'timesheets-list', label: 'Timesheets List' },
      { value: 'timesheets-new', label: 'New Timesheet' },
      { value: 'timesheets-view', label: 'View/Edit Timesheet' },
    ],
  },
  {
    module: 'inspections',
    displayName: MODULE_DISPLAY_NAMES.inspections,
    subPages: [
      { value: 'inspections-list', label: 'Daily Checks List' },
      { value: 'inspections-new', label: 'New Daily Check' },
      { value: 'inspections-view', label: 'View Daily Check' },
    ],
  },
  {
    module: 'hgv-inspections',
    displayName: MODULE_DISPLAY_NAMES['hgv-inspections'],
    subPages: [
      { value: 'hgv-inspections-list', label: 'HGV Daily Checks List' },
      { value: 'hgv-inspections-new', label: 'New HGV Daily Check' },
      { value: 'hgv-inspections-view', label: 'View HGV Daily Check' },
    ],
  },
  {
    module: 'rams',
    displayName: MODULE_DISPLAY_NAMES.rams,
    subPages: [
      { value: 'projects-list', label: 'Projects List' },
      { value: 'projects-manage', label: 'Manage Projects' },
      { value: 'projects-view', label: 'View Project Document' },
      { value: 'projects-read', label: 'Read & Sign Document' },
      { value: 'projects-settings', label: 'Projects Settings' },
    ],
  },
  {
    module: 'absence',
    displayName: MODULE_DISPLAY_NAMES.absence,
    subPages: [
      { value: 'absence-list', label: 'Absence List' },
      { value: 'absence-manage', label: 'Manage Absence' },
      { value: 'absence-archive-report', label: 'Absence Archive Report' },
    ],
  },
  {
    module: 'maintenance',
    displayName: MODULE_DISPLAY_NAMES.maintenance,
    subPages: [
      { value: 'maintenance-overview', label: 'Maintenance Overview' },
      { value: 'maintenance-schedule', label: 'Maintenance Schedule' },
    ],
  },
  {
    module: 'workshop-tasks',
    displayName: MODULE_DISPLAY_NAMES['workshop-tasks'],
    subPages: [
      { value: 'workshop-tasks-list', label: 'Workshop Tasks List' },
      { value: 'workshop-tasks-new', label: 'New Task' },
      { value: 'workshop-tasks-view', label: 'View/Edit Task' },
    ],
  },
  {
    module: 'approvals',
    displayName: MODULE_DISPLAY_NAMES.approvals,
    subPages: [
      { value: 'approvals-list', label: 'Approvals List' },
      { value: 'approvals-timesheets', label: 'Timesheet Approvals' },
      { value: 'approvals-absence', label: 'Absence Approvals' },
    ],
  },
  {
    module: 'actions',
    displayName: MODULE_DISPLAY_NAMES.actions,
    subPages: [
      { value: 'actions-list', label: 'Actions (Legacy)' },
    ],
  },
  {
    module: 'reports',
    displayName: MODULE_DISPLAY_NAMES.reports,
    subPages: [
      { value: 'reports-list', label: 'Reports' },
      { value: 'reports-timesheets', label: 'Timesheet Reports' },
      { value: 'reports-absence', label: 'Absence Reports' },
    ],
  },
  {
    module: 'suggestions',
    displayName: MODULE_DISPLAY_NAMES.suggestions,
    subPages: [
      { value: 'suggestions-manage', label: 'Manage Suggestions' },
    ],
  },
  {
    module: 'faq-editor',
    displayName: MODULE_DISPLAY_NAMES['faq-editor'],
    subPages: [
      { value: 'faq-editor-main', label: 'FAQ Editor' },
      { value: 'faq-editor-categories', label: 'Category Manager' },
    ],
  },
  {
    module: 'error-reports',
    displayName: MODULE_DISPLAY_NAMES['error-reports'],
    subPages: [
      { value: 'error-reports-manage', label: 'Manage Error Reports' },
    ],
  },
  {
    module: 'toolbox-talks',
    displayName: MODULE_DISPLAY_NAMES['toolbox-talks'],
    subPages: [
      { value: 'toolbox-talks-list', label: 'Overview' },
      { value: 'toolbox-talks-new', label: 'Create Toolbox Talk' },
      { value: 'toolbox-talks-reminder', label: 'Create Notification / Reminder' },
    ],
  },
  {
    module: 'training',
    displayName: MODULE_DISPLAY_NAMES.training,
    subPages: [
      { value: 'training-overview', label: 'Overview' },
      { value: 'training-records', label: 'Records' },
      { value: 'training-people', label: 'People' },
      { value: 'training-qualifications', label: 'Qualifications' },
      { value: 'training-notes', label: 'Workbook Notes' },
    ],
  },
  {
    module: 'admin-users',
    displayName: 'User Management',
    subPages: [
      { value: 'admin-users-list', label: 'User Management' },
      { value: 'admin-users-roles', label: 'Role Management' },
    ],
  },
  {
    module: 'admin-vans',
    displayName: 'Fleet Management',
    subPages: [
      { value: 'admin-vans-list', label: 'Vans List' },
      { value: 'admin-vans-history', label: 'Van History' },
    ],
  },
  {
    module: 'inventory',
    displayName: MODULE_DISPLAY_NAMES.inventory,
    subPages: [
      { value: 'inventory-overview', label: 'Inventory Overview' },
      { value: 'inventory-locations', label: 'Location Management' },
    ],
  },
  {
    module: 'reminders',
    displayName: MODULE_DISPLAY_NAMES.reminders,
    subPages: [
      { value: 'reminders-list', label: 'Reminders List' },
    ],
  },
  {
    module: 'scheduling',
    displayName: MODULE_DISPLAY_NAMES.scheduling,
    subPages: [
      { value: 'scheduling-board', label: 'Scheduling Board' },
      { value: 'scheduling-my', label: 'My Schedule' },
    ],
  },
  {
    module: 'other',
    displayName: 'Other',
    subPages: [
      { value: 'dashboard', label: 'Dashboard' },
      { value: 'notifications', label: 'Notifications' },
      { value: 'help', label: 'Help & FAQ' },
      { value: 'fleet-overview', label: 'Fleet Overview' },
      { value: 'something-else', label: 'Something else' },
    ],
  },
];

/**
 * Get all page options flattened for dropdown
 */
export function getAllPageOptions(): Array<{ value: string; label: string; module: string }> {
  const options: Array<{ value: string; label: string; module: string }> = [];
  
  MODULE_PAGES.forEach(moduleGroup => {
    moduleGroup.subPages.forEach(page => {
      options.push({
        value: page.value,
        label: `${moduleGroup.displayName} - ${page.label}`,
        module: moduleGroup.displayName,
      });
    });
  });
  
  return options;
}

/**
 * Get page label by value
 */
export function getPageLabel(value: string): string {
  for (const moduleGroup of MODULE_PAGES) {
    const page = moduleGroup.subPages.find(p => p.value === value);
    if (page) {
      return `${moduleGroup.displayName} - ${page.label}`;
    }
  }
  return value;
}

/**
 * Get actual page URL by value
 */
export function getPageUrl(value: string): string {
  // Map page values to their actual URLs
  const urlMap: Record<string, string> = {
    // Timesheets
    'timesheets-list': '/timesheets',
    'timesheets-new': '/timesheets/new',
    'timesheets-view': '/timesheets/[id]',
    
    // Inspections
    'inspections-list': '/van-inspections',
    'inspections-new': '/van-inspections/new',
    'inspections-view': '/van-inspections/[id]',
    'hgv-inspections-list': '/hgv-inspections',
    'hgv-inspections-new': '/hgv-inspections/new',
    'hgv-inspections-view': '/hgv-inspections/[id]',
    
    // Projects (formerly RAMS)
    'projects-list': '/projects',
    'projects-manage': '/projects/manage',
    'projects-view': '/projects/[id]',
    'projects-read': '/projects/[id]/read',
    'projects-settings': '/projects/settings',
    
    // Absence
    'absence-list': '/absence',
    'absence-manage': '/absence/manage',
    'absence-archive-report': '/absence/archive-report',
    
    // Maintenance
    'maintenance-overview': '/maintenance',
    'maintenance-schedule': '/maintenance',
    
    // Workshop Tasks
    'workshop-tasks-list': '/workshop-tasks',
    'workshop-tasks-new': '/workshop-tasks',
    'workshop-tasks-view': '/workshop-tasks?taskId=[id]',
    
    // Approvals
    'approvals-list': '/approvals',
    'approvals-timesheets': '/approvals?tab=timesheets',
    'approvals-absence': '/approvals?tab=absences',
    
    // Actions
    'actions-list': '/actions',
    
    // Reports
    'reports-list': '/reports',
    'reports-timesheets': '/reports?reportTab=timesheets',
    'reports-absence': '/reports?reportTab=absence-leave',

    // Suggestions / FAQ / Error Reports
    'suggestions-manage': '/suggestions/manage',
    'faq-editor-main': '/admin/faq',
    'faq-editor-categories': '/admin/faq',
    'error-reports-manage': '/admin/errors/manage',
    
    // Toolbox Talks
    'toolbox-talks-list': '/toolbox-talks?tab=overview',
    'toolbox-talks-new': '/toolbox-talks?tab=create-toolbox-talk',
    'toolbox-talks-reminder': '/toolbox-talks?tab=create-reminder',

    // Training
    'training-overview': '/training?tab=overview',
    'training-records': '/training?tab=records',
    'training-people': '/training?tab=people',
    'training-qualifications': '/training?tab=qualifications',
    'training-notes': '/training?tab=notes',
    
    // Admin - Users
    'admin-users-list': '/admin/users',
    'admin-users-roles': '/admin/users?tab=roles',
    
    // Admin - Vans
    'admin-vans-list': '/fleet?tab=vans',
    'admin-vans-new': '/fleet?tab=vans',

    // Inventory
    'inventory-overview': '/inventory',
    'inventory-locations': '/inventory?tab=locations',

    // Reminders
    'reminders-list': '/reminders',

    // Scheduling
    'scheduling-board': '/scheduling',
    'scheduling-my': '/scheduling/my',
    
    // Admin - FAQ
    'admin-faq-list': '/admin/faq',
    'admin-faq-categories': '/admin/faq/categories',
    
    // Other
    'dashboard': '/dashboard',
    'notifications': '/notifications',
    'help': '/help',
    'fleet-overview': '/fleet',
    'something-else': '/help', // fallback to help page
  };
  
  return urlMap[value] || value;
}
