import { MODULE_DISPLAY_NAMES, type ModuleName, type SensitiveAccessModuleName } from '../../types/roles';

export type ReleaseDescriptorCategory =
  | 'standard'
  | 'management'
  | 'global'
  | 'hidden'
  | 'infrastructure'
  | 'test';

export type ReleaseDescriptorType = 'chore' | 'docs' | 'feat' | 'fix' | 'test';

export interface ReleaseModuleDescriptor {
  id: string;
  scope: string;
  type: ReleaseDescriptorType;
  category: ReleaseDescriptorCategory;
  clientFacingName: string;
  versionHistoryArea: string;
  subject: string;
  priority: number;
  patterns: RegExp[];
  commitScopeAliases: string[];
  permissionModule: ModuleName | null;
  sensitiveModule: SensitiveAccessModuleName | null;
  hiddenFromVersionHistory?: boolean;
  excludeFromProductSummary?: boolean;
}

export interface ReleaseImpactInput {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface ReleaseImpactMatch {
  descriptor: ReleaseModuleDescriptor;
  fileCount: number;
  additions: number;
  deletions: number;
  score: number;
}

const DAILY_TASKS_AREA = 'Daily Tasks';

function routePattern(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:/|$)`, 'iu');
}

function apiPattern(value: string): RegExp {
  return new RegExp(`^app/api/${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:/|$)`, 'iu');
}

export const RELEASE_SUMMARY_EXCLUDE_PATTERNS: RegExp[] = [
  /^\.next(?:\/|$)/iu,
  /^test-results(?:\/|$)/iu,
  /^playwright-report(?:\/|$)/iu,
  /^blob-report(?:\/|$)/iu,
  /^coverage(?:\/|$)/iu,
  /^testsuite\/\.state(?:\/|$)/iu,
  /^testsuite\/reports(?:\/|$)/iu,
  /^docs_private\/automation(?:\/|$)/iu,
  /^agent-tools(?:\/|$)/iu,
  /^plans\/automation(?:\/|$)/iu,
  /^lib\/config\/release-version\.json$/iu,
  /^lib\/config\/release-history\.json$/iu,
  /^docs_private\/release-log\.md$/iu,
];

export const RELEASE_MODULE_DESCRIPTORS: ReleaseModuleDescriptor[] = [
  {
    id: 'debug',
    scope: 'debug',
    type: 'feat',
    category: 'hidden',
    clientFacingName: 'Debug Console',
    versionHistoryArea: 'Debug tools',
    subject: 'update debug tools',
    priority: 20,
    patterns: [routePattern('app/(dashboard)/debug'), apiPattern('debug'), /debug/iu],
    commitScopeAliases: ['debug', 'developer-tools'],
    permissionModule: null,
    sensitiveModule: 'debug',
  },
  {
    id: 'inventory',
    scope: 'inventory',
    type: 'feat',
    category: 'standard',
    clientFacingName: MODULE_DISPLAY_NAMES.inventory,
    versionHistoryArea: 'Inventory',
    subject: 'update inventory',
    priority: 30,
    patterns: [routePattern('app/(dashboard)/inventory'), apiPattern('inventory'), /inventory/iu],
    commitScopeAliases: ['inventory'],
    permissionModule: 'inventory',
    sensitiveModule: null,
  },
  {
    id: 'timesheets',
    scope: 'timesheets',
    type: 'feat',
    category: 'standard',
    clientFacingName: MODULE_DISPLAY_NAMES.timesheets,
    versionHistoryArea: 'Timesheets',
    subject: 'update timesheets',
    priority: 40,
    patterns: [routePattern('app/(dashboard)/timesheets'), apiPattern('timesheets'), /timesheets?/iu],
    commitScopeAliases: ['timesheets'],
    permissionModule: 'timesheets',
    sensitiveModule: null,
  },
  {
    id: 'daily-tasks',
    scope: 'daily-tasks',
    type: 'feat',
    category: 'standard',
    clientFacingName: DAILY_TASKS_AREA,
    versionHistoryArea: DAILY_TASKS_AREA,
    subject: 'update daily tasks',
    priority: 45,
    patterns: [
      routePattern('app/(dashboard)/van-inspections'),
      routePattern('app/(dashboard)/plant-inspections'),
      routePattern('app/(dashboard)/hgv-inspections'),
      apiPattern('van-inspections'),
      apiPattern('plant-inspections'),
      apiPattern('hgv-inspections'),
      apiPattern('inspection-photos'),
      /daily[-\s]?checks?/iu,
      /inspections?/iu,
    ],
    commitScopeAliases: ['inspections', 'van-inspections', 'plant-inspections', 'hgv-inspections', 'daily-tasks'],
    permissionModule: 'inspections',
    sensitiveModule: null,
  },
  {
    id: 'projects',
    scope: 'projects',
    type: 'feat',
    category: 'standard',
    clientFacingName: MODULE_DISPLAY_NAMES.rams,
    versionHistoryArea: 'Projects',
    subject: 'update projects',
    priority: 50,
    patterns: [routePattern('app/(dashboard)/projects'), routePattern('app/(dashboard)/rams'), apiPattern('projects'), apiPattern('rams'), /\brams\b/iu, /projects?/iu],
    commitScopeAliases: ['rams', 'projects'],
    permissionModule: 'rams',
    sensitiveModule: null,
  },
  {
    id: 'absence',
    scope: 'absence',
    type: 'feat',
    category: 'standard',
    clientFacingName: MODULE_DISPLAY_NAMES.absence,
    versionHistoryArea: 'Absence & Leave',
    subject: 'update absence and leave',
    priority: 55,
    patterns: [routePattern('app/(dashboard)/absence'), apiPattern('absence'), /absence/iu, /leave/iu],
    commitScopeAliases: ['absence', 'leave'],
    permissionModule: 'absence',
    sensitiveModule: null,
  },
  {
    id: 'maintenance',
    scope: 'maintenance',
    type: 'feat',
    category: 'standard',
    clientFacingName: MODULE_DISPLAY_NAMES.maintenance,
    versionHistoryArea: 'Maintenance',
    subject: 'update maintenance',
    priority: 60,
    patterns: [routePattern('app/(dashboard)/maintenance'), apiPattern('maintenance'), /maintenance/iu],
    commitScopeAliases: ['maintenance'],
    permissionModule: 'maintenance',
    sensitiveModule: null,
  },
  {
    id: 'workshop-tasks',
    scope: 'workshop-tasks',
    type: 'feat',
    category: 'standard',
    clientFacingName: MODULE_DISPLAY_NAMES['workshop-tasks'],
    versionHistoryArea: 'Workshop Tasks',
    subject: 'update workshop tasks',
    priority: 65,
    patterns: [routePattern('app/(dashboard)/workshop-tasks'), apiPattern('workshop-tasks'), /workshop/iu],
    commitScopeAliases: ['workshop', 'workshop-tasks'],
    permissionModule: 'workshop-tasks',
    sensitiveModule: null,
  },
  {
    id: 'fleet',
    scope: 'fleet',
    type: 'feat',
    category: 'standard',
    clientFacingName: 'Fleet',
    versionHistoryArea: 'Fleet',
    subject: 'update fleet',
    priority: 70,
    patterns: [routePattern('app/(dashboard)/fleet'), apiPattern('admin/vans'), apiPattern('admin/hgvs'), apiPattern('admin/plant'), /fleet/iu, /admin-vans/iu],
    commitScopeAliases: ['fleet', 'admin-vans'],
    permissionModule: 'admin-vans',
    sensitiveModule: null,
  },
  {
    id: 'reminders',
    scope: 'reminders',
    type: 'feat',
    category: 'standard',
    clientFacingName: MODULE_DISPLAY_NAMES.reminders,
    versionHistoryArea: 'Reminders',
    subject: 'update reminders',
    priority: 75,
    patterns: [routePattern('app/(dashboard)/reminders'), apiPattern('reminders'), /reminders?/iu],
    commitScopeAliases: ['reminders'],
    permissionModule: 'reminders',
    sensitiveModule: null,
  },
  {
    id: 'approvals',
    scope: 'approvals',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES.approvals,
    versionHistoryArea: 'Approvals',
    subject: 'update approvals',
    priority: 80,
    patterns: [routePattern('app/(dashboard)/approvals'), apiPattern('approvals'), /approvals?/iu],
    commitScopeAliases: ['approvals'],
    permissionModule: 'approvals',
    sensitiveModule: null,
  },
  {
    id: 'actions',
    scope: 'actions',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES.actions,
    versionHistoryArea: 'Actions',
    subject: 'update actions',
    priority: 85,
    patterns: [routePattern('app/(dashboard)/actions'), apiPattern('actions'), /actions?/iu],
    commitScopeAliases: ['actions'],
    permissionModule: 'actions',
    sensitiveModule: null,
  },
  {
    id: 'reports',
    scope: 'reports',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES.reports,
    versionHistoryArea: 'Reports',
    subject: 'update reports',
    priority: 90,
    patterns: [routePattern('app/(dashboard)/reports'), apiPattern('reports'), /reports?/iu],
    commitScopeAliases: ['reports'],
    permissionModule: 'reports',
    sensitiveModule: null,
  },
  {
    id: 'toolbox-talks',
    scope: 'toolbox-talks',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES['toolbox-talks'],
    versionHistoryArea: 'Toolbox Talks',
    subject: 'update toolbox talks',
    priority: 95,
    patterns: [routePattern('app/(dashboard)/toolbox-talks'), apiPattern('toolbox-talks'), /toolbox[-_ ]talks?/iu],
    commitScopeAliases: ['toolbox-talks', 'toolbox_talks'],
    permissionModule: 'toolbox-talks',
    sensitiveModule: null,
  },
  {
    id: 'training',
    scope: 'training',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES.training,
    versionHistoryArea: 'Training',
    subject: 'update training',
    priority: 100,
    patterns: [routePattern('app/(dashboard)/training'), apiPattern('training'), /training/iu],
    commitScopeAliases: ['training'],
    permissionModule: 'training',
    sensitiveModule: null,
  },
  {
    id: 'suggestions',
    scope: 'suggestions',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES.suggestions,
    versionHistoryArea: 'Suggestions',
    subject: 'update suggestions',
    priority: 105,
    patterns: [routePattern('app/(dashboard)/suggestions'), apiPattern('suggestions'), apiPattern('management/suggestions'), /suggestions?/iu],
    commitScopeAliases: ['suggestions'],
    permissionModule: 'suggestions',
    sensitiveModule: null,
  },
  {
    id: 'help',
    scope: 'help',
    type: 'docs',
    category: 'global',
    clientFacingName: 'Help and FAQ',
    versionHistoryArea: 'Help and FAQ',
    subject: 'update help and FAQ',
    priority: 110,
    patterns: [routePattern('app/(dashboard)/help'), routePattern('app/(dashboard)/admin/faq'), apiPattern('admin/faq'), /^docs\//iu, /faq/iu, /help/iu],
    commitScopeAliases: ['help', 'faq', 'faq-editor'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'error-reporting',
    scope: 'error-reports',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES['error-reports'],
    versionHistoryArea: 'Error reporting',
    subject: 'update error reporting',
    priority: 115,
    patterns: [routePattern('app/(dashboard)/admin/errors'), routePattern('app/(dashboard)/errors'), apiPattern('errors'), /error[-_ ]reports?/iu, /error[-_ ]logs?/iu],
    commitScopeAliases: ['errors', 'error-reports', 'logging'],
    permissionModule: 'error-reports',
    sensitiveModule: null,
  },
  {
    id: 'user-management',
    scope: 'admin-users',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES['admin-users'],
    versionHistoryArea: 'User Management',
    subject: 'update user management',
    priority: 120,
    patterns: [routePattern('app/(dashboard)/admin/users'), apiPattern('admin/users'), apiPattern('users'), /admin[-_ ]users/iu, /user[-_ ]management/iu],
    commitScopeAliases: ['admin-users', 'users'],
    permissionModule: 'admin-users',
    sensitiveModule: null,
  },
  {
    id: 'admin-settings',
    scope: 'admin-settings',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES['admin-settings'],
    versionHistoryArea: 'Admin Settings',
    subject: 'update admin settings',
    priority: 125,
    patterns: [routePattern('app/(dashboard)/admin/settings'), apiPattern('admin/settings'), /admin[-_ ]settings/iu],
    commitScopeAliases: ['admin-settings'],
    permissionModule: 'admin-settings',
    sensitiveModule: null,
  },
  {
    id: 'customers',
    scope: 'customers',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES.customers,
    versionHistoryArea: 'Customers',
    subject: 'update customers',
    priority: 130,
    patterns: [routePattern('app/(dashboard)/customers'), apiPattern('customers'), /customers?/iu],
    commitScopeAliases: ['customers'],
    permissionModule: 'customers',
    sensitiveModule: 'customers',
  },
  {
    id: 'quotes',
    scope: 'quotes',
    type: 'feat',
    category: 'management',
    clientFacingName: MODULE_DISPLAY_NAMES.quotes,
    versionHistoryArea: 'Quotes',
    subject: 'update quotes',
    priority: 135,
    patterns: [routePattern('app/(dashboard)/quotes'), apiPattern('quotes'), /quotes?/iu],
    commitScopeAliases: ['quotes'],
    permissionModule: 'quotes',
    sensitiveModule: 'quotes',
  },
  {
    id: 'dashboard',
    scope: 'dashboard',
    type: 'feat',
    category: 'global',
    clientFacingName: 'Dashboard',
    versionHistoryArea: 'Dashboard',
    subject: 'update dashboard',
    priority: 140,
    patterns: [routePattern('app/(dashboard)/dashboard')],
    commitScopeAliases: ['dashboard', 'app'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'profile',
    scope: 'profile',
    type: 'feat',
    category: 'global',
    clientFacingName: 'Profile',
    versionHistoryArea: 'Profile',
    subject: 'update profile',
    priority: 145,
    patterns: [routePattern('app/(dashboard)/profile'), apiPattern('profile'), /profile/iu],
    commitScopeAliases: ['profile'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'notifications',
    scope: 'notifications',
    type: 'feat',
    category: 'global',
    clientFacingName: 'Notifications',
    versionHistoryArea: 'Notifications',
    subject: 'update notifications',
    priority: 150,
    patterns: [routePattern('app/(dashboard)/notifications'), apiPattern('notifications'), apiPattern('messages'), /notifications?/iu, /messages?/iu],
    commitScopeAliases: ['notifications', 'messages'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'sign-in',
    scope: 'auth',
    type: 'fix',
    category: 'global',
    clientFacingName: 'Sign in',
    versionHistoryArea: 'Sign in',
    subject: 'update sign in',
    priority: 155,
    patterns: [routePattern('app/(auth)'), apiPattern('auth'), /auth/iu, /webauthn/iu, /sign[-_ ]?in/iu],
    commitScopeAliases: ['auth', 'sign-in'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'navigation',
    scope: 'layout',
    type: 'fix',
    category: 'global',
    clientFacingName: 'Navigation',
    versionHistoryArea: 'Navigation',
    subject: 'update navigation',
    priority: 160,
    patterns: [/^components\/layout\//iu, /^app\/globals\.css$/iu, /navigation/iu, /sidebar/iu, /layout/iu],
    commitScopeAliases: ['layout', 'navigation', 'mobile'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'pdf-documents',
    scope: 'pdf',
    type: 'feat',
    category: 'infrastructure',
    clientFacingName: 'PDF documents',
    versionHistoryArea: 'PDF documents',
    subject: 'update PDF documents',
    priority: 165,
    patterns: [/^lib\/pdf\//iu, /pdf/iu],
    commitScopeAliases: ['pdf'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'data-storage',
    scope: 'db',
    type: 'chore',
    category: 'infrastructure',
    clientFacingName: 'Data storage',
    versionHistoryArea: 'Data storage',
    subject: 'update data storage',
    priority: 170,
    patterns: [/^supabase\//iu, /^types\/database\.ts$/iu, /database/iu, /migration/iu],
    commitScopeAliases: ['db', 'database', 'data-storage'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'background-services',
    scope: 'api',
    type: 'feat',
    category: 'infrastructure',
    clientFacingName: 'Background services',
    versionHistoryArea: 'Background services',
    subject: 'update background services',
    priority: 180,
    patterns: [/^app\/api\//iu, /^lib\/server\//iu],
    commitScopeAliases: ['api', 'server', 'background-services'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'app-screens',
    scope: 'components',
    type: 'feat',
    category: 'infrastructure',
    clientFacingName: 'App screens',
    versionHistoryArea: 'App screens',
    subject: 'update app screens',
    priority: 190,
    patterns: [/^components\//iu, /^app\/\(dashboard\)\//iu],
    commitScopeAliases: ['components', 'ui'],
    permissionModule: null,
    sensitiveModule: null,
  },
  {
    id: 'release-automation',
    scope: 'finalise',
    type: 'chore',
    category: 'infrastructure',
    clientFacingName: 'Release automation',
    versionHistoryArea: 'Release automation',
    subject: 'update release automation',
    priority: 200,
    patterns: [/^scripts\/finalise(?:-|\.|$)/iu, /^scripts\/bump-release-version\.ts$/iu, /^scripts\/generate-release-history\.ts$/iu, /release-version/iu],
    commitScopeAliases: ['finalise', 'release', 'automation'],
    permissionModule: null,
    sensitiveModule: null,
    excludeFromProductSummary: true,
  },
  {
    id: 'app-reliability',
    scope: 'tests',
    type: 'test',
    category: 'test',
    clientFacingName: 'App reliability',
    versionHistoryArea: 'App reliability',
    subject: 'update app reliability',
    priority: 210,
    patterns: [/^tests\//iu, /^testsuite\//iu],
    commitScopeAliases: ['tests', 'test'],
    permissionModule: null,
    sensitiveModule: null,
    excludeFromProductSummary: true,
  },
];

export function normalizeReleasePath(relativePath: string): string {
  return relativePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

export function uniqueReleaseValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function shouldExcludeFromReleaseSummary(relativePath: string): boolean {
  const normalized = normalizeReleasePath(relativePath);
  return RELEASE_SUMMARY_EXCLUDE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getProductReleaseFiles(changedFiles: string[]): string[] {
  return uniqueReleaseValues(
    changedFiles
      .map(normalizeReleasePath)
      .filter((filePath) => filePath && !shouldExcludeFromReleaseSummary(filePath))
  );
}

export function getReleaseDescriptorByScope(scope: string | null | undefined): ReleaseModuleDescriptor | null {
  if (!scope) return null;
  const normalized = scope.toLowerCase();
  return RELEASE_MODULE_DESCRIPTORS.find((descriptor) =>
    descriptor.scope === normalized || descriptor.commitScopeAliases.includes(normalized)
  ) || null;
}

export function getReleaseDescriptorById(id: string | null | undefined): ReleaseModuleDescriptor | null {
  if (!id) return null;
  const normalized = id.toLowerCase();
  return RELEASE_MODULE_DESCRIPTORS.find((descriptor) => descriptor.id === normalized) || null;
}

export function getReleaseDescriptorByArea(area: string): ReleaseModuleDescriptor | null {
  const normalized = area.trim().toLowerCase();
  return RELEASE_MODULE_DESCRIPTORS.find((descriptor) =>
    descriptor.versionHistoryArea.toLowerCase() === normalized ||
    descriptor.clientFacingName.toLowerCase() === normalized
  ) || null;
}

export function getFriendlyReleaseScopeLabel(scope: string | null | undefined): string {
  const descriptor = getReleaseDescriptorByScope(scope);
  if (descriptor) return descriptor.versionHistoryArea;
  if (!scope) return 'App';

  return scope
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function getReleaseDescriptorMatches(inputs: ReleaseImpactInput[]): ReleaseImpactMatch[] {
  const normalizedInputs = inputs
    .map((input) => ({
      ...input,
      path: normalizeReleasePath(input.path),
      additions: input.additions ?? 0,
      deletions: input.deletions ?? 0,
    }))
    .filter((input) => input.path && !shouldExcludeFromReleaseSummary(input.path));

  const matches = RELEASE_MODULE_DESCRIPTORS.map((descriptor) => {
    const files = normalizedInputs.filter((input) =>
      descriptor.patterns.some((pattern) => pattern.test(input.path))
    );
    const additions = files.reduce((total, input) => total + (input.additions ?? 0), 0);
    const deletions = files.reduce((total, input) => total + (input.deletions ?? 0), 0);

    return {
      descriptor,
      fileCount: files.length,
      additions,
      deletions,
      score: files.length * 100 + additions + deletions,
    };
  }).filter((match) => match.fileCount > 0);

  return matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.fileCount !== left.fileCount) return right.fileCount - left.fileCount;
    return left.descriptor.priority - right.descriptor.priority;
  });
}

export function getReleaseAreasFromScopes(scopes: Array<string | null | undefined>): string[] {
  return uniqueReleaseValues(
    scopes
      .map((scope) => getReleaseDescriptorByScope(scope)?.versionHistoryArea)
      .filter((area): area is string => Boolean(area))
  );
}
