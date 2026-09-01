import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEmployeeCapacityForDates } from '@/lib/server/scheduling-assignment-capacity';
import { detectEmployeeConflicts } from '@/lib/server/scheduling-conflicts';
import {
  buildScheduleDayTeams,
  isScheduleDayTeamSlotIndex,
  mapDayTeamMemberRow,
} from '@/lib/utils/scheduling-day-teams';
import { enumerateScheduleDates, getScheduleVisitDate } from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleDayCapacity,
  ScheduleDayTeamMember,
  ScheduleDayTeamSlotIndex,
  ScheduleDayTeams,
  ScheduleEmployeeResource,
  ScheduleVisit,
  SchedulingConflict,
} from '@/types/scheduling';

interface DayTeamAssignmentRow {
  id: string;
  job_id: string;
  work_date: string;
  visit_id: string | null;
  notes: string | null;
  conflict_override: boolean;
  conflict_codes: ScheduleAssignment['conflict_codes'];
  conflict_override_by: string | null;
  conflict_override_at: string | null;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
  resource_type: 'employee';
  profile_id: string | null;
}

export function isMissingDayTeamsRelation(error: unknown): boolean {
  const normalized = error as { code?: string; message?: string };
  const message = normalized?.message?.toLowerCase() || '';
  return (
    normalized?.code === '42P01'
    || normalized?.code === 'PGRST205'
    || (
      message.includes('schedule_day_team_members')
      && (message.includes('does not exist') || message.includes('schema cache'))
    )
  );
}

export function mapDayTeamRpcError(error: { code?: string; message?: string }): {
  status: number;
  error: string;
} | null {
  const message = error.message || '';
  if (message.includes('TEAM_SLOT_FULL')) {
    return { status: 409, error: 'This team already has six employees.' };
  }
  if (message.includes('TEAM_SLOT_INVALID')) {
    return { status: 400, error: 'Choose Team 1, Team 2, or Team 3.' };
  }
  if (message.includes('TEAM_PROFILE_INVALID')) {
    return { status: 400, error: 'Choose an active employee for this team.' };
  }
  return null;
}

export async function loadScheduleDayTeams(
  admin: SupabaseClient,
  weekStart: string,
  weekEnd: string,
  employeesById: Map<string, ScheduleEmployeeResource>
): Promise<ScheduleDayTeams[]> {
  const dates = enumerateScheduleDates(weekStart, weekEnd);
  const result = await admin
    .from('schedule_day_team_members')
    .select('work_date, slot_index, profile_id, added_by, created_at')
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd)
    .order('slot_index')
    .order('created_at');
  if (result.error) {
    if (isMissingDayTeamsRelation(result.error)) {
      return buildScheduleDayTeams(dates, []);
    }
    throw result.error;
  }
  const members = ((result.data || []) as Array<Record<string, unknown>>)
    .map((row) => mapDayTeamMemberRow(row, employeesById))
    .filter((row): row is ScheduleDayTeamMember => Boolean(row));
  return buildScheduleDayTeams(dates, members);
}

export interface DayTeamSkippedMember {
  profile_id: string;
  full_name: string;
  reason: 'conflict' | 'overlap';
  conflicts: SchedulingConflict[];
}

export interface AssignDayTeamResult {
  assignments: DayTeamAssignmentRow[];
  skipped: DayTeamSkippedMember[];
  already_assigned_count: number;
  employee_capacity: ScheduleDayCapacity[];
  partial_error?: string;
}

function isOverlapAssignmentError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '23505'
    || error.message?.includes('RESOURCE_OVERLAP') === true
    || error.message?.includes('duplicate key') === true
  );
}

function mapAssignmentRow(
  created: Record<string, unknown>
): DayTeamAssignmentRow {
  return {
    id: String(created.assignment_id || created.id),
    job_id: String(created.job_id),
    work_date: String(created.work_date),
    visit_id: typeof created.visit_id === 'string' ? created.visit_id : null,
    notes: typeof created.notes === 'string' ? created.notes : null,
    conflict_override: created.conflict_override === true,
    conflict_codes: Array.isArray(created.conflict_codes)
      ? created.conflict_codes
      : [],
    conflict_override_by:
      typeof created.conflict_override_by === 'string' ? created.conflict_override_by : null,
    conflict_override_at:
      typeof created.conflict_override_at === 'string' ? created.conflict_override_at : null,
    assigned_by: typeof created.assigned_by === 'string' ? created.assigned_by : null,
    created_at: String(created.created_at),
    updated_at: String(created.updated_at),
    resource_type: 'employee',
    profile_id: typeof created.profile_id === 'string' ? created.profile_id : null,
  };
}

