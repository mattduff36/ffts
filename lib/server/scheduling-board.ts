import type { SupabaseClient } from '@supabase/supabase-js';
import { isEmployeeWorkingOnDate } from '@/lib/server/scheduling-conflicts';
import { normalizeScheduleJobTag } from '@/lib/server/scheduling-tags';
import { scheduleVisitIntervalsOverlap } from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleEmployeeAssignment,
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantAssignment,
  SchedulePlantResource,
  ScheduleVisit,
  SchedulingBoardPayload,
  SchedulingConflict,
  SchedulingSelfPayload,
} from '@/types/scheduling';

function pickRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapEmployee(row: Record<string, unknown>): ScheduleEmployeeResource {
  const team = pickRelation(row.team as { name?: string | null } | Array<{ name?: string | null }> | null);
  return {
    id: String(row.id),
    full_name: String(row.full_name || 'Unknown employee'),
    employee_id: typeof row.employee_id === 'string' ? row.employee_id : null,
    team_id: typeof row.team_id === 'string' ? row.team_id : null,
    team_name: team?.name || null,
  };
}

function mapPlant(row: Record<string, unknown>): SchedulePlantResource {
  return {
    id: String(row.id),
    plant_id: String(row.plant_id),
    nickname: typeof row.nickname === 'string' ? row.nickname : null,
    make: typeof row.make === 'string' ? row.make : null,
    model: typeof row.model === 'string' ? row.model : null,
    status: (row.status as SchedulePlantResource['status']) || null,
  };
}

function mapJob(row: Record<string, unknown>): ScheduleJob {
  const customer = pickRelation(row.customer as { company_name?: string | null } | Array<{ company_name?: string | null }> | null);
  const tagLinks = Array.isArray(row.tag_links)
    ? row.tag_links as Array<Record<string, unknown>>
    : [];
  const tags = tagLinks.flatMap((link) => {
    const tag = pickRelation(
      link.tag as Record<string, unknown> | Array<Record<string, unknown>> | null
    );
    return tag && tag.is_active !== false ? [normalizeScheduleJobTag(tag)] : [];
  });
  const { customer: _customer, tag_links: _tagLinks, ...job } = row;
  return {
    ...job,
    customer_name: customer?.company_name || null,
    is_drop_on_ready: row.is_drop_on_ready === true,
    tags,
  } as unknown as ScheduleJob;
}

function hasAbsence(
  profileId: string,
  workDate: string,
  absences: Array<{ profile_id: string; date: string; end_date: string | null }>
): boolean {
  return absences.some(
    (absence) =>
      absence.profile_id === profileId &&
      absence.date <= workDate &&
      (absence.end_date || absence.date) >= workDate
  );
}

function assignmentRowsOverlap(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  visits: Map<string, ScheduleVisit>
): boolean {
  const firstVisitId = typeof first.visit_id === 'string' ? first.visit_id : null;
  const secondVisitId = typeof second.visit_id === 'string' ? second.visit_id : null;
  if (!firstVisitId || !secondVisitId) return true;
  const firstVisit = visits.get(firstVisitId);
  const secondVisit = visits.get(secondVisitId);
  if (!firstVisit || !secondVisit) return true;
  if (firstVisit.status === 'cancelled' || secondVisit.status === 'cancelled') return false;
  return scheduleVisitIntervalsOverlap(firstVisit, secondVisit);
}

