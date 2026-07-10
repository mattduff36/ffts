export type TeamLineManagerDefinition = {
  teamId: string;
  teamName: string;
  primaryManagerName: string;
  secondaryManagerName?: string;
  testOnly?: boolean;
};

export type TeamLineManagerCandidate = {
  id: string;
  full_name: string | null;
  is_placeholder?: boolean | null;
};

export const TEAM_LINE_MANAGERS: TeamLineManagerDefinition[] = [
  {
    teamId: 'accounts',
    teamName: 'Accounts',
    primaryManagerName: 'Example User Four',
  },
  {
    teamId: 'plant',
    teamName: 'Plant',
    primaryManagerName: 'Example User Five',
  },
  {
    teamId: 'transport',
    teamName: 'Transport',
    primaryManagerName: 'Example User Six',
  },
  {
    teamId: 'workshop',
    teamName: 'Workshop',
    // The organogram label maps to this system profile.
    primaryManagerName: 'Example User Seven',
  },
  {
    teamId: 'sheq',
    teamName: 'SHEQ',
    primaryManagerName: 'Example User Three',
  },
  {
    teamId: 'civils',
    teamName: 'Civils',
    primaryManagerName: 'Example User One',
    secondaryManagerName: 'Example User Two',
  },
  {
    teamId: 'test',
    teamName: 'TestTeam',
    primaryManagerName: 'Testsuite Manager',
    testOnly: true,
  },
];

export function normalizeManagerName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getTeamLineManagers(options?: {
  includeTestTeams?: boolean;
}): TeamLineManagerDefinition[] {
  if (options?.includeTestTeams) {
    return TEAM_LINE_MANAGERS;
  }
  return TEAM_LINE_MANAGERS.filter((team) => team.testOnly !== true);
}

export function resolveTeamLineManagerCandidate(
  candidates: TeamLineManagerCandidate[],
  managerName: string
): TeamLineManagerCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const nonPlaceholderCandidates = candidates.filter((candidate) => candidate.is_placeholder !== true);
  if (nonPlaceholderCandidates.length === 1) {
    return nonPlaceholderCandidates[0];
  }
  if (nonPlaceholderCandidates.length > 1) {
    throw new Error(`Multiple non-placeholder profiles found for manager: ${managerName}`);
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  throw new Error(`Multiple placeholder profiles found for manager: ${managerName}`);
}
