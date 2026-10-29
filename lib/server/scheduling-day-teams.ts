import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assignmentCreateInputHash,
  replayAssignmentMutationIfPresent,
  rpcWithIdempotentFallback,
} from '@/lib/server/scheduling-assignment-idempotency';
import { loadEmployeeCapacityForDates } from '@/lib/server/scheduling-assignment-capacity';
import { detectEmployeeConflicts, detectPlantConflicts } from '@/lib/server/scheduling-conflicts';
import { loadScheduleTeamSettings } from '@/lib/server/scheduling-team-settings';
import {
  buildScheduleDayTeams,
  defaultScheduleTeamSettings,
  isScheduleDayTeamSlotIndex,
  isVisibleScheduleDayTeamSlotIndex,
  leaderBySlotIndex,
  mapDayTeamMemberRow,
  mapDayTeamPlantRow,
  standingLeaderProfileIds,
} from '@/lib/utils/scheduling-day-teams';
import { enumerateScheduleDates, getScheduleVisitDate } from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleDayCapacity,
  ScheduleDayTeamMember,
  ScheduleDayTeamPlant,
  ScheduleDayTeamSlotIndex,
  ScheduleDayTeams,
  ScheduleEmployeeResource,
  SchedulePlantResource,
  ScheduleTeamSettings,
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
  resource_type: 'employee' | 'plant';
  profile_id?: string | null;
  plant_id?: string | null;
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
  if (message.includes('TEAM_LEADER_LOCKED')) {
    return { status: 409, error: 'Change this team leader in Settings instead.' };
  }
  if (message.includes('TEAM_SLOT_INVALID')) {
    return { status: 400, error: 'Choose a visible team bucket.' };
  }
  if (message.includes('TEAM_PROFILE_INVALID')) {
    return { status: 400, error: 'Choose an active employee for this team.' };
  }
  if (message.includes('TEAM_PLANT_INVALID')) {
    return { status: 400, error: 'Choose a plant that exists and is not retired.' };
  }
  return null;
}

export function isMissingDayTeamPlantsRelation(error: unknown): boolean {
  const normalized = error as { code?: string; message?: string };
  const message = normalized?.message?.toLowerCase() || '';
  return (
    normalized?.code === '42P01'
    || normalized?.code === 'PGRST205'
    || (
      message.includes('schedule_day_team_plants')
      && (message.includes('does not exist') || message.includes('schema cache'))
    )
  );
}

export async function loadScheduleDayTeams(
  admin: SupabaseClient,
  weekStart: string,
  weekEnd: string,
  employeesById: Map<string, ScheduleEmployeeResource>,
  settings: ScheduleTeamSettings = defaultScheduleTeamSettings(),
  plantsById: Map<string, SchedulePlantResource> = new Map()
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
      return buildScheduleDayTeams(dates, [], settings);
    }
    throw result.error;
  }
  const members = ((result.data || []) as Array<Record<string, unknown>>)
    .map((row) => mapDayTeamMemberRow(row, employeesById))
    .filter((row): row is ScheduleDayTeamMember => Boolean(row));

  const plantsResult = await admin
    .from('schedule_day_team_plants')
    .select('work_date, slot_index, plant_id, added_by, created_at')
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd)
    .order('slot_index')
    .order('created_at');
  if (plantsResult.error) {
    if (isMissingDayTeamPlantsRelation(plantsResult.error)) {
      return buildScheduleDayTeams(dates, members, settings);
    }
    throw plantsResult.error;
  }
  const plants = ((plantsResult.data || []) as Array<Record<string, unknown>>)
    .map((row) => mapDayTeamPlantRow(row, plantsById))
    .filter((row): row is ScheduleDayTeamPlant => Boolean(row));
  return buildScheduleDayTeams(dates, members, settings, plants);
}

export interface DayTeamSkippedMember {
  full_name: string;
  reason: 'conflict' | 'overlap';
  conflicts: SchedulingConflict[];
  profile_id?: string;
  plant_id?: string;
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
  created: Record<string, unknown>,
  resourceType: 'employee' | 'plant',
  resourceId: string
): DayTeamAssignmentRow {
  const row: DayTeamAssignmentRow = {
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
    resource_type: resourceType,
  };
  if (resourceType === 'plant') {
    row.plant_id = typeof created.plant_id === 'string' && created.plant_id
      ? created.plant_id
      : resourceId;
    return row;
  }
  row.profile_id = typeof created.profile_id === 'string' && created.profile_id
    ? created.profile_id
    : resourceId;
  return row;
}

