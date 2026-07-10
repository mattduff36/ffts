import { describe, expect, it } from 'vitest';
import {
  buildTeamPermissionRecord,
  buildUserPermissionLevelRecord,
  getAdjacentTierRole,
  getPermissionLevelsForUser,
  getPermissionMapForUser,
  getPermissionSetForUser,
  getUsersWithModuleAccess,
  isFullAccessRole,
  normalizePermissionAccessLevel,
  resolveModulesForRoleRank,
} from '@/lib/server/team-permissions';
import { ALL_MODULES, type PermissionModuleMatrixColumn, type PermissionTierRole } from '@/types/roles';

const roles: PermissionTierRole[] = [
  {
    id: 'contractor',
    name: 'contractor',
    display_name: 'Contractor',
    role_class: 'employee',
    hierarchy_rank: 1,
    is_super_admin: false,
    is_manager_admin: false,
  },
  {
    id: 'employee',
    name: 'employee',
    display_name: 'Employee',
    role_class: 'employee',
    hierarchy_rank: 2,
    is_super_admin: false,
    is_manager_admin: false,
  },
  {
    id: 'supervisor',
    name: 'supervisor',
    display_name: 'Supervisor',
    role_class: 'employee',
    hierarchy_rank: 3,
    is_super_admin: false,
    is_manager_admin: false,
  },
  {
    id: 'manager',
    name: 'manager',
    display_name: 'Manager',
    role_class: 'manager',
    hierarchy_rank: 4,
    is_super_admin: false,
    is_manager_admin: true,
  },
];

const modules: PermissionModuleMatrixColumn[] = [
  {
    module_name: 'inspections',
    display_name: 'Van Daily Checks',
    short_name: 'Van Checks',
    description: 'Perform van daily checks',
    color_var: '--inspection-primary',
    minimum_role_id: 'contractor',
    minimum_role_name: 'Contractor',
    minimum_hierarchy_rank: 1,
    enforced_minimum_access_level: 1,
    requires_full_access_role: false,
    requires_sensitive_pin: false,
    sort_order: 10,
  },
  {
    module_name: 'timesheets',
    display_name: 'Timesheets',
    short_name: 'Timesheets',
    description: 'Create and submit timesheets',
    color_var: '--timesheet-primary',
    minimum_role_id: 'employee',
    minimum_role_name: 'Employee',
    minimum_hierarchy_rank: 2,
    enforced_minimum_access_level: 2,
    requires_full_access_role: false,
    requires_sensitive_pin: false,
    sort_order: 20,
  },
  {
    module_name: 'approvals',
    display_name: 'Approvals',
    short_name: 'Approvals',
    description: 'Approve workflow items',
    color_var: '--brand-yellow',
    minimum_role_id: 'supervisor',
    minimum_role_name: 'Supervisor',
    minimum_hierarchy_rank: 3,
    enforced_minimum_access_level: 3,
    requires_full_access_role: false,
    requires_sensitive_pin: false,
    sort_order: 30,
  },
  {
    module_name: 'admin-users',
    display_name: 'User Management',
    short_name: 'Users',
    description: 'Manage user accounts',
    color_var: '--brand-yellow',
    minimum_role_id: 'manager',
    minimum_role_name: 'Manager',
    minimum_hierarchy_rank: 4,
    enforced_minimum_access_level: 4,
    requires_full_access_role: false,
    requires_sensitive_pin: false,
    sort_order: 40,
  },
];

