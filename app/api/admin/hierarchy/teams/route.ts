import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  buildTeamManagerOptionsFromProfiles,
  formatManagerOptionLabel,
  isMissingTeamManagerSchemaError,
  reconcileTeamManagerAssignments,
  validateTeamManagerSelection,
} from '@/lib/server/team-managers';
import { ensureTeamPermissionRows } from '@/lib/server/team-permissions';
import { filterHiddenSystemTestAccounts } from '@/lib/utils/system-test-accounts';

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function isMissingHierarchySchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';
  const isMissingObjectMessage = message.includes('does not exist');
  return (
    code === '42P01' ||
    code === '42703' ||
    (isMissingObjectMessage &&
      (
        message.includes('team_id') ||
        message.includes('line_manager_id') ||
        message.includes('column')
      ))
  );
}

const VALID_TIMESHEET_TYPES = new Set(['civils', 'plant']);

function parseTimesheetType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized;
}

export async function GET() {
  const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
  if (sensitiveAccessResponse) return sensitiveAccessResponse;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: teamsData, error: teamsError } = await supabaseAdmin
    .from('org_teams')
    .select('id, name, code, timesheet_type, active, manager_1_profile_id, manager_2_profile_id')
    .eq('active', true)
    .order('name', { ascending: true });

  if (teamsError) {
    if (isMissingHierarchySchemaError(teamsError) || isMissingTeamManagerSchemaError(teamsError)) {
      return NextResponse.json({
        configured: false,
        teams: [],
        warning: 'Hierarchy columns are not available yet.',
      });
    }
    return NextResponse.json({ error: 'Failed to load teams' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(`
      id,
      full_name,
      employee_id,
      is_placeholder,
      team_id,
      line_manager_id,
      role:roles(role_class)
    `);

  if (error) {
    if (isMissingHierarchySchemaError(error)) {
      return NextResponse.json({
        configured: false,
        teams: [],
        warning: 'Hierarchy columns are not available yet.',
      });
    }
    return NextResponse.json({ error: 'Failed to load teams' }, { status: 500 });
  }

  const rows = filterHiddenSystemTestAccounts(((data || []) as Array<{
    id: string;
    full_name?: string | null;
    employee_id?: string | null;
    is_placeholder?: boolean | null;
    team_id?: string | null;
    line_manager_id?: string | null;
    role?: { role_class?: 'admin' | 'manager' | 'employee' } | null;
  }>).map((row) => ({
    id: row.id,
    full_name: row.full_name ?? null,
    employee_id: row.employee_id ?? null,
    is_placeholder: row.is_placeholder ?? null,
    team_id: row.team_id ?? null,
    line_manager_id: row.line_manager_id ?? null,
    role: row.role ?? null,
  })));

  const teamStats = new Map<string, {
    team_id: string;
    member_count: number;
    manager_count: number;
    without_manager_count: number;
  }>();

  const knownTeams = (teamsData || []) as Array<{
    id: string;
    name: string;
    code: string | null;
    timesheet_type?: string | null;
    active: boolean;
    manager_1_profile_id?: string | null;
    manager_2_profile_id?: string | null;
  }>;

  const managerOptions = buildTeamManagerOptionsFromProfiles(rows);

  const managerById = new Map(managerOptions.map((manager) => [manager.id, manager]));
  const knownTeamsById = new Map(knownTeams.map((team) => [team.id, team]));

  for (const team of knownTeams) {
    teamStats.set(team.id, {
      team_id: team.id,
      member_count: 0,
      manager_count: 0,
      without_manager_count: 0,
    });
  }

  rows.forEach((row) => {
    if (!row.team_id || !teamStats.has(row.team_id)) {
      return;
    }
    const existing = teamStats.get(row.team_id);
    if (!existing) return;
    existing.member_count += 1;
    if (row.role?.role_class === 'manager') {
      existing.manager_count += 1;
    }
    if (!row.line_manager_id && row.role?.role_class !== 'admin' && row.role?.role_class !== 'manager') {
      existing.without_manager_count += 1;
    }
    teamStats.set(row.team_id, existing);
  });

  const teams = Array.from(teamStats.values())
    .sort((a, b) => a.team_id.localeCompare(b.team_id))
    .map((team) => {
      const teamRow = knownTeamsById.get(team.team_id);
      const manager1Id = teamRow?.manager_1_profile_id || null;
      const manager2Id = teamRow?.manager_2_profile_id || null;
      const manager1 = manager1Id ? managerById.get(manager1Id) : null;
      const manager2 = manager2Id ? managerById.get(manager2Id) : null;

      return {
        ...team,
        id: team.team_id,
        name: teamRow?.name || team.team_id,
        code: teamRow?.code || null,
        timesheet_type: teamRow?.timesheet_type || 'civils',
        active: teamRow?.active ?? true,
        manager_1_id: manager1Id,
        manager_2_id: manager2Id,
        manager_1_name: manager1 ? formatManagerOptionLabel(manager1) : null,
        manager_2_name: manager2 ? formatManagerOptionLabel(manager2) : null,
      };
    });

  return NextResponse.json({
    configured: true,
    teams,
    manager_options: managerOptions.map((option) => ({
      ...option,
      label: formatManagerOptionLabel(option),
    })),
  });
}

function normalizeTeamId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function POST(request: Request) {
  const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
  if (sensitiveAccessResponse) return sensitiveAccessResponse;

  const effectiveRole = await getEffectiveRole();
  const actorIsAdmin = hasEffectiveRoleFullAccess(effectiveRole);
  if (!actorIsAdmin) {
    return NextResponse.json({ error: 'Forbidden: only admins can create teams' }, { status: 403 });
  }

  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const requestedId = typeof body?.id === 'string' ? body.id : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : null;
  const timesheetType = parseTimesheetType(body?.timesheet_type) || 'civils';
  const manager1Id = typeof body?.manager_1_id === 'string' ? body.manager_1_id : null;
  const manager2Id = typeof body?.manager_2_id === 'string' ? body.manager_2_id : null;
  const teamId = normalizeTeamId(requestedId || name);

  if (!name) {
    return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
  }
  if (!teamId) {
    return NextResponse.json({ error: 'Team id is invalid' }, { status: 400 });
  }
  if (!VALID_TIMESHEET_TYPES.has(timesheetType)) {
    return NextResponse.json({ error: 'Invalid timesheet type' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const managerValidation = await validateTeamManagerSelection(supabaseAdmin, {
    manager_1_id: manager1Id || null,
    manager_2_id: manager2Id || null,
  });
  if (!managerValidation.ok) {
    return NextResponse.json({ error: managerValidation.error || 'Invalid team manager assignment' }, { status: 400 });
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('org_teams')
    .insert({
      id: teamId,
      name,
      code: code || teamId,
      timesheet_type: timesheetType,
      active: true,
      manager_1_profile_id: manager1Id || null,
      manager_2_profile_id: manager2Id || null,
    })
    .select('id, name, code, timesheet_type, active, manager_1_profile_id, manager_2_profile_id')
    .single();

  if (createError) {
    if (isMissingHierarchySchemaError(createError) || isMissingTeamManagerSchemaError(createError)) {
      return NextResponse.json(
        { error: 'Hierarchy teams table is not configured yet.' },
        { status: 501 }
      );
    }
    if (String(createError.code || '') === '23505') {
      return NextResponse.json({ error: 'Team id or name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: createError.message || 'Failed to create team' }, { status: 500 });
  }

  await ensureTeamPermissionRows(teamId, supabaseAdmin);

  try {
    await reconcileTeamManagerAssignments(supabaseAdmin, teamId);
  } catch (error) {
    if (!isMissingTeamManagerSchemaError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to reconcile team managers' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, team: created }, { status: 201 });
}
