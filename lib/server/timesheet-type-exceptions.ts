import { createAdminClient } from '@/lib/supabase/admin';
import {
  normalizeTimesheetExceptionOverrideType,
  normalizeTimesheetExceptionType,
  type TimesheetExceptionOverrideType,
  type TimesheetExceptionType,
  type TimesheetTypeExceptionMatrixResponse,
} from '@/types/timesheet-type-exceptions';

interface ProfileWithDefaultsRow {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  team_id: string | null;
  team?: {
    id?: string | null;
    name?: string | null;
    timesheet_type?: string | null;
  } | null;
  role?: {
    name?: string | null;
    display_name?: string | null;
    timesheet_type?: string | null;
  } | null;
}

interface TimesheetTypeExceptionRow {
  profile_id: string;
  timesheet_type?: string | null;
}

const DEFAULT_TIMESHEET_TYPE: TimesheetExceptionType = 'civils';

function resolveDefaultTimesheetType(params: {
  teamTimesheetType?: string | null;
  roleTimesheetType?: string | null;
}): TimesheetExceptionType {
  const teamType = normalizeTimesheetExceptionType(params.teamTimesheetType);
  if (teamType) return teamType;

  const roleType = normalizeTimesheetExceptionType(params.roleTimesheetType);
  if (roleType) return roleType;

  return DEFAULT_TIMESHEET_TYPE;
}

export async function getTimesheetTypeExceptionMatrix(): Promise<TimesheetTypeExceptionMatrixResponse> {
  const admin = createAdminClient();
  const { data: exceptionsData, error: exceptionsError } = await (admin as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        order: (column: string, options?: { ascending?: boolean }) => Promise<{
          data: TimesheetTypeExceptionRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  })
    .from('timesheet_type_exceptions')
    .select('profile_id, timesheet_type')
    .order('profile_id', { ascending: true });

  if (exceptionsError) {
    throw new Error(exceptionsError.message || 'Failed to load timesheet type exceptions');
  }

  const exceptionRows = exceptionsData || [];
  if (exceptionRows.length === 0) {
    return { rows: [] };
  }

  const profileIds = exceptionRows.map((row) => row.profile_id);
  const { data: profilesData, error: profilesError } = await admin
    .from('profiles')
    .select(
      'id, full_name, employee_id, team_id, team:org_teams!profiles_team_id_fkey(id, name, timesheet_type), role:roles(name, display_name, timesheet_type)'
    )
    .in('id', profileIds);

  if (profilesError) {
    throw new Error(profilesError.message || 'Failed to load profile defaults');
  }

  const profilesById = new Map<string, ProfileWithDefaultsRow>();
  ((profilesData || []) as ProfileWithDefaultsRow[]).forEach((row) => {
    profilesById.set(row.id, row);
  });

  const rows = exceptionRows
    .map((exceptionRow) => {
      const profile = profilesById.get(exceptionRow.profile_id);
      if (!profile) return null;

      const defaultType = resolveDefaultTimesheetType({
        teamTimesheetType: profile.team?.timesheet_type,
        roleTimesheetType: profile.role?.timesheet_type,
      });
      const overrideType = normalizeTimesheetExceptionOverrideType(exceptionRow.timesheet_type);
      const effectiveType: TimesheetExceptionOverrideType = overrideType || defaultType;

      return {
        profile_id: profile.id,
        full_name: profile.full_name || 'Unknown user',
        employee_id: profile.employee_id || null,
        role_name: profile.role?.name || null,
        role_display_name: profile.role?.display_name || null,
        team_id: profile.team_id || null,
        team_name: profile.team?.name || null,
        team_timesheet_type:
          normalizeTimesheetExceptionType(profile.team?.timesheet_type) || DEFAULT_TIMESHEET_TYPE,
        default_timesheet_type: defaultType,
        override_timesheet_type: overrideType,
        effective_timesheet_type: effectiveType,
        has_exception_row: true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return { rows };
}

export async function addTimesheetTypeExceptionRow(profileId: string, actorId?: string | null): Promise<void> {
  const admin = createAdminClient();
  const payload: Record<string, unknown> = {
    profile_id: profileId,
    updated_by: actorId || null,
  };
  if (actorId) {
    payload.created_by = actorId;
  }

  const { error } = await (admin as unknown as {
    from: (table: string) => {
      upsert: (
        values: Record<string, unknown>,
        options?: { onConflict?: string }
      ) => Promise<{ error: { message: string } | null }>;
    };
  })
    .from('timesheet_type_exceptions')
    .upsert(payload, { onConflict: 'profile_id' });

  if (error) {
    throw new Error(error.message || 'Failed to create timesheet exception row');
  }
}

export async function upsertTimesheetTypeException(params: {
  profile_id: string;
  timesheet_type: TimesheetExceptionOverrideType | null;
  actor_id?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const payload: Record<string, unknown> = {
    profile_id: params.profile_id,
    timesheet_type: params.timesheet_type,
    updated_by: params.actor_id || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await (admin as unknown as {
    from: (table: string) => {
      upsert: (
        values: Record<string, unknown>,
        options?: { onConflict?: string }
      ) => Promise<{ error: { message: string } | null }>;
    };
  })
    .from('timesheet_type_exceptions')
    .upsert(payload, { onConflict: 'profile_id' });

  if (error) {
    throw new Error(error.message || 'Failed to update timesheet exception');
  }
}

export async function deleteTimesheetTypeExceptionRow(profileId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await (admin as unknown as {
    from: (table: string) => {
      delete: () => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  })
    .from('timesheet_type_exceptions')
    .delete()
    .eq('profile_id', profileId);

  if (error) {
    throw new Error(error.message || 'Failed to delete timesheet exception row');
  }
}