describe('team permission helpers', () => {
  it('builds a permission record for a team row', () => {
    const record = buildTeamPermissionRecord(
      modules,
      new Map([
        ['inspections', true],
        ['timesheets', false],
      ])
    );

    expect(record.inspections).toBe(true);
    expect(record.timesheets).toBe(false);
    expect(record['admin-users']).toBe(false);
  });

  it('resolves inherited access by hierarchy rank', () => {
    const enabledByModule = new Map([
      ['inspections', true],
      ['timesheets', true],
      ['approvals', true],
      ['admin-users', true],
    ]);

    expect(
      Array.from(
        resolveModulesForRoleRank({
          role: { name: 'contractor', is_super_admin: false, hierarchy_rank: 1 },
          modules,
          enabledByModule,
        })
      )
    ).toEqual(['inspections']);

    expect(
      Array.from(
        resolveModulesForRoleRank({
          role: { name: 'employee', is_super_admin: false, hierarchy_rank: 2 },
          modules,
          enabledByModule,
        })
      )
    ).toEqual(['inspections', 'timesheets']);

    expect(
      Array.from(
        resolveModulesForRoleRank({
          role: { name: 'manager', is_super_admin: false, hierarchy_rank: 4 },
          modules,
          enabledByModule,
        })
      )
    ).toEqual(['inspections', 'timesheets', 'approvals', 'admin-users']);
  });

  it('treats admins as full access', () => {
    expect(isFullAccessRole({ name: 'admin', is_super_admin: false })).toBe(true);
    expect(
      resolveModulesForRoleRank({
        role: { name: 'admin', is_super_admin: false, hierarchy_rank: 999 },
        modules,
        enabledByModule: new Map(),
      }).size
    ).toBeGreaterThan(modules.length);
  });

  it('normalizes invalid user permission levels to no access', () => {
    expect(normalizePermissionAccessLevel(5)).toBe(5);
    expect(normalizePermissionAccessLevel(3)).toBe(3);
    expect(normalizePermissionAccessLevel(999)).toBe(0);
    expect(normalizePermissionAccessLevel(null)).toBe(0);
  });

  it('builds user permission records with universal reminders access', () => {
    const record = buildUserPermissionLevelRecord(
      modules.filter((module) => module.module_name !== 'reminders'),
      new Map([['timesheets', 2]])
    );

    expect(record.timesheets).toBe(2);
    expect(record.reminders).toBe(5);
  });

  it('preserves full access for admin users without a team assignment', async () => {
    const supabaseAdmin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'admin-1', team_id: null, role_id: 'admin-role' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'roles') {
          const roleRows = [
            ...roles,
            {
              id: 'admin-role',
              name: 'admin',
              display_name: 'Admin',
              role_class: 'admin',
              hierarchy_rank: 999,
              is_super_admin: false,
              is_manager_admin: true,
            },
          ];
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: roleRows.find((role) => role.id === 'admin-role'),
                  error: null,
                }),
              }),
              not: () => ({
                order: () => ({
                  order: async () => ({ data: roleRows, error: null }),
                }),
              }),
            }),
          };
        }

        if (table === 'permission_modules') {
          return {
            select: () => ({
              order: async () => ({
                data: modules.map((module) => ({
                  module_name: module.module_name,
                  minimum_role_id: module.minimum_role_id,
                  requires_sensitive_pin: false,
                  sort_order: module.sort_order,
                })),
                error: null,
              }),
            }),
          };
        }

        if (table === 'team_module_permissions') {
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          };
        }

        if (table === 'user_module_permissions') {
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      },
    };

    const permissionSet = await getPermissionSetForUser('admin-1', null, supabaseAdmin);

    expect(permissionSet).toEqual(new Set(ALL_MODULES));
  });

  it('lets user-level permissions override inherited team access', async () => {
    const supabaseAdmin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'employee-1', team_id: 'team-a', role_id: 'employee' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'roles') {
          const roleRows = [
            {
              id: 'contractor',
              name: 'contractor',
              display_name: 'Contractor',
              role_class: 'employee',
              hierarchy_rank: 1,
              is_super_admin: false,
              is_manager_admin: false,
            },
            {
              id: 'employee',
              name: 'employee',
              display_name: 'Employee',
              role_class: 'employee',
              hierarchy_rank: 2,
              is_super_admin: false,
              is_manager_admin: false,
            },
            {
              id: 'supervisor',
              name: 'supervisor',
              display_name: 'Supervisor',
              role_class: 'employee',
              hierarchy_rank: 3,
              is_super_admin: false,
              is_manager_admin: false,
            },
            {
              id: 'manager',
              name: 'manager',
              display_name: 'Manager',
              role_class: 'manager',
              hierarchy_rank: 4,
              is_super_admin: false,
              is_manager_admin: true,
            },
          ];
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: roleRows.find((role) => role.id === 'employee'),
                  error: null,
                }),
              }),
              not: () => ({
                order: () => ({
                  order: async () => ({ data: roleRows, error: null }),
                }),
              }),
            }),
          };
        }

        if (table === 'permission_modules') {
          return {
            select: () => ({
              order: async () => ({
                data: modules.map((module) => ({
                  module_name: module.module_name,
                  minimum_role_id: module.minimum_role_id,
                  requires_sensitive_pin: false,
                  sort_order: module.sort_order,
                })),
                error: null,
              }),
            }),
          };
        }

        if (table === 'team_module_permissions') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { module_name: 'timesheets', enabled: true },
                  { module_name: 'approvals', enabled: true },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'user_module_permissions') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { module_name: 'timesheets', access_level: 3 },
                  { module_name: 'approvals', access_level: 0 },
                ],
                error: null,
              }),
            }),
          };
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      },
    };

    const levels = await getPermissionLevelsForUser('employee-1', null, supabaseAdmin as never);

    expect(levels.timesheets).toBe(3);
    expect(levels.approvals).toBe(0);
    expect(levels.reminders).toBe(5);
  });

  it('reports reminders as universal even when no role or matrix row grants access', async () => {
    const supabaseAdmin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'employee-1', team_id: null, role_id: null },
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      },
    };

    const levels = await getPermissionLevelsForUser('employee-1', null, supabaseAdmin as never);
    const permissionMap = await getPermissionMapForUser('employee-1', null, supabaseAdmin as never);

    expect(levels.reminders).toBe(5);
    expect(levels.timesheets).toBe(0);
    expect(permissionMap.reminders).toBe(true);
    expect(permissionMap.timesheets).toBe(false);
  });

  it('ignores notification-only module keys when resolving permission modules', async () => {
    const permissionModules = [
      { module_name: 'training', minimum_role_id: 'manager', requires_sensitive_pin: false, sort_order: 50 },
      {
        module_name: 'processed_absence',
        minimum_role_id: 'missing-notification-role',
        requires_sensitive_pin: false,
        sort_order: 51,
      },
    ];
    const supabaseAdmin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'employee-1', team_id: 'team-a', role_id: 'employee' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'roles') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: roles.find((role) => role.id === 'employee'),
                  error: null,
                }),
              }),
              not: () => ({
                order: () => ({
                  order: async () => ({ data: roles, error: null }),
                }),
              }),
            }),
          };
        }

        if (table === 'permission_modules') {
          return {
            select: () => ({
              order: async () => ({ data: permissionModules, error: null }),
            }),
          };
        }

        if (table === 'team_module_permissions') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { team_id: 'team-a', module_name: 'training', enabled: true },
                  { team_id: 'team-a', module_name: 'processed_absence', enabled: true },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'user_module_permissions') {
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      },
    };

    const levels = await getPermissionLevelsForUser('employee-1', null, supabaseAdmin as never);

    expect(levels.training).toBe(0);
    expect(levels.reminders).toBe(5);
    expect(Object.hasOwn(levels, 'processed_absence')).toBe(false);
  });

  it('moves modules between adjacent tier roles', () => {
    expect(getAdjacentTierRole(roles, 'employee', 'left')?.name).toBe('contractor');
    expect(getAdjacentTierRole(roles, 'employee', 'right')?.name).toBe('supervisor');
    expect(getAdjacentTierRole(roles, 'contractor', 'left')).toBeNull();
    expect(getAdjacentTierRole(roles, 'manager', 'right')).toBeNull();
  });

  it('bulk resolves users with module access without per-user recalculation', async () => {
    const profiles = [
      { id: 'admin-1', team_id: null, role_id: 'admin-role' },
      { id: 'employee-1', team_id: 'team-a', role_id: 'employee-role' },
      { id: 'employee-2', team_id: 'team-b', role_id: 'employee-role' },
      { id: 'contractor-1', team_id: 'team-a', role_id: 'contractor-role' },
    ];
    const rolesData = [
      {
        id: 'contractor-role',
        name: 'contractor',
        display_name: 'Contractor',
        role_class: 'employee',
        hierarchy_rank: 1,
        is_super_admin: false,
        is_manager_admin: false,
      },
      {
        id: 'employee-role',
        name: 'employee',
        display_name: 'Employee',
        role_class: 'employee',
        hierarchy_rank: 2,
        is_super_admin: false,
        is_manager_admin: false,
      },
      {
        id: 'admin-role',
        name: 'admin',
        display_name: 'Admin',
        role_class: 'admin',
        hierarchy_rank: 999,
        is_super_admin: false,
        is_manager_admin: true,
      },
    ];
    const permissionModules = [
      { module_name: 'timesheets', minimum_role_id: 'employee-role', sort_order: 10 },
    ];
    const teamPermissions = [
      { team_id: 'team-a', module_name: 'timesheets', enabled: true },
      { team_id: 'team-b', module_name: 'timesheets', enabled: false },
    ];

    const supabaseAdmin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              in: async () => ({ data: profiles, error: null }),
            }),
          };
        }

        if (table === 'roles') {
          const directResult = Promise.resolve({ data: rolesData, error: null }) as Promise<{
            data: typeof rolesData;
            error: null;
          }> & {
            not: () => {
              order: () => {
                order: () => Promise<{ data: typeof rolesData; error: null }>;
              };
            };
          };
          directResult.not = () => ({
            order: () => ({
              order: async () => ({ data: rolesData, error: null }),
            }),
          });

          return {
            select: () => directResult,
          };
        }

        if (table === 'permission_modules') {
          return {
            select: () => ({
              order: async () => ({ data: permissionModules, error: null }),
            }),
          };
        }

        if (table === 'team_module_permissions') {
          return {
            select: () => ({
              in: async () => ({ data: teamPermissions, error: null }),
            }),
          };
        }

        if (table === 'user_module_permissions') {
          return {
            select: () => ({
              in: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      },
    };

    const allowedUsers = await getUsersWithModuleAccess(
      'timesheets',
      profiles.map((profile) => profile.id),
      supabaseAdmin as never
    );

    expect(allowedUsers).toEqual(new Set(['admin-1', 'employee-1']));
  });

  it('returns all real visible users for universal reminders access without matrix checks', async () => {
    const profiles = [
      { id: 'employee-1', team_id: 'team-a', role_id: null, full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'employee-2', team_id: null, role_id: null, full_name: 'Blake Baker', employee_id: 'E002' },
      { id: 'deleted-1', team_id: null, role_id: null, full_name: 'Pat Placeholder (Deleted User)', employee_id: 'E003' },
      { id: 'hidden-1', team_id: null, role_id: null, full_name: 'Test Employee', employee_id: 'TS-EMP' },
    ];

    const supabaseAdmin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              in: async () => ({ data: profiles, error: null }),
            }),
          };
        }

        throw new Error(`Universal reminders access should not query ${table}`);
      },
    };

    const allowedUsers = await getUsersWithModuleAccess(
      'reminders',
      profiles.map((profile) => profile.id),
      supabaseAdmin as never
    );

    expect(allowedUsers).toEqual(new Set(['employee-1', 'employee-2']));
  });
});
