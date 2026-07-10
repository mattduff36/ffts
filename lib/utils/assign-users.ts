export interface AssignUsersRole {
  name?: string | null;
  display_name?: string | null;
  is_super_admin?: boolean | null;
}

export interface AssignUsersTeam {
  id?: string | null;
  name?: string | null;
}

export interface AssignUsersUser {
  id: string;
  full_name: string | null;
  employee_id?: string | null;
  team?: AssignUsersTeam | null;
  role?: AssignUsersRole | null;
  hasModuleAccess?: boolean;
  isLocked?: boolean;
  lockedMessage?: string;
  super_admin?: boolean | null;
}

export interface AssignUsersTeamOption {
  id: string;
  name: string;
  selectableUserIds: string[];
}

export function isAssignUsersSuperAdmin(user: AssignUsersUser): boolean {
  return user.super_admin === true || user.role?.is_super_admin === true;
}

export function canBulkSelectAssignUser(user: AssignUsersUser): boolean {
  return user.hasModuleAccess !== false && user.isLocked !== true && !isAssignUsersSuperAdmin(user);
}

export function buildAssignUsersTeamOptions(users: AssignUsersUser[]): AssignUsersTeamOption[] {
  const teams = new Map<string, AssignUsersTeamOption>();

  users.forEach((user) => {
    if (!user.team?.id) return;

    const existingTeam = teams.get(user.team.id);
    if (existingTeam) {
      if (canBulkSelectAssignUser(user)) {
        existingTeam.selectableUserIds.push(user.id);
      }
      return;
    }

    teams.set(user.team.id, {
      id: user.team.id,
      name: user.team.name || user.team.id,
      selectableUserIds: canBulkSelectAssignUser(user) ? [user.id] : [],
    });
  });

  return Array.from(teams.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getAssignUsersBulkIds(users: AssignUsersUser[], teamId?: string): string[] {
  return users
    .filter((user) => (teamId ? user.team?.id === teamId : Boolean(user.team?.id)))
    .filter(canBulkSelectAssignUser)
    .map((user) => user.id);
}
