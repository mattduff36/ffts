import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

/**
 * Notification Preferences Types
 */

export type NotificationModuleKey =
  | 'errors'
  | 'maintenance'
  | 'rams'
  | 'approvals'
  | 'inspections'
  | 'absence'
  | 'timesheets'
  | 'inventory'
  | 'processed_absence'
  | 'training'
  | 'suggestions'
  | 'toolbox_talks'
  | 'reminders'
  | 'quotes'
  | 'general_notifications'
  | 'sensitive_pin_security';

export const NOTIFICATION_MODULE_KEYS: NotificationModuleKey[] = [
  'errors',
  'maintenance',
  'rams',
  'approvals',
  'inspections',
  'absence',
  'timesheets',
  'inventory',
  'processed_absence',
  'training',
  'suggestions',
  'toolbox_talks',
  'reminders',
  'quotes',
  'general_notifications',
  'sensitive_pin_security',
];

export const REQUIRED_NOTIFICATION_MODULE_KEYS: NotificationModuleKey[] = [
  'toolbox_talks',
];

export function canDisableNotificationModule(moduleKey: NotificationModuleKey): boolean {
  return !REQUIRED_NOTIFICATION_MODULE_KEYS.includes(moduleKey);
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  module_key: NotificationModuleKey;
  enabled: boolean;
  notify_in_app: boolean;
  notify_email: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationModule {
  key: NotificationModuleKey;
  label: string;
  description: string;
  icon: string; // lucide icon name
  availableFor: 'all' | 'admin' | 'manager'; // who can receive these
}

interface NotificationModuleAccessRule {
  moduleNames: ModuleName[];
  minimumLevel: PermissionAccessLevel;
}

export interface NotificationModuleAccessContext {
  isAdmin: boolean;
  isManager: boolean;
  permissionLevels?: Record<string, number | null | undefined> | null;
}

export const NOTIFICATION_MODULES: NotificationModule[] = [
  {
    key: 'errors',
    label: 'Error Reports',
    description: 'Notifications when errors are reported or detected',
    icon: 'AlertTriangle',
    availableFor: 'admin',
  },
  {
    key: 'maintenance',
    label: 'Maintenance Alerts',
    description: 'Overdue and due soon maintenance reminders',
    icon: 'Wrench',
    availableFor: 'all',
  },
  {
    key: 'rams',
    label: 'Projects / RAMS',
    description: 'Project document assignments, RAMS signatures, and related updates',
    icon: 'FileText',
    availableFor: 'manager',
  },
  {
    key: 'approvals',
    label: 'Approval Requests',
    description: 'Timesheet, daily check, and absence approval notifications',
    icon: 'CheckSquare',
    availableFor: 'manager',
  },
  {
    key: 'inspections',
    label: 'Daily Checks & Defects',
    description: 'Inspection follow-ups, defect reports, and workshop task alerts',
    icon: 'ClipboardCheck',
    availableFor: 'all',
  },
  {
    key: 'absence',
    label: 'Absence',
    description: 'Leave requests, cancellations, and absence-related alerts',
    icon: 'CalendarDays',
    availableFor: 'all',
  },
  {
    key: 'timesheets',
    label: 'Timesheets',
    description: 'Timesheet exceptions and working-time alerts',
    icon: 'Clock',
    availableFor: 'all',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Small tool, equipment, and location request notifications',
    icon: 'Package',
    availableFor: 'all',
  },
  {
    key: 'processed_absence',
    label: 'Processed Absence Updates',
    description: 'Updates to processed absence and related timesheet adjustments',
    icon: 'CalendarCheck',
    availableFor: 'all',
  },
  {
    key: 'training',
    label: 'Training',
    description: 'Training booking and attendance notifications',
    icon: 'GraduationCap',
    availableFor: 'all',
  },
  {
    key: 'suggestions',
    label: 'Suggestions',
    description: 'Suggestion status changes and response notifications',
    icon: 'Lightbulb',
    availableFor: 'all',
  },
  {
    key: 'toolbox_talks',
    label: 'Toolbox Talks',
    description: 'Assigned toolbox talks that need reading and signing',
    icon: 'PenLine',
    availableFor: 'all',
  },
  {
    key: 'reminders',
    label: 'Reminders',
    description: 'Manual reminders and follow-up actions assigned to you',
    icon: 'Bell',
    availableFor: 'all',
  },
  {
    key: 'quotes',
    label: 'Quotes',
    description: 'Quote workflow and invoice request notifications',
    icon: 'Receipt',
    availableFor: 'all',
  },
  {
    key: 'general_notifications',
    label: 'General Notices',
    description: 'Operational notifications that are not tied to a more specific module',
    icon: 'Bell',
    availableFor: 'all',
  },
  {
    key: 'sensitive_pin_security',
    label: 'Sensitive PIN Security',
    description: 'Admin alerts when users set or change sensitive module PINs',
    icon: 'Shield',
    availableFor: 'admin',
  },
];

const NOTIFICATION_MODULE_ACCESS_RULES: Partial<Record<NotificationModuleKey, NotificationModuleAccessRule>> = {
  errors: {
    moduleNames: ['error-reports'],
    minimumLevel: 1,
  },
  rams: {
    moduleNames: ['rams'],
    minimumLevel: 3,
  },
  approvals: {
    moduleNames: ['approvals'],
    minimumLevel: 3,
  },
  sensitive_pin_security: {
    moduleNames: ['admin-settings'],
    minimumLevel: 4,
  },
};

function hasNotificationModulePermission(
  permissionLevels: Record<string, number | null | undefined> | null | undefined,
  rule: NotificationModuleAccessRule | undefined
): boolean {
  if (!permissionLevels || !rule) return false;

  return rule.moduleNames.some((moduleName) => {
    const level = permissionLevels[moduleName] ?? 0;
    return level >= rule.minimumLevel;
  });
}

export function isNotificationModuleAvailable(
  module: NotificationModule,
  context: NotificationModuleAccessContext
): boolean {
  if (module.availableFor === 'all') return true;

  const hasPermissionAccess = hasNotificationModulePermission(
    context.permissionLevels,
    NOTIFICATION_MODULE_ACCESS_RULES[module.key]
  );

  if (module.availableFor === 'admin') return context.isAdmin || hasPermissionAccess;
  if (module.availableFor === 'manager') return context.isManager || context.isAdmin || hasPermissionAccess;

  return false;
}

export function getAvailableNotificationModules(
  context: NotificationModuleAccessContext
): NotificationModule[] {
  return NOTIFICATION_MODULES.filter((module) => isNotificationModuleAvailable(module, context));
}

// API request/response types
export interface GetNotificationPreferencesResponse {
  success: boolean;
  preferences: NotificationPreference[];
  error?: string;
}

export interface UpdateNotificationPreferenceRequest {
  module_key: NotificationModuleKey;
  enabled?: boolean;
  notify_in_app?: boolean;
  notify_email?: boolean;
}

export interface UpdateNotificationPreferenceResponse {
  success: boolean;
  preference: NotificationPreference;
  error?: string;
}

// Admin API types
export interface GetAllNotificationPreferencesResponse {
  success: boolean;
  users: Array<{
    user_id: string;
    full_name: string;
    role_name: string;
    role_display_name: string;
    role_class: 'admin' | 'manager' | 'employee' | null;
    is_super_admin: boolean;
    preferences: NotificationPreference[];
  }>;
  error?: string;
}

export interface AdminUpdatePreferenceRequest {
  user_id: string;
  module_key: NotificationModuleKey;
  enabled?: boolean;
  notify_in_app?: boolean;
  notify_email?: boolean;
}