export async function assignDayTeamToVisit(
  admin: SupabaseClient,
  input: {
    visitId: string;
    slotIndex: ScheduleDayTeamSlotIndex;
    actorUserId: string;
  }
): Promise<AssignDayTeamResult | { status: number; error: string }> {
  const visitResult = await admin
    .from('schedule_visits')
    .select('*')
    .eq('id', input.visitId)
    .maybeSingle();
  if (visitResult.error) throw visitResult.error;
  const visit = visitResult.data as ScheduleVisit | null;
  if (!visit || visit.status === 'cancelled') {
    return { status: 404, error: 'Scheduling visit not found.' };
  }

  const workDate = getScheduleVisitDate(visit.starts_at);
  const membersResult = await admin
    .from('schedule_day_team_members')
    .select('work_date, slot_index, profile_id, added_by, created_at')
    .eq('work_date', workDate)
    .eq('slot_index', input.slotIndex)
    .order('created_at');
  if (membersResult.error) throw membersResult.error;

  const profileIds = ((membersResult.data || []) as Array<{ profile_id: string }>)
    .map((row) => row.profile_id);
  const uniqueProfileIds = Array.from(new Set(profileIds));
  if (uniqueProfileIds.length === 0) {
    const capacity = await loadEmployeeCapacityForDates(admin, [workDate]);
    return {
      assignments: [],
      skipped: [],
      already_assigned_count: 0,
      employee_capacity: capacity,
    };
  }

  const [existingResult, employeesResult] = await Promise.all([
    admin
      .from('schedule_employee_assignments')
      .select('id, profile_id, visit_id')
      .eq('visit_id', visit.id)
      .in('profile_id', uniqueProfileIds),
    admin
      .from('profiles')
      .select('id, full_name')
      .in('id', uniqueProfileIds),
  ]);
  if (existingResult.error) throw existingResult.error;
  if (employeesResult.error) throw employeesResult.error;

  const alreadyOnVisit = new Set(
    ((existingResult.data || []) as Array<{ profile_id: string }>).map((row) => row.profile_id)
  );
  const namesById = new Map(
    ((employeesResult.data || []) as Array<{ id: string; full_name: string | null }>).map(
      (row) => [row.id, row.full_name || 'Employee']
    )
  );

  const assignments: DayTeamAssignmentRow[] = [];
  const skipped: DayTeamSkippedMember[] = [];
  let alreadyAssignedCount = 0;

  for (const profileId of uniqueProfileIds) {
    const fullName = namesById.get(profileId) || 'Employee';
    if (alreadyOnVisit.has(profileId)) {
      alreadyAssignedCount += 1;
      continue;
    }

    const conflicts = await detectEmployeeConflicts(admin, {
      jobId: visit.job_id,
      workDate,
      profileId,
      visit,
    });
    if (conflicts.length > 0) {
      skipped.push({
        profile_id: profileId,
        full_name: fullName,
        reason: 'conflict',
        conflicts,
      });
      continue;
    }

    const { data, error } = await admin.rpc('create_schedule_assignment_v1', {
      p_job_id: visit.job_id,
      p_visit_id: visit.id,
      p_resource_type: 'employee',
      p_resource_id: profileId,
      p_work_date: workDate,
      p_notes: null,
      p_override_conflicts: false,
      p_conflict_codes: [],
      p_actor_user_id: input.actorUserId,
    });
    if (error) {
      if (isOverlapAssignmentError(error)) {
        const reread = await admin
          .from('schedule_employee_assignments')
          .select('id')
          .eq('visit_id', visit.id)
          .eq('profile_id', profileId)
          .maybeSingle();
        if (reread.error) throw reread.error;
        if (reread.data) {
          alreadyAssignedCount += 1;
          alreadyOnVisit.add(profileId);
          continue;
        }
        skipped.push({
          profile_id: profileId,
          full_name: fullName,
          reason: 'overlap',
          conflicts: [{
            code: 'employee_double_booked',
            severity: 'warning',
            message: 'This employee is already assigned during an overlapping visit.',
          }],
        });
        continue;
      }
      const capacity = await loadEmployeeCapacityForDates(admin, [workDate]);
      return {
        assignments,
        skipped,
        already_assigned_count: alreadyAssignedCount,
        employee_capacity: capacity,
        partial_error: 'Some team members were assigned before this request failed. Refresh the board and try the rest again.',
      };
    }

    const createdRows = (data || []) as Array<Record<string, unknown>>;
    const created = createdRows[0];
    if (created) {
      assignments.push(mapAssignmentRow(created));
      alreadyOnVisit.add(profileId);
    }
  }

  const capacity = await loadEmployeeCapacityForDates(admin, [workDate]);
  return {
    assignments,
    skipped,
    already_assigned_count: alreadyAssignedCount,
    employee_capacity: capacity,
  };
}

export { isScheduleDayTeamSlotIndex };