export function buildEmployeeAssignmentConflicts(
  row: Record<string, unknown>,
  allRows: Array<Record<string, unknown>>,
  jobs: Map<string, ScheduleJob>,
  absences: Array<{ profile_id: string; date: string; end_date: string | null }>,
  shifts: Map<string, Record<string, boolean>>,
  visits: Map<string, ScheduleVisit> = new Map()
): SchedulingConflict[] {
  const profileId = String(row.profile_id);
  const workDate = String(row.work_date);
  const conflicts: SchedulingConflict[] = allRows
    .filter(
      (candidate) =>
        String(candidate.profile_id) === profileId &&
        String(candidate.work_date) === workDate &&
        candidate !== row &&
        (!candidate.id || !row.id || String(candidate.id) !== String(row.id)) &&
        assignmentRowsOverlap(row, candidate, visits)
    )
    .map((candidate) => {
      const conflictingJob = jobs.get(String(candidate.job_id));
      return {
        code: 'employee_double_booked',
        severity: 'warning',
        conflictingJobId: String(candidate.job_id),
        conflictingJobReference: conflictingJob?.job_reference,
        message: `Employee is also assigned to ${conflictingJob?.job_reference || 'another job'}.`,
      };
    });

  if (hasAbsence(profileId, workDate, absences)) {
    conflicts.push({
      code: 'employee_absent',
      severity: 'warning',
      message: 'Employee has an approved or processed absence.',
    });
  }
  if (!isEmployeeWorkingOnDate(workDate, shifts.get(profileId))) {
    conflicts.push({
      code: 'employee_off_shift',
      severity: 'warning',
      message: 'Employee is not scheduled to work on this day.',
    });
  }
  return conflicts;
}

export function buildPlantAssignmentConflicts(
  row: Record<string, unknown>,
  allRows: Array<Record<string, unknown>>,
  jobs: Map<string, ScheduleJob>,
  plants: Map<string, SchedulePlantResource>,
  blocks: Array<{ plant_id: string; start_date: string; end_date: string; reason: string }>,
  visits: Map<string, ScheduleVisit> = new Map()
): SchedulingConflict[] {
  const plantId = String(row.plant_id);
  const workDate = String(row.work_date);
  const conflicts: SchedulingConflict[] = allRows
    .filter(
      (candidate) =>
        String(candidate.plant_id) === plantId &&
        String(candidate.work_date) === workDate &&
        candidate !== row &&
        (!candidate.id || !row.id || String(candidate.id) !== String(row.id)) &&
        assignmentRowsOverlap(row, candidate, visits)
    )
    .map((candidate) => {
      const conflictingJob = jobs.get(String(candidate.job_id));
      return {
        code: 'plant_double_booked',
        severity: 'warning',
        conflictingJobId: String(candidate.job_id),
        conflictingJobReference: conflictingJob?.job_reference,
        message: `Plant is also assigned to ${conflictingJob?.job_reference || 'another job'}.`,
      };
    });

  const plant = plants.get(plantId);
  if (plant?.status !== 'active') {
    conflicts.push({
      code: 'plant_inactive',
      severity: 'warning',
      message: `Plant status is ${plant?.status || 'unknown'}.`,
    });
  }
  for (const block of blocks.filter(
    (block) => block.plant_id === plantId && block.start_date <= workDate && block.end_date >= workDate
  )) {
    conflicts.push({
      code: 'plant_unavailable',
      severity: 'warning',
      message: `Plant is unavailable: ${block.reason}.`,
    });
  }
  return conflicts;
}

