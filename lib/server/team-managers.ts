import type { SupabaseClient } from '@supabase/supabase-js';

export type HierarchyRoleClass = 'admin' | 'manager' | 'employee';
type SupabaseAdminClient = SupabaseClient;

import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';

interface ManagerProfileRow {
  id: string;
  full_name: string | null;
  employee_id?: string | null;
  is_placeholder?: boolean | null;
  role?: { role_class?: HierarchyRoleClass | null } | null;
}

interface TeamManagerRow {
  id: string;
  name: string;
  manager_1_profile_id?: string | null;
  manager_2_profile_id?: string | null;
}

interface ProfileHierarchyRow {
  id: string;
  full_name: string | null;
  team_id?: string | null;
  line_manager_id?: string | null;
  secondary_manager_id?: string | null;
  is_placeholder?: boolean | null;
  role?: { role_class?: HierarchyRoleClass | null } | null;
}

interface ReportingLineRow {
  id: string;
  manager_profile_id: string;
}

interface ManagerCandidate {
  id: string;
  full_name: string;
  employee_id?: string | null;
  is_placeholder: boolean;
  role_class: HierarchyRoleClass;
}

export interface TeamManagerSelection {
  manager_1_id?: string | null;
  manager_2_id?: string | null;
}

export interface TeamManagerOption {
  id: string;
  full_name: string;
  employee_id?: string | null;
  is_placeholder: boolean;
  role_class: HierarchyRoleClass;
}

export function isMissingTeamManagerSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';
  const isMissingObjectMessage = message.includes('does not exist');
  return (
    code === '42P01' ||
    code === '42703' ||
    (isMissingObjectMessage &&
      (
        message.includes('manager_1_profile_id') ||
        message.includes('manager_2_profile_id') ||
        message.includes('is_placeholder') ||
        message.includes('placeholder_key') ||
        message.includes('profile_reporting_lines') ||
        message.includes('org_teams') ||
        message.includes('column')
      ))
  );
}

export function getRoleClass(value: { role?: { role_class?: HierarchyRoleClass | null } | null }): HierarchyRoleClass {
  const roleClass = value.role?.role_class;
  if (roleClass === 'admin' || roleClass === 'manager' || roleClass === 'employee') {
    return roleClass;
  }
  return 'employee';
}

export function shouldClearOwnManagers(roleClass: HierarchyRoleClass): boolean {
  return roleClass === 'admin' || roleClass === 'manager';
}

export function deriveManagersFromTeam(
  roleClass: HierarchyRoleClass,
  teamManagers: TeamManagerSelection
): { manager_1_id: string | null; manager_2_id: string | null } {
  if (shouldClearOwnManagers(roleClass)) {
    return { manager_1_id: null, manager_2_id: null };
  }
  return {
    manager_1_id: teamManagers.manager_1_id || null,
    manager_2_id: teamManagers.manager_2_id || null,
  };
}

function toManagerCandidate(row: ManagerProfileRow): ManagerCandidate {
  return {
    id: row.id,
    full_name: row.full_name || 'Unknown',
    employee_id: row.employee_id || null,
    is_placeholder: row.is_placeholder === true,
    role_class: getRoleClass(row),
  };
}

function isEligibleManager(candidate: ManagerCandidate): boolean {
  return candidate.is_placeholder || candidate.role_class === 'manager' || candidate.role_class === 'admin';
}

export function formatManagerOptionLabel(option: TeamManagerOption): string {
  return option.is_placeholder ? `${option.full_name} (Placeholder)` : option.full_name;
}

export function buildTeamManagerOptionsFromProfiles(rows: ManagerProfileRow[]): TeamManagerOption[] {
  return rows
    .filter((row) => !isHiddenSystemTestAccountProfile(row))
    .map(toManagerCandidate)
    .filter(isEligibleManager)
    .map((row) => ({
      id: row.id,
      full_name: row.full_name,
      employee_id: row.employee_id,
      is_placeholder: row.is_placeholder,
      role_class: row.role_class,
    }));
}

