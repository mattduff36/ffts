// Role and Permission Types

export type RoleClass = 'admin' | 'manager' | 'employee';

export interface Role {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  role_class: RoleClass;
  hierarchy_rank?: number | null;
  is_super_admin: boolean;
  is_manager_admin: boolean;
  timesheet_type?: string;
  created_at: string;
  updated_at: string;
}

export interface RolePermission {
  id: string;
  role_id: string;
  module_name: ModuleName;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleWithPermissions extends Role {
  permissions: RolePermission[];
  user_count?: number;
}

export interface RoleWithUserCount extends Role {
  user_count: number;
  permission_count: number;
}

export interface RoleMatrixRow extends Role {
  user_count: number;
  permissions: Record<ModuleName, boolean>;
}

export interface PermissionTierRole {
  id: string;
  name: string;
  display_name: string;
  role_class: RoleClass;
  hierarchy_rank: number;
  is_super_admin: boolean;
  is_manager_admin: boolean;
}

export interface PermissionModuleDefinition {
  module_name: ModuleName;
  display_name: string;
  short_name: string;
  description: string;
  color_var: string;
}

export interface PermissionModuleMatrixColumn extends PermissionModuleDefinition {
  minimum_role_id: string;
  minimum_role_name: string;
  minimum_hierarchy_rank: number;
  sort_order: number;
}

export interface TeamPermissionMatrixRow {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  permissions: Record<ModuleName, boolean>;
}

export interface TeamPermissionMatrixResponse {
  success: boolean;
  roles: PermissionTierRole[];
  modules: PermissionModuleMatrixColumn[];
  teams: TeamPermissionMatrixRow[];
}

export const STANDARD_MODULES: ModuleName[] = [
  'timesheets',
  'inspections',
  'plant-inspections',
  'hgv-inspections',
  'rams',
  'absence',
  'maintenance',
  'workshop-tasks',
  'admin-vans',
  'inventory',
];

export const MANAGEMENT_MODULES: ModuleName[] = [
  'approvals',
  'actions',
  'reports',
  'toolbox-talks',
  'suggestions',
  'faq-editor',
  'error-reports',
  'admin-users',
  'admin-settings',
  'customers',
  'quotes',
];

export const MODULE_SHORT_NAMES: Record<ModuleName, string> = {
  'timesheets': 'Timesheets',
  'inspections': 'Van Checks',
  'plant-inspections': 'Plant Checks',
  'hgv-inspections': 'HGV Checks',
  'rams': 'Projects',
  'absence': 'Absence',
  'maintenance': 'Maint.',
  'toolbox-talks': 'Toolbox',
  'workshop-tasks': 'Workshop',
  'approvals': 'Approvals',
  'actions': 'Actions',
  'reports': 'Reports',
  'suggestions': 'Suggest.',
  'faq-editor': 'FAQ',
  'error-reports': 'Errors',
  'admin-users': 'Users',
  'admin-settings': 'Settings',
  'admin-vans': 'Fleet',
  'customers': 'Customers',
  'quotes': 'Quotes',
  'inventory': 'Inventory',
};

export const MODULE_CSS_VAR: Record<ModuleName, string> = {
  'timesheets': '--timesheet-primary',
  'inspections': '--inspection-primary',
  'plant-inspections': '--plant-inspection-primary',
  'hgv-inspections': '--inspection-primary',
  'rams': '--rams-primary',
  'absence': '--absence-primary',
  'maintenance': '--maintenance-primary',
  'toolbox-talks': '--brand-yellow',
  'workshop-tasks': '--workshop-primary',
  'approvals': '--brand-yellow',
  'actions': '--brand-yellow',
  'reports': '--brand-yellow',
  'suggestions': '--brand-yellow',
  'faq-editor': '--brand-yellow',
  'error-reports': '--brand-yellow',
  'admin-users': '--brand-yellow',
  'admin-settings': '--brand-yellow',
  'admin-vans': '--fleet-primary',
  'customers': '--brand-yellow',
  'quotes': '--brand-yellow',
  'inventory': '--inventory-primary',
};

// All available modules in the system
export type ModuleName =
  | 'timesheets'
  | 'inspections'
  | 'plant-inspections'
  | 'hgv-inspections'
  | 'rams'
  | 'absence'
  | 'maintenance'
  | 'toolbox-talks'
  | 'workshop-tasks'
  | 'approvals'
  | 'actions'
  | 'reports'
  | 'suggestions'
  | 'faq-editor'
  | 'error-reports'
  | 'admin-users'
  | 'admin-settings'
  | 'admin-vans'
  | 'customers'
  | 'quotes'
  | 'inventory';

export const ALL_MODULES: ModuleName[] = [
  'timesheets',
  'inspections',
  'plant-inspections',
  'hgv-inspections',
  'rams',
  'absence',
  'maintenance',
  'toolbox-talks',
  'workshop-tasks',
  'approvals',
  'actions',
  'reports',
  'suggestions',
  'faq-editor',
  'error-reports',
  'admin-users',
  'admin-settings',
  'admin-vans',
  'customers',
  'quotes',
  'inventory',
];

export const MODULE_DISPLAY_NAMES: Record<ModuleName, string> = {
  'timesheets': 'Timesheets',
  'inspections': 'Van Daily Checks',
  'plant-inspections': 'Plant Daily Checks',
  'hgv-inspections': 'HGV Daily Checks',
  'rams': 'Projects',
  'absence': 'Absence & Leave',
  'maintenance': 'Maintenance & Service',
  'toolbox-talks': 'Toolbox Talks',
  'workshop-tasks': 'Workshop Tasks',
  'approvals': 'Approvals',
  'actions': 'Actions',
  'reports': 'Reports',
  'suggestions': 'Suggestions',
  'faq-editor': 'FAQ Editor',
  'error-reports': 'Error Reports',
  'admin-users': 'User Management',
  'admin-settings': 'Admin Settings',
  'admin-vans': 'Fleet Management',
  'customers': 'Customers',
  'quotes': 'Quotes',
  'inventory': 'Inventory',
};

export const MODULE_DESCRIPTIONS: Record<ModuleName, string> = {
  'timesheets': 'Create and submit timesheets',
  'inspections': 'Perform van daily checks',
  'plant-inspections': 'Perform plant machinery daily checks',
  'hgv-inspections': 'Perform daily HGV checks',
  'rams': 'Access and sign project documents',
  'absence': 'Request and manage absence',
  'maintenance': 'Track and manage van maintenance schedules',
  'toolbox-talks': 'Send toolbox talks to users (admin/manager only)',
  'workshop-tasks': 'Track van & plant repairs and workshop work',
  'approvals': 'Approve timesheets, daily checks, and absences',
  'actions': 'Manage and track actions',
  'reports': 'View system reports',
  'suggestions': 'Review and triage user suggestions',
  'faq-editor': 'Manage FAQ categories and articles',
  'error-reports': 'Review and resolve submitted error reports',
  'admin-users': 'Manage user accounts',
  'admin-settings': 'Manage admin-only tools and settings',
  'admin-vans': 'Manage fleet assets',
  'customers': 'Manage customer directory',
  'quotes': 'Create and track customer quotations',
  'inventory': 'Track small tools, equipment, and location buckets',
};

// For API responses
export interface GetRolesResponse {
  success: boolean;
  roles: RoleWithUserCount[];
}

export interface GetRoleResponse {
  success: boolean;
  role: RoleWithPermissions;
}

export interface CreateRoleRequest {
  name: string;
  display_name: string;
  description?: string;
  role_class?: RoleClass;
  role_type?: RoleClass;
  hierarchy_rank?: number | null;
  timesheet_type?: string;
}

export interface UpdateRoleRequest {
  name?: string;
  display_name?: string;
  description?: string;
  role_class?: RoleClass;
  hierarchy_rank?: number | null;
  timesheet_type?: string;
}

export interface UpdatePermissionsRequest {
  permissions: {
    module_name: ModuleName;
    enabled: boolean;
  }[];
}

export interface UpdateTeamPermissionsRequest {
  permissions: {
    module_name: ModuleName;
    enabled: boolean;
  }[];
}

export interface ShiftPermissionModuleRequest {
  direction: 'left' | 'right';
}

export function createEmptyModulePermissionRecord(): Record<ModuleName, boolean> {
  return ALL_MODULES.reduce((acc, moduleName) => {
    acc[moduleName] = false;
    return acc;
  }, {} as Record<ModuleName, boolean>);
}

export const MODULE_DEFINITIONS: PermissionModuleDefinition[] = ALL_MODULES.map((module_name) => ({
  module_name,
  display_name: MODULE_DISPLAY_NAMES[module_name],
  short_name: MODULE_SHORT_NAMES[module_name],
  description: MODULE_DESCRIPTIONS[module_name],
  color_var: MODULE_CSS_VAR[module_name],
}));

export interface UserPermissions {
  [key: string]: boolean;
}