function normalizeBaseAssignment(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    work_date: String(row.work_date),
    visit_id: typeof row.visit_id === 'string' ? row.visit_id : null,
    notes: typeof row.notes === 'string' ? row.notes : null,
    conflict_override: row.conflict_override === true,
    conflict_codes: Array.isArray(row.conflict_codes) ? row.conflict_codes : [],
    conflict_override_by: typeof row.conflict_override_by === 'string' ? row.conflict_override_by : null,
    conflict_override_at: typeof row.conflict_override_at === 'string' ? row.conflict_override_at : null,
    assigned_by: typeof row.assigned_by === 'string' ? row.assigned_by : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function loadSchedulingBoard(
  admin: SupabaseClient,
  weekStart: string,
  weekEnd: string
): Promise<SchedulingBoardPayload> {
  const [jobsResult, tagsResult, visitsResult, employeeAssignmentsResult, plantAssignmentsResult, employeesResult, plantResult, blocksResult, absencesResult, shiftsResult] =
    await Promise.all([
      admin
        .from('schedule_jobs')
        .select('*, customer:customers(company_name), tag_links:schedule_job_tag_links(tag:schedule_job_tags(id, name, color, description, is_active))')
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart)
        .order('start_date')
        .order('job_reference'),
      admin
        .from('schedule_job_tags')
        .select('id, name, color, description, is_active')
        .eq('is_active', true)
        .order('name'),
      admin
        .from('schedule_visits')
        .select('*')
        .gte('starts_at', `${weekStart}T00:00:00.000Z`)
        .lte('starts_at', `${weekEnd}T23:59:59.999Z`)
        .order('starts_at'),
      admin
        .from('schedule_employee_assignments')
        .select('*')
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd),
      admin
        .from('schedule_plant_assignments')
        .select('*')
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd),
      admin
        .from('profiles')
        .select('id, full_name, employee_id, team_id, is_placeholder, team:org_teams!profiles_team_id_fkey(name)')
        .eq('is_placeholder', false)
        .order('full_name'),
      admin
        .from('plant')
        .select('id, plant_id, nickname, make, model, status')
        .neq('status', 'retired')
        .order('plant_id'),
      admin
        .from('schedule_plant_unavailability')
        .select('*')
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart)
        .order('start_date'),
      admin
        .from('absences')
        .select('profile_id, date, end_date')
        .in('status', ['approved', 'processed'])
        .lte('date', weekEnd)
        .or(`end_date.gte.${weekStart},end_date.is.null`),
      admin.from('employee_work_shifts').select('*'),
    ]);

  const results = [
    jobsResult,
    tagsResult,
    visitsResult,
    employeeAssignmentsResult,
    plantAssignmentsResult,
    employeesResult,
    plantResult,
    blocksResult,
    absencesResult,
    shiftsResult,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const jobs = ((jobsResult.data || []) as Array<Record<string, unknown>>).map(mapJob);
  const visits = (visitsResult.data || []) as ScheduleVisit[];
  const employeeRows = (employeeAssignmentsResult.data || []) as Array<Record<string, unknown>>;
  const plantRows = (plantAssignmentsResult.data || []) as Array<Record<string, unknown>>;
  const employees = ((employeesResult.data || []) as Array<Record<string, unknown>>).map(mapEmployee);
  const plants = ((plantResult.data || []) as Array<Record<string, unknown>>).map(mapPlant);
  const blocks = (blocksResult.data || []) as Array<{
    plant_id: string;
    start_date: string;
    end_date: string;
    reason: string;
  }>;
  const absences = (absencesResult.data || []) as Array<{
    profile_id: string;
    date: string;
    end_date: string | null;
  }>;
  const shifts = new Map(
    ((shiftsResult.data || []) as Array<Record<string, unknown>>).map((row) => [
      String(row.profile_id),
      row as Record<string, boolean>,
    ])
  );
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const plantsById = new Map(plants.map((plant) => [plant.id, plant]));
  const visitsById = new Map(visits.map((visit) => [visit.id, visit]));

  const employeeAssignments: ScheduleEmployeeAssignment[] = employeeRows.map((row) => ({
    ...normalizeBaseAssignment(row),
    resource_type: 'employee',
    profile_id: String(row.profile_id),
    employee: employeesById.get(String(row.profile_id)) || null,
    visit: visitsById.get(String(row.visit_id)) || null,
    conflicts: buildEmployeeAssignmentConflicts(row, employeeRows, jobsById, absences, shifts, visitsById),
  }));
  const plantAssignments: SchedulePlantAssignment[] = plantRows.map((row) => ({
    ...normalizeBaseAssignment(row),
    resource_type: 'plant',
    plant_id: String(row.plant_id),
    plant: plantsById.get(String(row.plant_id)) || null,
    visit: visitsById.get(String(row.visit_id)) || null,
    conflicts: buildPlantAssignmentConflicts(row, plantRows, jobsById, plantsById, blocks, visitsById),
  }));

  return {
    week: { start: weekStart, end: weekEnd },
    jobs,
    tags: ((tagsResult.data || []) as Array<Record<string, unknown>>).map(normalizeScheduleJobTag),
    visits,
    assignments: [...employeeAssignments, ...plantAssignments],
    resources: { employees, plant: plants },
    plant_unavailability: (blocksResult.data || []) as SchedulingBoardPayload['plant_unavailability'],
  };
}