async function loadManagerCandidates(
  supabaseAdmin: SupabaseAdminClient,
  managerIds: string[]
): Promise<Map<string, ManagerCandidate>> {
  if (managerIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, employee_id, is_placeholder, role:roles(role_class)')
    .in('id', managerIds);

  if (error) {
    throw error;
  }

  const rows = (data || []) as ManagerProfileRow[];
  return new Map(rows.map((row) => [row.id, toManagerCandidate(row)]));
}

export async function validateTeamManagerSelection(
  supabaseAdmin: SupabaseAdminClient,
  selection: TeamManagerSelection
): Promise<{ ok: boolean; error?: string; candidates: Map<string, ManagerCandidate> }> {
  const manager1Id = selection.manager_1_id || null;
  const manager2Id = selection.manager_2_id || null;

  if (manager1Id && manager2Id && manager1Id === manager2Id) {
    return {
      ok: false,
      error: 'Manager 1 and Manager 2 must be different users.',
      candidates: new Map(),
    };
  }

  const uniqueIds = Array.from(new Set([manager1Id, manager2Id].filter(Boolean) as string[]));
  const candidates = await loadManagerCandidates(supabaseAdmin, uniqueIds);

  for (const [slotLabel, managerId] of [
    ['Manager 1', manager1Id],
    ['Manager 2', manager2Id],
  ] as const) {
    if (!managerId) continue;
    const candidate = candidates.get(managerId);
    if (!candidate) {
      return { ok: false, error: `${slotLabel} does not exist.`, candidates };
    }
    if (!isEligibleManager(candidate)) {
      return {
        ok: false,
        error: `${slotLabel} must have a manager/admin role or be a placeholder manager.`,
        candidates,
      };
    }
  }

  return { ok: true, candidates };
}

async function updateReportingLine(
  supabaseAdmin: SupabaseAdminClient,
  profileId: string,
  relationType: 'primary' | 'secondary',
  managerProfileId: string | null
) {
  const { data, error } = await supabaseAdmin
    .from('profile_reporting_lines')
    .select('id, manager_profile_id')
    .eq('profile_id', profileId)
    .eq('relation_type', relationType)
    .is('valid_to', null);

  if (error) {
    throw error;
  }

  const activeRows = (data || []) as ReportingLineRow[];
  const staleIds = activeRows
    .filter((row) => !managerProfileId || row.manager_profile_id !== managerProfileId)
    .map((row) => row.id);

  if (staleIds.length > 0) {
    const { error: staleError } = await supabaseAdmin
      .from('profile_reporting_lines')
      .update({ valid_to: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in('id', staleIds);

    if (staleError) {
      throw staleError;
    }
  }

  if (!managerProfileId) {
    return;
  }

  const hasMatchingActiveRow = activeRows.some((row) => row.manager_profile_id === managerProfileId);
  if (hasMatchingActiveRow) {
    return;
  }

  const { error: insertError } = await supabaseAdmin.from('profile_reporting_lines').insert({
    profile_id: profileId,
    manager_profile_id: managerProfileId,
    relation_type: relationType,
    valid_from: new Date().toISOString(),
  });

  if (insertError) {
    throw insertError;
  }
}

async function persistDerivedManagers(
  supabaseAdmin: SupabaseAdminClient,
  profile: ProfileHierarchyRow,
  nextManagers: { manager_1_id: string | null; manager_2_id: string | null }
) {
  if (
    (profile.line_manager_id || null) !== nextManagers.manager_1_id ||
    (profile.secondary_manager_id || null) !== nextManagers.manager_2_id
  ) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        line_manager_id: nextManagers.manager_1_id,
        secondary_manager_id: nextManagers.manager_2_id,
      })
      .eq('id', profile.id);

    if (error) {
      throw error;
    }
  }

  await updateReportingLine(supabaseAdmin, profile.id, 'primary', nextManagers.manager_1_id);
  await updateReportingLine(supabaseAdmin, profile.id, 'secondary', nextManagers.manager_2_id);
}

export async function getTeamManagerOptions(
  supabaseAdmin: SupabaseAdminClient
): Promise<TeamManagerOption[]> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, employee_id, is_placeholder, role:roles(role_class)')
    .order('full_name', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data || []) as ManagerProfileRow[];
  return buildTeamManagerOptionsFromProfiles(rows);
}

