import { parseISO } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulingConflict, SchedulingConflictCode } from '@/types/scheduling';

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

interface JobRelation {
  job_reference?: string | null;
}

function pickRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function isDateWithinRange(workDate: string, startDate: string, endDate: string): boolean {
  return workDate >= startDate && workDate <= endDate;
}

export function isEmployeeWorkingOnDate(
  workDate: string,
  shift: Record<string, boolean> | null | undefined
): boolean {
  if (!shift) return true;
  const day = DAY_NAMES[parseISO(workDate).getDay()];
  return shift[`${day}_am`] === true || shift[`${day}_pm`] === true;
}

export function conflictCodes(conflicts: SchedulingConflict[]): SchedulingConflictCode[] {
  return Array.from(new Set(conflicts.map((conflict) => conflict.code)));
}

export async function detectEmployeeConflicts(
  admin: SupabaseClient,
  input: { jobId: string; workDate: string; profileId: string }
): Promise<SchedulingConflict[]> {
  const [assignmentResult, absenceResult, shiftResult] = await Promise.all([
    admin
      .from('schedule_employee_assignments')
      .select('job_id, job:schedule_jobs(job_reference)')
      .eq('profile_id', input.profileId)
      .eq('work_date', input.workDate)
      .neq('job_id', input.jobId),
    admin
      .from('absences')
      .select('id')
      .eq('profile_id', input.profileId)
      .in('status', ['approved', 'processed'])
      .lte('date', input.workDate)
      .or(`end_date.gte.${input.workDate},end_date.is.null`)
      .limit(1),
    admin
      .from('employee_work_shifts')
      .select(`
        monday_am, monday_pm, tuesday_am, tuesday_pm, wednesday_am, wednesday_pm,
        thursday_am, thursday_pm, friday_am, friday_pm, saturday_am, saturday_pm,
        sunday_am, sunday_pm
      `)
      .eq('profile_id', input.profileId)
      .maybeSingle(),
  ]);

  if (assignmentResult.error) throw assignmentResult.error;
  if (absenceResult.error) throw absenceResult.error;
  if (shiftResult.error) throw shiftResult.error;

  const conflicts: SchedulingConflict[] = [];
  for (const row of assignmentResult.data || []) {
    const job = pickRelation(row.job as JobRelation | JobRelation[] | null);
    conflicts.push({
      code: 'employee_double_booked',
      severity: 'warning',
      conflictingJobId: row.job_id,
      conflictingJobReference: job?.job_reference || undefined,
      message: `Employee is already assigned to ${job?.job_reference || 'another job'} on this date.`,
    });
  }

  if ((absenceResult.data || []).length > 0) {
    conflicts.push({
      code: 'employee_absent',
      severity: 'warning',
      message: 'Employee has an approved or processed absence on this date.',
    });
  }

  if (!isEmployeeWorkingOnDate(input.workDate, shiftResult.data as Record<string, boolean> | null)) {
    conflicts.push({
      code: 'employee_off_shift',
      severity: 'warning',
      message: 'Employee is not scheduled to work on this day.',
    });
  }

  return conflicts;
}

export async function detectPlantConflicts(
  admin: SupabaseClient,
  input: { jobId: string; workDate: string; plantId: string }
): Promise<SchedulingConflict[]> {
  const [assignmentResult, plantResult, unavailabilityResult] = await Promise.all([
    admin
      .from('schedule_plant_assignments')
      .select('job_id, job:schedule_jobs(job_reference)')
      .eq('plant_id', input.plantId)
      .eq('work_date', input.workDate)
      .neq('job_id', input.jobId),
    admin
      .from('plant')
      .select('status')
      .eq('id', input.plantId)
      .maybeSingle(),
    admin
      .from('schedule_plant_unavailability')
      .select('reason')
      .eq('plant_id', input.plantId)
      .lte('start_date', input.workDate)
      .gte('end_date', input.workDate),
  ]);

  if (assignmentResult.error) throw assignmentResult.error;
  if (plantResult.error) throw plantResult.error;
  if (unavailabilityResult.error) throw unavailabilityResult.error;

  const conflicts: SchedulingConflict[] = [];
  for (const row of assignmentResult.data || []) {
    const job = pickRelation(row.job as JobRelation | JobRelation[] | null);
    conflicts.push({
      code: 'plant_double_booked',
      severity: 'warning',
      conflictingJobId: row.job_id,
      conflictingJobReference: job?.job_reference || undefined,
      message: `Plant is already assigned to ${job?.job_reference || 'another job'} on this date.`,
    });
  }

  if (plantResult.data?.status !== 'active') {
    conflicts.push({
      code: 'plant_inactive',
      severity: 'warning',
      message: `Plant status is ${plantResult.data?.status || 'unknown'}.`,
    });
  }

  for (const block of unavailabilityResult.data || []) {
    conflicts.push({
      code: 'plant_unavailable',
      severity: 'warning',
      message: `Plant is unavailable: ${block.reason}.`,
    });
  }

  return conflicts;
}