export async function loadSchedulingSelf(
  admin: SupabaseClient,
  userId: string,
  weekStart: string,
  weekEnd: string
): Promise<SchedulingSelfPayload> {
  const employeeResult = await admin
    .from('schedule_employee_assignments')
    .select('*')
    .eq('profile_id', userId)
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd)
    .order('work_date');
  if (employeeResult.error) throw employeeResult.error;

  const employeeRows = (employeeResult.data || []) as Array<Record<string, unknown>>;
  const jobIds = Array.from(new Set(employeeRows.map((row) => String(row.job_id))));
  if (jobIds.length === 0) {
    return { week: { start: weekStart, end: weekEnd }, assignments: [], jobs: [], visits: [], plant_assignments: [] };
  }

  const dates = Array.from(new Set(employeeRows.map((row) => String(row.work_date))));
  const [jobsResult, visitsResult, plantAssignmentsResult] = await Promise.all([
    admin
      .from('schedule_jobs')
      .select('*, customer:customers(company_name), tag_links:schedule_job_tag_links(tag:schedule_job_tags(id, name, color, description, is_active))')
      .in('id', jobIds),
    admin
      .from('schedule_visits')
      .select('*')
      .in('job_id', jobIds)
      .gte('starts_at', `${weekStart}T00:00:00.000Z`)
      .lte('starts_at', `${weekEnd}T23:59:59.999Z`),
    admin
      .from('schedule_plant_assignments')
      .select('*, plant:plant(id, plant_id, nickname, make, model, status)')
      .in('job_id', jobIds)
      .in('work_date', dates),
  ]);
  if (jobsResult.error) throw jobsResult.error;
  if (visitsResult.error) throw visitsResult.error;
  if (plantAssignmentsResult.error) throw plantAssignmentsResult.error;

  const visits = (visitsResult.data || []) as ScheduleVisit[];
  const visitsById = new Map(visits.map((visit) => [visit.id, visit]));
  const assignments: ScheduleEmployeeAssignment[] = employeeRows
    .filter((row) => !row.visit_id || visitsById.get(String(row.visit_id))?.status !== 'cancelled')
    .map((row) => ({
      ...normalizeBaseAssignment(row),
      resource_type: 'employee',
      profile_id: userId,
      employee: null,
      visit: visitsById.get(String(row.visit_id)) || null,
      conflicts: [],
    }));
  const plantAssignments: SchedulePlantAssignment[] = (
    (plantAssignmentsResult.data || []) as Array<Record<string, unknown>>
  )
    .filter((row) => !row.visit_id || visitsById.get(String(row.visit_id))?.status !== 'cancelled')
    .map((row) => {
      const plant = pickRelation(row.plant as Record<string, unknown> | Array<Record<string, unknown>> | null);
      return {
        ...normalizeBaseAssignment(row),
        resource_type: 'plant',
        plant_id: String(row.plant_id),
        plant: plant ? mapPlant(plant) : null,
        visit: visitsById.get(String(row.visit_id)) || null,
        conflicts: [],
      };
    });

  return {
    week: { start: weekStart, end: weekEnd },
    assignments,
    jobs: ((jobsResult.data || []) as Array<Record<string, unknown>>).map(mapJob),
    visits,
    plant_assignments: plantAssignments,
  };
}

export function assignmentsForJobDate(
  assignments: ScheduleAssignment[],
  jobId: string,
  workDate: string
): ScheduleAssignment[] {
  return assignments.filter(
    (assignment) => assignment.job_id === jobId && assignment.work_date === workDate
  );
}