function plantAssignmentLabel(row: {
  nickname?: string | null;
  plant_id?: string | null;
  make?: string | null;
  model?: string | null;
} | undefined): string {
  const nickname = row?.nickname?.trim();
  if (nickname) return nickname;
  const code = row?.plant_id?.trim();
  if (code) return code;
  const description = [row?.make, row?.model]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  return description || 'Plant';
}

export async function assignDayTeamToVisit(
  admin: SupabaseClient,
  input: {
    visitId: string;
    slotIndex: ScheduleDayTeamSlotIndex;
    actorUserId: string;
    memberRequestIds?: Record<string, string>;
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
  const settings = await loadScheduleTeamSettings(admin, new Map());
  if (!isVisibleScheduleDayTeamSlotIndex(input.slotIndex, settings.visible_slot_count)) {
    return { status: 400, error: 'Choose a visible team bucket.' };
  }
  const [membersResult, plantsResult] = await Promise.all([
    admin
      .from('schedule_day_team_members')
      .select('work_date, slot_index, profile_id, added_by, created_at')
      .eq('work_date', workDate)
      .eq('slot_index', input.slotIndex)
      .order('created_at'),
    admin
      .from('schedule_day_team_plants')
      .select('work_date, slot_index, plant_id, added_by, created_at')
      .eq('work_date', workDate)
      .eq('slot_index', input.slotIndex)
      .order('created_at'),
  ]);
  if (membersResult.error) throw membersResult.error;
  if (plantsResult.error && !isMissingDayTeamPlantsRelation(plantsResult.error)) {
    throw plantsResult.error;
  }
  const leader = leaderBySlotIndex(settings, input.slotIndex);
  const uniqueProfileIds = Array.from(
    new Set([
      ...(leader ? [leader.profile_id] : []),
      ...((membersResult.data || []) as Array<{ profile_id: string }>)
        .map((row) => row.profile_id)
        .filter((profileId) => profileId !== leader?.profile_id),
    ])
  );
  const uniquePlantIds = plantsResult.error
    ? []
    : Array.from(new Set(
      ((plantsResult.data || []) as Array<{ plant_id: string }>)
        .map((row) => row.plant_id)
        .filter((plantId) => Boolean(plantId))
    ));
  if (uniqueProfileIds.length === 0 && uniquePlantIds.length === 0) {
    const capacity = await loadEmployeeCapacityForDates(admin, [workDate]);
    return {
      assignments: [],
      skipped: [],
      already_assigned_count: 0,
      employee_capacity: capacity,
    };
  }

  const alreadyOnVisit = new Set<string>();
  const plantsAlreadyOnVisit = new Set<string>();
  const namesById = new Map<string, string>();
  const plantLabels = new Map<string, string>();

  if (uniqueProfileIds.length > 0) {
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
    for (const row of (existingResult.data || []) as Array<{ profile_id: string }>) {
      alreadyOnVisit.add(row.profile_id);
    }
    for (const row of (employeesResult.data || []) as Array<{ id: string; full_name: string | null }>) {
      namesById.set(row.id, row.full_name || 'Employee');
    }
  }

  if (uniquePlantIds.length > 0) {
    const [existingPlantsResult, plantNamesResult] = await Promise.all([
      admin
        .from('schedule_plant_assignments')
        .select('id, plant_id, visit_id')
        .eq('visit_id', visit.id)
        .in('plant_id', uniquePlantIds),
      admin
        .from('plant')
        .select('id, plant_id, nickname, make, model')
        .in('id', uniquePlantIds),
    ]);
    if (existingPlantsResult.error) throw existingPlantsResult.error;
    if (plantNamesResult.error) throw plantNamesResult.error;
    for (const row of (existingPlantsResult.data || []) as Array<{ plant_id: string }>) {
      plantsAlreadyOnVisit.add(row.plant_id);
    }
    for (const row of (plantNamesResult.data || []) as Array<{
      id: string;
      plant_id?: string | null;
      nickname?: string | null;
      make?: string | null;
      model?: string | null;
    }>) {
      plantLabels.set(row.id, plantAssignmentLabel(row));
    }
  }

  const assignments: DayTeamAssignmentRow[] = [];
  const skipped: DayTeamSkippedMember[] = [];
  let alreadyAssignedCount = 0;

  const targets: Array<{
    resourceType: 'employee' | 'plant';
    resourceId: string;
    fullName: string;
    already: Set<string>;
  }> = [
    ...uniqueProfileIds.map((profileId) => ({
      resourceType: 'employee' as const,
      resourceId: profileId,
      fullName: namesById.get(profileId) || 'Employee',
      already: alreadyOnVisit,
    })),
    ...uniquePlantIds.map((plantId) => ({
      resourceType: 'plant' as const,
      resourceId: plantId,
      fullName: plantLabels.get(plantId) || 'Plant',
      already: plantsAlreadyOnVisit,
    })),
  ];

  for (const target of targets) {
    const memberRequestId = input.memberRequestIds?.[target.resourceId];
    if (memberRequestId) {
      const replay = await replayAssignmentMutationIfPresent<Record<string, unknown> | Record<string, unknown>[]>(
        admin,
        memberRequestId,
        'create',
        assignmentCreateInputHash({
          jobId: visit.job_id,
          visitId: visit.id,
          resourceType: target.resourceType,
          resourceId: target.resourceId,
          workDate,
          notes: null,
          overrideConflicts: false,
        })
      );
      if (replay.kind === 'replay') {
        const created = Array.isArray(replay.result) ? replay.result[0] : replay.result;
        if (created) {
          assignments.push(mapAssignmentRow(created, target.resourceType, target.resourceId));
          if (target.already.has(target.resourceId)) alreadyAssignedCount += 1;
          target.already.add(target.resourceId);
          continue;
        }
      }
    }

    if (target.already.has(target.resourceId)) {
      alreadyAssignedCount += 1;
      continue;
    }

    const conflicts = target.resourceType === 'employee'
      ? await detectEmployeeConflicts(admin, {
          jobId: visit.job_id,
          workDate,
          profileId: target.resourceId,
          visit,
        })
      : await detectPlantConflicts(admin, {
          jobId: visit.job_id,
          workDate,
          plantId: target.resourceId,
          visit,
        });
    if (conflicts.length > 0) {
      skipped.push({
        full_name: target.fullName,
        reason: 'conflict',
        conflicts,
        ...(target.resourceType === 'employee'
          ? { profile_id: target.resourceId }
          : { plant_id: target.resourceId }),
      });
      continue;
    }

    const createArgs = {
      p_job_id: visit.job_id,
      p_visit_id: visit.id,
      p_resource_type: target.resourceType,
      p_resource_id: target.resourceId,
      p_work_date: workDate,
      p_notes: null,
      p_override_conflicts: false,
      p_conflict_codes: [] as string[],
      p_actor_user_id: input.actorUserId,
    };
    const { data, error } = memberRequestId
      ? await rpcWithIdempotentFallback(
          admin,
          'create_schedule_assignment_v2',
          { ...createArgs, p_request_id: memberRequestId },
          'create_schedule_assignment_v1',
          createArgs
        )
      : await admin.rpc('create_schedule_assignment_v1', createArgs);
    if (error) {
      if (isOverlapAssignmentError(error)) {
        const resourceColumn = target.resourceType === 'employee' ? 'profile_id' : 'plant_id';
        const reread = await admin
          .from(target.resourceType === 'employee'
            ? 'schedule_employee_assignments'
            : 'schedule_plant_assignments')
          .select('id')
          .eq('visit_id', visit.id)
          .eq(resourceColumn, target.resourceId)
          .maybeSingle();
        if (reread.error) throw reread.error;
        if (reread.data) {
          alreadyAssignedCount += 1;
          target.already.add(target.resourceId);
          continue;
        }
        skipped.push({
          full_name: target.fullName,
          reason: 'overlap',
          conflicts: [{
            code: target.resourceType === 'employee'
              ? 'employee_double_booked'
              : 'plant_double_booked',
            severity: 'warning',
            message: target.resourceType === 'employee'
              ? 'This employee is already assigned during an overlapping visit.'
              : 'This plant is already assigned during an overlapping visit.',
          }],
          ...(target.resourceType === 'employee'
            ? { profile_id: target.resourceId }
            : { plant_id: target.resourceId }),
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
      assignments.push(mapAssignmentRow(created, target.resourceType, target.resourceId));
      target.already.add(target.resourceId);
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

export interface CopiedDayTeamMemberRow {
  work_date: string;
  slot_index: ScheduleDayTeamSlotIndex;
  profile_id: string;
  added_by: string | null;
  created_at: string;
}

export interface CopiedDayTeamPlantRow {
  work_date: string;
  slot_index: ScheduleDayTeamSlotIndex;
  plant_id: string;
  added_by: string | null;
  created_at: string;
}

export async function copyScheduleDayTeamMembers(
  admin: SupabaseClient,
  input: {
    fromDate: string;
    toDate: string;
    actorUserId: string;
  }
): Promise<
  | { status: 400; error: string }
  | {
      members: CopiedDayTeamMemberRow[];
      plants: CopiedDayTeamPlantRow[];
      copied: number;
      skipped: number;
    }
> {
  if (input.fromDate === input.toDate) {
    return { status: 400, error: 'Choose a different date to copy from.' };
  }

  const settings = await loadScheduleTeamSettings(admin, new Map());
  const leaderIds = standingLeaderProfileIds(settings);
  const sourceResult = await admin
    .from('schedule_day_team_members')
    .select('work_date, slot_index, profile_id, added_by, created_at')
    .eq('work_date', input.fromDate)
    .order('slot_index')
    .order('created_at');
  if (sourceResult.error && !isMissingDayTeamsRelation(sourceResult.error)) {
    throw sourceResult.error;
  }

  const plantsResult = await admin
    .from('schedule_day_team_plants')
    .select('work_date, slot_index, plant_id, added_by, created_at')
    .eq('work_date', input.fromDate)
    .order('slot_index')
    .order('created_at');
  if (plantsResult.error && !isMissingDayTeamPlantsRelation(plantsResult.error)) {
    throw plantsResult.error;
  }

  const sourceMembers = sourceResult.error
    ? []
    : ((sourceResult.data || []) as Array<Record<string, unknown>>)
      .map((row) => ({
        slot_index: Number(row.slot_index),
        profile_id: String(row.profile_id || ''),
      }))
      .filter((row): row is { slot_index: ScheduleDayTeamSlotIndex; profile_id: string } =>
        Boolean(row.profile_id)
        && !leaderIds.has(row.profile_id)
        && isVisibleScheduleDayTeamSlotIndex(row.slot_index, settings.visible_slot_count)
      );

  const seenPlantIds = new Set<string>();
  const sourcePlants = plantsResult.error
    ? []
    : ((plantsResult.data || []) as Array<Record<string, unknown>>)
      .map((row) => ({
        slot_index: Number(row.slot_index),
        plant_id: String(row.plant_id || ''),
      }))
      .filter((row): row is { slot_index: ScheduleDayTeamSlotIndex; plant_id: string } => {
        if (!row.plant_id || seenPlantIds.has(row.plant_id)) return false;
        if (!isVisibleScheduleDayTeamSlotIndex(row.slot_index, settings.visible_slot_count)) {
          return false;
        }
        seenPlantIds.add(row.plant_id);
        return true;
      });

  const members: CopiedDayTeamMemberRow[] = [];
  const plants: CopiedDayTeamPlantRow[] = [];
  let skipped = 0;
  for (const source of sourceMembers) {
    const { data, error } = await admin.rpc('add_schedule_day_team_member_v1', {
      p_work_date: input.toDate,
      p_slot_index: source.slot_index,
      p_profile_id: source.profile_id,
      p_actor_user_id: input.actorUserId,
    });
    if (error) {
      const mapped = mapDayTeamRpcError(error);
      if (mapped && mapped.status !== 500) {
        skipped += 1;
        continue;
      }
      throw error;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) continue;
    const slotIndex = Number(row.slot_index);
    if (!isScheduleDayTeamSlotIndex(slotIndex)) continue;
    members.push({
      work_date: String(row.work_date || input.toDate).slice(0, 10),
      slot_index: slotIndex,
      profile_id: String(row.profile_id || source.profile_id),
      added_by: typeof row.added_by === 'string' ? row.added_by : input.actorUserId,
      created_at: String(row.created_at || new Date().toISOString()),
    });
  }

  for (const source of sourcePlants) {
    const { data, error } = await admin.rpc('add_schedule_day_team_plant_v1', {
      p_work_date: input.toDate,
      p_slot_index: source.slot_index,
      p_plant_id: source.plant_id,
      p_actor_user_id: input.actorUserId,
    });
    if (error) {
      const mapped = mapDayTeamRpcError(error);
      if (mapped && mapped.status !== 500) {
        skipped += 1;
        continue;
      }
      throw error;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) {
      skipped += 1;
      continue;
    }
    const slotIndex = Number(row.slot_index);
    if (!isScheduleDayTeamSlotIndex(slotIndex)) {
      skipped += 1;
      continue;
    }
    plants.push({
      work_date: String(row.work_date || input.toDate).slice(0, 10),
      slot_index: slotIndex,
      plant_id: String(row.plant_id || source.plant_id),
      added_by: typeof row.added_by === 'string' ? row.added_by : input.actorUserId,
      created_at: String(row.created_at || new Date().toISOString()),
    });
  }

  return {
    members,
    plants,
    copied: members.length + plants.length,
    skipped,
  };
}

export { isScheduleDayTeamSlotIndex };
