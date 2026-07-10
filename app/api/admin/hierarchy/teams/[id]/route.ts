import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  isMissingTeamManagerSchemaError,
  reconcileTeamManagerAssignments,
  validateTeamManagerSelection,
} from '@/lib/server/team-managers';

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
        message.includes('org_teams') ||
        message.includes('team_id')
      ))
  );
}

function parseOptionalManagerId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  return undefined;
}

function normalizeStoredManagerId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

const VALID_TIMESHEET_TYPES = new Set(['civils', 'plant']);

function parseOptionalTimesheetType(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

async function assertAdminUsersAccess() {
  const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
  if (sensitiveAccessResponse) return sensitiveAccessResponse;

  const effectiveRole = await getEffectiveRole();
  const actorIsAdmin = hasEffectiveRoleFullAccess(effectiveRole);
  if (!actorIsAdmin) {
    return NextResponse.json({ error: 'Forbidden: only admins can modify teams' }, { status: 403 });
  }

  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const accessError = await assertAdminUsersAccess();
  if (accessError) return accessError;

  const teamId = (await params).id;
  const body = await request.json();

  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  const code = typeof body?.code === 'string' ? body.code.trim() : undefined;
  const timesheetType = parseOptionalTimesheetType(body?.timesheet_type);
  const manager1Id = parseOptionalManagerId(body?.manager_1_id);
  const manager2Id = parseOptionalManagerId(body?.manager_2_id);

  if (name === '') {
    return NextResponse.json({ error: 'Team name cannot be empty' }, { status: 400 });
  }

  if (
    name === undefined &&
    code === undefined &&
    timesheetType === undefined &&
    manager1Id === undefined &&
    manager2Id === undefined
  ) {
    return NextResponse.json({ error: 'No team fields provided' }, { status: 400 });
  }
  if (timesheetType !== undefined && !VALID_TIMESHEET_TYPES.has(timesheetType)) {
    return NextResponse.json({ error: 'Invalid timesheet type' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  if (manager1Id !== undefined || manager2Id !== undefined) {
    const { data: existingTeam, error: existingTeamError } = await supabaseAdmin
      .from('org_teams')
      .select('id, manager_1_profile_id, manager_2_profile_id')
      .eq('id', teamId)
      .single();

    if (existingTeamError) {
      if (isMissingHierarchySchemaError(existingTeamError) || isMissingTeamManagerSchemaError(existingTeamError)) {
        return NextResponse.json({ error: 'Hierarchy teams table is not configured yet.' }, { status: 501 });
      }
      if (String(existingTeamError.code || '') === 'PGRST116') {
        return NextResponse.json({ error: 'Team not found' }, { status: 404 });
      }
      return NextResponse.json({ error: existingTeamError.message || 'Failed to load team' }, { status: 500 });
    }

    const currentTeam = (existingTeam || {}) as {
      manager_1_profile_id?: string | null;
      manager_2_profile_id?: string | null;
    };
    const validation = await validateTeamManagerSelection(supabaseAdmin, {
      manager_1_id: manager1Id !== undefined ? manager1Id : normalizeStoredManagerId(currentTeam.manager_1_profile_id),
      manager_2_id: manager2Id !== undefined ? manager2Id : normalizeStoredManagerId(currentTeam.manager_2_profile_id),
    });
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error || 'Invalid team manager assignment' },
        { status: 400 }
      );
    }
  }

  const updatePayload: {
    name?: string;
    code?: string | null;
    timesheet_type?: string;
    manager_1_profile_id?: string | null;
    manager_2_profile_id?: string | null;
  } = {};
  if (name !== undefined) updatePayload.name = name;
  if (code !== undefined) updatePayload.code = code || null;
  if (timesheetType !== undefined) updatePayload.timesheet_type = timesheetType;
  if (manager1Id !== undefined) updatePayload.manager_1_profile_id = manager1Id || null;
  if (manager2Id !== undefined) updatePayload.manager_2_profile_id = manager2Id || null;

  const { data: updatedTeam, error: updateError } = await supabaseAdmin
    .from('org_teams')
    .update(updatePayload)
    .eq('id', teamId)
    .select('id, name, code, timesheet_type, active, manager_1_profile_id, manager_2_profile_id')
    .single();

  if (updateError) {
    if (isMissingHierarchySchemaError(updateError) || isMissingTeamManagerSchemaError(updateError)) {
      return NextResponse.json({ error: 'Hierarchy teams table is not configured yet.' }, { status: 501 });
    }
    if (String(updateError.code || '') === 'PGRST116') {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    if (String(updateError.code || '') === '23505') {
      return NextResponse.json({ error: 'Team name/code already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: updateError.message || 'Failed to update team' }, { status: 500 });
  }

  if (manager1Id !== undefined || manager2Id !== undefined) {
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
  }

  return NextResponse.json({ success: true, team: updatedTeam });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const accessError = await assertAdminUsersAccess();
  if (accessError) return accessError;

  const teamId = (await params).id;
  const supabaseAdmin = getSupabaseAdmin();

  const { count, error: countError } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId);
  if (countError) {
    if (isMissingHierarchySchemaError(countError)) {
      return NextResponse.json({ error: 'Hierarchy schema is not configured yet.' }, { status: 501 });
    }
    return NextResponse.json({ error: 'Failed to validate team assignments' }, { status: 500 });
  }
  if ((count || 0) > 0) {
    return NextResponse.json(
      {
        error: `Cannot remove team while users are assigned (${count}). Reassign users first.`,
      },
      { status: 409 }
    );
  }

  const { data: deletedTeam, error: deleteError } = await supabaseAdmin
    .from('org_teams')
    .delete()
    .eq('id', teamId)
    .select('id, name, code, active')
    .single();

  if (deleteError) {
    if (String(deleteError.code || '') === 'PGRST116') {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    return NextResponse.json({ error: deleteError.message || 'Failed to delete team' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: 'Team deleted successfully',
    team: deletedTeam,
  });
}