export async function reconcileTeamManagerAssignments(
  supabaseAdmin: SupabaseAdminClient,
  teamId: string
) {
  const { data: teamRow, error: teamError } = await supabaseAdmin
    .from('org_teams')
    .select('id, name, manager_1_profile_id, manager_2_profile_id')
    .eq('id', teamId)
    .single();

  if (teamError) {
    throw teamError;
  }

  const team = teamRow as TeamManagerRow;
  const managerSelection = {
    manager_1_id: team.manager_1_profile_id || null,
    manager_2_id: team.manager_2_profile_id || null,
  };

  const validation = await validateTeamManagerSelection(supabaseAdmin, managerSelection);
  if (!validation.ok) {
    throw new Error(validation.error || 'Invalid team manager selection');
  }

  const { data: profilesData, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, team_id, line_manager_id, secondary_manager_id, is_placeholder, role:roles(role_class)')
    .eq('team_id', teamId);

  if (profilesError) {
    throw profilesError;
  }

  const profiles = (profilesData || []) as ProfileHierarchyRow[];
  for (const profile of profiles) {
    const roleClass = getRoleClass(profile);
    const derivedManagers = deriveManagersFromTeam(roleClass, managerSelection);
    await persistDerivedManagers(supabaseAdmin, profile, derivedManagers);
  }
}

export async function reconcileProfileHierarchy(
  supabaseAdmin: SupabaseAdminClient,
  profileId: string
): Promise<{ affected_team_ids: string[] }> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, team_id, line_manager_id, secondary_manager_id, is_placeholder, role:roles(role_class)')
    .eq('id', profileId)
    .single();

  if (error) {
    throw error;
  }

  const profile = data as ProfileHierarchyRow;
  const roleClass = getRoleClass(profile);
  const affectedTeamIds = new Set<string>();

  if (roleClass === 'employee') {
    const { data: updatedTeams, error: clearRoleError } = await supabaseAdmin
      .from('org_teams')
      .update({
        manager_1_profile_id: null,
      })
      .eq('manager_1_profile_id', profileId)
      .select('id');

    if (clearRoleError && !String(clearRoleError.message || '').includes('Results contain 0 rows')) {
      throw clearRoleError;
    }

    const { data: updatedTeams2, error: clearRoleError2 } = await supabaseAdmin
      .from('org_teams')
      .update({
        manager_2_profile_id: null,
      })
      .eq('manager_2_profile_id', profileId)
      .select('id');

    if (clearRoleError2 && !String(clearRoleError2.message || '').includes('Results contain 0 rows')) {
      throw clearRoleError2;
    }

    ((updatedTeams || []) as Array<{ id: string }>).forEach((team) => affectedTeamIds.add(team.id));
    ((updatedTeams2 || []) as Array<{ id: string }>).forEach((team) => affectedTeamIds.add(team.id));
  }

  let teamManagerSelection: TeamManagerSelection = {};
  if (profile.team_id) {
    const { data: teamData, error: teamError } = await supabaseAdmin
      .from('org_teams')
      .select('manager_1_profile_id, manager_2_profile_id')
      .eq('id', profile.team_id)
      .single();

    if (teamError) {
      throw teamError;
    }

    teamManagerSelection = {
      manager_1_id: (teamData as TeamManagerSelection).manager_1_id || (teamData as { manager_1_profile_id?: string | null }).manager_1_profile_id || null,
      manager_2_id: (teamData as TeamManagerSelection).manager_2_id || (teamData as { manager_2_profile_id?: string | null }).manager_2_profile_id || null,
    };
  }

  const derivedManagers = deriveManagersFromTeam(roleClass, teamManagerSelection);
  await persistDerivedManagers(supabaseAdmin, profile, derivedManagers);

  for (const teamId of affectedTeamIds) {
    await reconcileTeamManagerAssignments(supabaseAdmin, teamId);
  }

  return { affected_team_ids: Array.from(affectedTeamIds) };
}
