import type { SupabaseClient } from '@supabase/supabase-js';
import { buildEmployeeCapacity } from '@/lib/server/scheduling-capacity';
import { getScheduleLondonStartsAtRangeIso } from '@/lib/utils/scheduling';
import type {
  ScheduleDayCapacity,
  ScheduleEmployeeAssignment,
  ScheduleEmployeeResource,
  ScheduleVisit,
} from '@/types/scheduling';

function mapEmployee(row: Record<string, unknown>): ScheduleEmployeeResource {
  const team = row.team as { name?: string } | Array<{ name?: string }> | null;
  const teamName = Array.isArray(team) ? team[0]?.name : team?.name;
  return {
    id: String(row.id),
    full_name: String(row.full_name || 'Unknown'),
    employee_id: typeof row.employee_id === 'string' ? row.employee_id : null,
    team_id: typeof row.team_id === 'string' ? row.team_id : null,
    team_name: teamName || null,
  };
}

/**
 * Load authoritative employee capacity for specific work dates after an assignment mutation.
 */
export async function loadEmployeeCapacityForDates(
  admin: SupabaseClient,
  dates: string[]
): Promise<ScheduleDayCapacity[]> {
  const uniqueDates = Array.from(new Set(dates)).sort();
  if (uniqueDates.length === 0) return [];

  const weekStart = uniqueDates[0];
  const weekEnd = uniqueDates[uniqueDates.length - 1];
  const visitRange = getScheduleLondonStartsAtRangeIso(weekStart, weekEnd);

  const [employeeAssignmentsResult, visitsResult, employeesResult, absencesResult, shiftsResult] =
    await Promise.all([
      admin
        .from('schedule_employee_assignments')
        .select('*')
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd),
      admin
        .from('schedule_visits')
        .select('*')
        .gte('starts_at', visitRange.startInclusiveIso)
        .lt('starts_at', visitRange.endExclusiveIso),
      admin
        .from('profiles')
        .select('id, full_name, employee_id, team_id, is_placeholder, team:org_teams!profiles_team_id_fkey(name)')
        .eq('is_placeholder', false)
        .order('full_name'),
      admin
        .from('absences')
        .select('profile_id, date, end_date, is_half_day, half_day_session')
        .in('status', ['approved', 'processed'])
        .lte('date', weekEnd)
        .or(`end_date.gte.${weekStart},end_date.is.null`),
      admin.from('employee_work_shifts').select('*'),
    ]);

  const failed = [
    employeeAssignmentsResult,
    visitsResult,
    employeesResult,
    absencesResult,
    shiftsResult,
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;

  const visitsById = new Map(
    ((visitsResult.data || []) as ScheduleVisit[]).map((visit) => [visit.id, visit])
  );
  const employees = ((employeesResult.data || []) as Array<Record<string, unknown>>).map(mapEmployee);
  const employeeAssignments: ScheduleEmployeeAssignment[] = (
    (employeeAssignmentsResult.data || []) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    job_id: String(row.job_id),
    work_date: String(row.work_date),
    visit_id: typeof row.visit_id === 'string' ? row.visit_id : null,
    notes: typeof row.notes === 'string' ? row.notes : null,
    conflict_override: row.conflict_override === true,
    conflict_codes: Array.isArray(row.conflict_codes) ? row.conflict_codes : [],
    conflict_override_by:
      typeof row.conflict_override_by === 'string' ? row.conflict_override_by : null,
    conflict_override_at:
      typeof row.conflict_override_at === 'string' ? row.conflict_override_at : null,
    assigned_by: typeof row.assigned_by === 'string' ? row.assigned_by : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    conflicts: [],
    visit: typeof row.visit_id === 'string' ? visitsById.get(String(row.visit_id)) || null : null,
    resource_type: 'employee' as const,
    profile_id: String(row.profile_id),
    employee: employees.find((employee) => employee.id === String(row.profile_id)) || null,
  }));

  const shifts = new Map(
    ((shiftsResult.data || []) as Array<Record<string, unknown>>).map((row) => [
      String(row.profile_id),
      row as Record<string, boolean>,
    ])
  );

  return buildEmployeeCapacity({
    dates: uniqueDates,
    employees,
    assignments: employeeAssignments,
    absences: (absencesResult.data || []) as Array<{
      profile_id: string;
      date: string;
      end_date: string | null;
      is_half_day: boolean | null;
      half_day_session: 'AM' | 'PM' | null;
    }>,
    shifts,
  });
}
