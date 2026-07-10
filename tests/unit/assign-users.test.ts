import { describe, expect, it } from 'vitest';
import {
  buildAssignUsersTeamOptions,
  canBulkSelectAssignUser,
  getAssignUsersBulkIds,
  isAssignUsersSuperAdmin,
  type AssignUsersUser,
} from '@/lib/utils/assign-users';

function buildUser(overrides: Partial<AssignUsersUser> = {}): AssignUsersUser {
  return {
    id: 'user-1',
    full_name: 'Test User',
    employee_id: 'EMP001',
    team: {
      id: 'team-1',
      name: 'Team One',
    },
    role: {
      name: 'employee',
      display_name: 'Employee',
      is_super_admin: false,
    },
    hasModuleAccess: true,
    isLocked: false,
    super_admin: false,
    ...overrides,
  };
}

describe('assign-users helpers', () => {
  it('detects superadmins from profile or role flags', () => {
    expect(isAssignUsersSuperAdmin(buildUser({ super_admin: true }))).toBe(true);
    expect(isAssignUsersSuperAdmin(buildUser({ role: { is_super_admin: true } }))).toBe(true);
    expect(isAssignUsersSuperAdmin(buildUser())).toBe(false);
  });

  it('excludes superadmins, locked users, and no-access users from bulk selection', () => {
    expect(canBulkSelectAssignUser(buildUser())).toBe(true);
    expect(canBulkSelectAssignUser(buildUser({ super_admin: true }))).toBe(false);
    expect(canBulkSelectAssignUser(buildUser({ isLocked: true }))).toBe(false);
    expect(canBulkSelectAssignUser(buildUser({ hasModuleAccess: false }))).toBe(false);
  });

  it('builds team bulk IDs without superadmins while keeping them visible for manual selection', () => {
    const users = [
      buildUser({ id: 'employee-1' }),
      buildUser({ id: 'superadmin-1', super_admin: true }),
      buildUser({ id: 'employee-2', team: { id: 'team-2', name: 'Team Two' } }),
    ];

    expect(getAssignUsersBulkIds(users)).toEqual(['employee-1', 'employee-2']);
    expect(getAssignUsersBulkIds(users, 'team-1')).toEqual(['employee-1']);
    expect(buildAssignUsersTeamOptions(users)).toEqual([
      {
        id: 'team-1',
        name: 'Team One',
        selectableUserIds: ['employee-1'],
      },
      {
        id: 'team-2',
        name: 'Team Two',
        selectableUserIds: ['employee-2'],
      },
    ]);
  });
});
