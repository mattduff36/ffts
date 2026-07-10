import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchCurrentWorkShift, fetchEmployeeWorkShift } from '@/lib/client/work-shifts';
import { useAbsenceRealtime } from '@/lib/hooks/useRealtime';
import { 
  AbsenceInsert, 
  AbsenceUpdate, 
  AbsenceReason,
  AbsenceWithRelations,
  AbsenceSummary,
  FinancialYear
} from '@/types/absence';
import { fetchCarryoverMapForFinancialYear, getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { getCurrentFinancialYear, getFinancialYear } from '@/lib/utils/date';
import { calculateDurationDays } from '@/lib/utils/date';
import { isClosedFinancialYearDate } from '@/lib/services/absence-archive';
import { getErrorMessage, shouldLogAbsenceManageError } from '@/lib/utils/absence-error-handling';
import { getCrossFinancialYearAbsenceError } from '@/lib/utils/absence-financial-year';
import { ANNUAL_LEAVE_MIN_REMAINING_DAYS } from '@/lib/utils/annual-leave';
import {
  canEmployeeSelfBookAbsenceRange,
  getEmployeeAbsenceSelfServiceDeadlineForRange,
} from '@/lib/utils/absence-self-service-deadline';
import { isAdminRole } from '@/lib/utils/role-access';
import { useAuth } from '@/lib/hooks/useAuth';
import { isTrainingReasonName } from '@/lib/utils/timesheet-off-days';
import {
  applyApprovedAbsenceTimesheetEffects,
  assertNoLockedAbsenceTimesheetImpacts,
  removeAbsenceFromTimesheetRows,
  resolveAbsenceTimesheetImpacts,
} from '@/lib/utils/absence-timesheet-impact';

const ANNUAL_LEAVE_REASON_NAME = 'annual leave';

interface AbsenceValidationShape {
  profile_id: string;
  date: string;
  end_date: string | null;
  reason_id: string;
  duration_days: number;
  is_half_day: boolean;
  half_day_session: 'AM' | 'PM' | null;
  status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled';
  notes: string | null;
}

type ProcessedAbsenceChangeAction = 'updated' | 'cancelled' | 'deleted';

interface ProcessedAbsenceClientSnapshot {
  id: string;
  profileId: string;
  employeeName: string | null;
  reasonName: string | null;
  startDate: string;
  endDate: string | null;
  status: string | null;
}

interface AbsenceNotificationRelationShape extends AbsenceValidationShape {
  id?: string;
  allow_timesheet_work_on_leave?: boolean | null;
  absence_reasons?: { name: string | null } | Array<{ name: string | null }> | null;
  profile?: { full_name: string | null } | Array<{ full_name: string | null }> | null;
}

interface AbsenceQueryOptions {
  enabled?: boolean;
}

function pickSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function buildProcessedAbsenceSnapshot(
  id: string,
  absence: AbsenceNotificationRelationShape
): ProcessedAbsenceClientSnapshot {
  return {
    id,
    profileId: absence.profile_id,
    employeeName: pickSingleRelation(absence.profile)?.full_name || null,
    reasonName: pickSingleRelation(absence.absence_reasons)?.name || null,
    startDate: absence.date,
    endDate: absence.end_date,
    status: absence.status,
  };
}

function getChangedAbsenceFields(
  before: AbsenceNotificationRelationShape,
  after: Partial<AbsenceNotificationRelationShape>,
  fields: Array<keyof AbsenceNotificationRelationShape>
): string[] {
  return fields.filter((field) => before[field] !== after[field]).map(String);
}

async function notifyProcessedAbsenceChange(input: {
  absenceId: string;
  action: ProcessedAbsenceChangeAction;
  previousAbsence: ProcessedAbsenceClientSnapshot;
  changedFields?: string[];
}): Promise<void> {
  if (input.previousAbsence.status !== 'processed') return;

  try {
    const response = await fetch(`/api/absence/${input.absenceId}/processed-change-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: input.action,
        previousAbsence: input.previousAbsence,
        changedFields: input.changedFields || [],
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      console.error('Failed to notify processed absence change:', message);
    }
  } catch (error) {
    console.error('Failed to notify processed absence change:', error);
  }
}

function hasFilterValue(value?: string): value is string {
  return !!value && value.trim().length > 0;
}

export function useAbsenceRealtimeQueryInvalidation(enabled = true) {
  const queryClient = useQueryClient();

  const invalidateAbsenceQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['absences'] });
    queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
  }, [queryClient]);

  useAbsenceRealtime((payload) => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      invalidateAbsenceQueries();
    }
  }, enabled);
}

async function assertAbsenceFinancialYearOpen(
  supabase: ReturnType<typeof createClient>,
  id: string,
  options?: { treatMissingAsNoop?: boolean }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('absences')
    .select('date')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data?.date) {
    if (options?.treatMissingAsNoop) return false;
    throw new Error('Absence record not found');
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error('Not authenticated');

  const { data: actorProfile, error: actorProfileError } = await supabase
    .from('profiles')
    .select('super_admin, role:roles(name, role_class, is_manager_admin, is_super_admin)')
    .eq('id', authData.user.id)
    .single();

  if (actorProfileError) throw actorProfileError;

  const typedActorProfile = actorProfile as {
    super_admin?: boolean | null;
    role?: {
      name?: string | null;
      role_class?: 'admin' | 'manager' | 'employee' | null;
      is_manager_admin?: boolean | null;
      is_super_admin?: boolean | null;
    } | null;
  } | null;
  const actorRole = typedActorProfile?.role || null;
  const actorIsManagerOrHigher = Boolean(
    typedActorProfile?.super_admin ||
      actorRole?.is_super_admin ||
      isAdminRole(actorRole) ||
      actorRole?.is_manager_admin
  );
  const targetFinancialYearStartYear = getFinancialYear(new Date(`${data.date}T00:00:00`)).start.getFullYear();

  const { data: closureState, error: closureError } = await supabase
    .from('absence_financial_year_closures')
    .select('id')
    .eq('financial_year_start_year', targetFinancialYearStartYear)
    .maybeSingle();

  if (closureError) throw closureError;

  if (closureState?.id && !actorIsManagerOrHigher) {
    throw new Error('This financial year is closed for employee bookings. Please contact your manager.');
  }

  if (isClosedFinancialYearDate(data.date) && !actorIsManagerOrHigher) {
    throw new Error('This absence is in a closed financial year and is read-only');
  }

  return true;
}

async function resolveAbsenceDuration(
  absence: AbsenceValidationShape,
  currentUserId?: string
): Promise<AbsenceValidationShape> {
  const resolvedAbsence = { ...absence };

  if (!resolvedAbsence.profile_id || !resolvedAbsence.date) {
    return resolvedAbsence;
  }

  try {
    const workShift =
      currentUserId && currentUserId === resolvedAbsence.profile_id
        ? await fetchCurrentWorkShift()
        : await fetchEmployeeWorkShift(resolvedAbsence.profile_id);

    resolvedAbsence.duration_days = calculateDurationDays(
      new Date(`${resolvedAbsence.date}T00:00:00`),
      resolvedAbsence.end_date ? new Date(`${resolvedAbsence.end_date}T00:00:00`) : null,
      resolvedAbsence.is_half_day === true,
      {
        pattern: workShift.pattern,
        halfDaySession: resolvedAbsence.half_day_session || null,
      }
    );
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to resolve work shift duration');
    if (shouldLogAbsenceManageError(error)) {
      console.error('Error resolving work shift duration, falling back to provided duration:', error);
    } else {
      console.warn('Skipping work shift duration resolution, using provided duration:', message);
    }
  }

  return resolvedAbsence;
}

async function assertNoAbsenceConflictBeforeSave(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceValidationShape,
  excludeAbsenceId?: string
): Promise<void> {
  const profileId = absence.profile_id;
  const startDate = absence.date;
  const endDate = absence.end_date || absence.date;
  const nextStatus = absence.status;
  const isHalfDay = absence.is_half_day;
  const halfDaySession = absence.half_day_session || null;

  if (!profileId || !startDate) {
    return;
  }

  if (nextStatus !== 'approved' && nextStatus !== 'processed' && nextStatus !== 'pending') {
    return;
  }

  if (isHalfDay && !halfDaySession) {
    throw new Error('Half-day absences require AM or PM session');
  }
  if (isHalfDay && endDate !== startDate) {
    throw new Error('Half-day absences must be a single day');
  }

  let query = supabase
    .from('absences')
    .select('date, end_date, is_half_day, half_day_session')
    .eq('profile_id', profileId)
    .in('status', ['approved', 'processed', 'pending'])
    .lte('date', endDate);

  if (excludeAbsenceId) {
    query = query.neq('id', excludeAbsenceId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const existingRows = (data || []) as Array<{
    date: string;
    end_date: string | null;
    is_half_day: boolean;
    half_day_session: 'AM' | 'PM' | null;
  }>;

  const overlappingRows = existingRows.filter((row) => {
    const rowEnd = row.end_date || row.date;
    return row.date <= endDate && rowEnd >= startDate;
  });

  if (!isHalfDay && overlappingRows.length > 0) {
    throw new Error('This absence conflicts with an existing approved/processed/pending booking');
  }

  if (!isHalfDay) {
    return;
  }

  for (const row of overlappingRows) {
    const rowEnd = row.end_date || row.date;
    const sameSingleDay = row.date === startDate && rowEnd === startDate;
    if (!sameSingleDay) {
      throw new Error('This half-day conflicts with an existing multi-day or different-day booking');
    }
    if (!row.is_half_day) {
      throw new Error('This half-day conflicts with an existing full-day booking');
    }
    if (row.half_day_session === halfDaySession) {
      throw new Error(`This ${halfDaySession} half-day is already booked`);
    }
  }
}

async function buildValidatedAbsence(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceValidationShape,
  options?: { excludeAbsenceId?: string; currentUserId?: string }
): Promise<AbsenceValidationShape> {
  const resolvedAbsence = await resolveAbsenceDuration(absence, options?.currentUserId);
  const crossFinancialYearError = getCrossFinancialYearAbsenceError(
    resolvedAbsence.date,
    resolvedAbsence.end_date
  );
  if (crossFinancialYearError) {
    throw new Error(crossFinancialYearError);
  }
  await assertNoAbsenceConflictBeforeSave(supabase, resolvedAbsence, options?.excludeAbsenceId);
  return resolvedAbsence;
}

async function getAnnualLeaveReasonIdByReason(
  supabase: ReturnType<typeof createClient>,
  reasonId: string
): Promise<string | null> {
  const { data: reason, error: reasonError } = await supabase
    .from('absence_reasons')
    .select('id, name')
    .eq('id', reasonId)
    .single();

  if (reasonError) {
    throw reasonError;
  }

  return reason?.name?.trim().toLowerCase() === ANNUAL_LEAVE_REASON_NAME ? reason.id : null;
}

async function getAbsenceReasonDetailsByReason(
  supabase: ReturnType<typeof createClient>,
  reasonId: string
): Promise<{ reasonName: string; isPaid: boolean; isTraining: boolean }> {
  const { data: reason, error: reasonError } = await supabase
    .from('absence_reasons')
    .select('name, is_paid')
    .eq('id', reasonId)
    .single();

  if (reasonError) throw reasonError;
  const reasonName = reason?.name || 'Approved Leave';
  return {
    reasonName,
    isPaid: Boolean(reason?.is_paid),
    isTraining: isTrainingReasonName(reasonName),
  };
}

async function resolveActiveAbsenceTimesheetImpacts(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceValidationShape
) {
  if (!['approved', 'processed'].includes(absence.status)) return [];

  return resolveAbsenceTimesheetImpacts(supabase, {
    profileId: absence.profile_id,
    startDate: absence.date,
    endDate: absence.end_date,
    isHalfDay: absence.is_half_day,
  });
}

async function applyApprovedLeaveTimesheetEffects(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceValidationShape & { id?: string; allow_timesheet_work_on_leave?: boolean | null },
  actorUserId: string,
  action = 'Approved'
): Promise<void> {
  if (absence.status !== 'approved' || !absence.id) return;

  const reason = await getAbsenceReasonDetailsByReason(supabase, absence.reason_id);
  await applyApprovedAbsenceTimesheetEffects(supabase, {
    absenceId: absence.id,
    actorUserId,
    profileId: absence.profile_id,
    startDate: absence.date,
    endDate: absence.end_date,
    isHalfDay: absence.is_half_day,
    halfDaySession: absence.half_day_session,
    allowTimesheetWorkOnLeave: absence.allow_timesheet_work_on_leave,
    returnReason: action,
    ...reason,
  });
}

async function assertAbsenceTimesheetChangesUnlocked(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceValidationShape
): Promise<void> {
  const impacts = await resolveActiveAbsenceTimesheetImpacts(supabase, absence);
  assertNoLockedAbsenceTimesheetImpacts(impacts);
}

async function removeLeaveTimesheetEffects(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceValidationShape & { id: string; allow_timesheet_work_on_leave?: boolean | null },
  actorUserId: string
): Promise<void> {
  const reason = await getAbsenceReasonDetailsByReason(supabase, absence.reason_id);
  const impacts = await resolveActiveAbsenceTimesheetImpacts(supabase, absence);
  assertNoLockedAbsenceTimesheetImpacts(impacts);

  await removeAbsenceFromTimesheetRows(supabase, {
    absenceId: absence.id,
    actorUserId,
    profileId: absence.profile_id,
    startDate: absence.date,
    endDate: absence.end_date,
    isHalfDay: absence.is_half_day,
    halfDaySession: absence.half_day_session,
    allowTimesheetWorkOnLeave: absence.allow_timesheet_work_on_leave,
    impacts,
    ...reason,
  });
}

async function assertAnnualLeaveAllowanceAvailable(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceValidationShape,
  excludeAbsenceId?: string
): Promise<void> {
  if (!['pending', 'approved', 'processed'].includes(absence.status)) {
    return;
  }

  if (!absence.reason_id || !absence.profile_id || (absence.duration_days || 0) <= 0) {
    return;
  }

  const annualLeaveReasonId = await getAnnualLeaveReasonIdByReason(supabase, absence.reason_id);
  if (!annualLeaveReasonId) {
    return;
  }

  const requestDate = new Date(`${absence.date}T00:00:00`);
  const financialYear = getFinancialYear(requestDate);
  const financialYearStartYear = financialYear.start.getFullYear();

  const [{ data: profile, error: profileError }, carryoverByProfile] = await Promise.all([
    supabase
      .from('profiles')
      .select('annual_holiday_allowance_days')
      .eq('id', absence.profile_id)
      .single(),
    fetchCarryoverMapForFinancialYear(supabase, financialYearStartYear, [absence.profile_id]),
  ]);

  if (profileError) {
    throw profileError;
  }

  const allowance = getEffectiveAllowance(
    profile?.annual_holiday_allowance_days,
    carryoverByProfile.get(absence.profile_id) || 0
  );

  let query = supabase
    .from('absences')
    .select('duration_days')
    .eq('profile_id', absence.profile_id)
    .eq('reason_id', annualLeaveReasonId)
    .in('status', ['approved', 'processed', 'pending'])
    .gte('date', financialYear.start.toISOString().split('T')[0])
    .lte('date', financialYear.end.toISOString().split('T')[0]);

  if (excludeAbsenceId) {
    query = query.neq('id', excludeAbsenceId);
  }

  const { data: annualAbsences, error: annualAbsencesError } = await query;
  if (annualAbsencesError) {
    throw annualAbsencesError;
  }

  const usedOrPending = (annualAbsences || []).reduce(
    (sum: number, entry: { duration_days: number | null }) => sum + (entry.duration_days || 0),
    0
  );

  if (allowance - usedOrPending - absence.duration_days < ANNUAL_LEAVE_MIN_REMAINING_DAYS) {
    throw new Error('Annual leave request exceeds available allowance');
  }
}

// ============================================================================
// ABSENCE REASONS HOOKS
// ============================================================================

/**
 * Get all active absence reasons (for employees)
 */
export function useAbsenceReasons(options?: AbsenceQueryOptions) {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absence-reasons'],
    enabled: options?.enabled !== false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data as AbsenceReason[];
    },
  });
}

/**
 * Get all absence reasons (for admins - includes inactive)
 */
export function useAllAbsenceReasons() {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absence-reasons-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return data as AbsenceReason[];
    },
  });
}

// ============================================================================
// ABSENCE HOOKS - USER
// ============================================================================

/**
 * Get absences for current user in the current financial year
 */
export function useAbsencesForCurrentUser() {
  const { start, end } = getCurrentFinancialYear();
  
  return useAbsencesForUserFinancialYear({
    start,
    end,
  });
}

/**
 * Get absences for current user in a selected financial year
 */
export function useAbsencesForUserFinancialYear(
  financialYear?: Pick<FinancialYear, 'start' | 'end'>,
  options?: AbsenceQueryOptions
) {
  const { profile } = useAuth();
  const fallback = getCurrentFinancialYear();
  const start = financialYear?.start || fallback.start;
  const end = financialYear?.end || fallback.end;
  const profileId = profile?.id || null;

  return useAllAbsences(
    Boolean(profileId) && options?.enabled !== false
      ? {
          profileId: profileId!,
          dateFrom: start.toISOString().split('T')[0],
          dateTo: end.toISOString().split('T')[0],
          includeArchived: true,
          matchOverlappingDateRange: true,
        }
      : undefined
  );
}

/**
 * Get absence summary for current user in the current financial year
 */
export function useAbsenceSummaryForCurrentUser() {
  const { start, end } = getCurrentFinancialYear();
  
  return useAbsenceSummaryForUserFinancialYear({
    start,
    end,
  });
}

/**
 * Get absence summary for current user in a selected financial year
 */
export function useAbsenceSummaryForUserFinancialYear(
  financialYear?: Pick<FinancialYear, 'start' | 'end'>,
  options?: AbsenceQueryOptions
) {
  const { profile } = useAuth();
  const supabase = createClient();
  const fallback = getCurrentFinancialYear();
  const start = financialYear?.start || fallback.start;
  const end = financialYear?.end || fallback.end;
  const profileId = profile?.id || null;
  
  return useQuery({
    queryKey: ['absence-summary', profileId, start.toISOString(), end.toISOString()],
    enabled: Boolean(profileId) && options?.enabled !== false,
    queryFn: async () => {
      const financialYearStartYear = start.getFullYear();

      const [{ data: profile, error: profileError }, carryoverByProfile] = await Promise.all([
        supabase
          .from('profiles')
          .select('annual_holiday_allowance_days')
          .eq('id', profileId!)
          .single(),
        fetchCarryoverMapForFinancialYear(supabase, financialYearStartYear, [profileId!]),
      ]);

      if (profileError) throw profileError;

      const allowance = getEffectiveAllowance(
        profile?.annual_holiday_allowance_days,
        carryoverByProfile.get(profileId!) || 0
      );

      // Get Annual Leave reason ID
      const { data: annualLeaveReason, error: reasonError } = await supabase
        .from('absence_reasons')
        .select('id')
        .ilike('name', ANNUAL_LEAVE_REASON_NAME)
        .single();
      
      if (reasonError || !annualLeaveReason) {
        return {
          allowance,
          approved_taken: 0,
          pending_total: 0,
          remaining: allowance,
        } as AbsenceSummary;
      }
      
      // Get absences within financial year
      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('status, duration_days, reason_id')
        .eq('profile_id', profileId!)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]);
      
      if (absencesError) throw absencesError;
      const typedAbsences = (absences || []) as Array<{
        status: string;
        duration_days: number | null;
        reason_id: string | null;
      }>;
      
      // Calculate approved and pending for Annual Leave only
      const approved_taken = typedAbsences
        .filter((a) => (a.status === 'approved' || a.status === 'processed') && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const pending_total = typedAbsences
        .filter((a) => a.status === 'pending' && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const remaining = allowance - approved_taken - pending_total;
      
      return {
        allowance,
        approved_taken,
        pending_total,
        remaining,
      } as AbsenceSummary;
    },
  });
}

/**
 * Create a new absence request
 */
export function useCreateAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (absence: AbsenceInsert) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: actorProfile, error: actorProfileError } = await supabase
        .from('profiles')
        .select('super_admin, role:roles(name, role_class, is_manager_admin, is_super_admin)')
        .eq('id', user.id)
        .single();
      if (actorProfileError) throw actorProfileError;

      const typedActorProfile = actorProfile as {
        super_admin?: boolean | null;
        role?: {
          name?: string | null;
          role_class?: 'admin' | 'manager' | 'employee' | null;
          is_manager_admin?: boolean | null;
          is_super_admin?: boolean | null;
        } | null;
      } | null;
      const actorRole = typedActorProfile?.role || null;
      const actorIsManagerOrHigher = Boolean(
        typedActorProfile?.super_admin ||
          actorRole?.is_super_admin ||
          isAdminRole(actorRole) ||
          actorRole?.is_manager_admin
      );
      const requestFinancialYearStartYear = getFinancialYear(new Date(`${absence.date}T00:00:00`)).start.getFullYear();
      const { data: closureState, error: closureError } = await supabase
        .from('absence_financial_year_closures')
        .select('id')
        .eq('financial_year_start_year', requestFinancialYearStartYear)
        .maybeSingle();
      if (closureError) throw closureError;
      if (closureState?.id && !actorIsManagerOrHigher) {
        throw new Error('This financial year is closed for employee bookings. Please contact your manager.');
      }
      if (isClosedFinancialYearDate(absence.date) && !actorIsManagerOrHigher) {
        throw new Error('This absence is in a closed financial year and is read-only');
      }
      if (
        !actorIsManagerOrHigher &&
        !canEmployeeSelfBookAbsenceRange(absence.date, absence.end_date ?? null)
      ) {
        const deadline = getEmployeeAbsenceSelfServiceDeadlineForRange(absence.date, absence.end_date ?? null);
        throw new Error(`Absences can only be self-booked until the Monday after the affected week (${deadline}). Please contact your manager.`);
      }

      const validatedAbsence = await buildValidatedAbsence(
        supabase,
        {
          profile_id: absence.profile_id,
          date: absence.date,
          end_date: absence.end_date ?? null,
          reason_id: absence.reason_id,
          duration_days: absence.duration_days,
          is_half_day: absence.is_half_day ?? false,
          half_day_session: absence.half_day_session ?? null,
          status: absence.status ?? 'pending',
          notes: absence.notes ?? null,
        },
        { currentUserId: user.id }
      );

      await assertAnnualLeaveAllowanceAvailable(supabase, validatedAbsence);
      if (!actorIsManagerOrHigher) {
        await assertAbsenceTimesheetChangesUnlocked(supabase, validatedAbsence);
      }

      const { data, error } = await supabase
        .from('absences')
        .insert({
          ...absence,
          date: validatedAbsence.date,
          end_date: validatedAbsence.end_date,
          reason_id: validatedAbsence.reason_id,
          duration_days: validatedAbsence.duration_days,
          is_half_day: validatedAbsence.is_half_day,
          half_day_session: validatedAbsence.half_day_session,
          status: validatedAbsence.status,
          notes: validatedAbsence.notes,
        })
        .select()
        .single();
      
      if (error) throw error;
      await applyApprovedLeaveTimesheetEffects(
        supabase,
        {
          ...validatedAbsence,
          id: data.id,
          allow_timesheet_work_on_leave: data.allow_timesheet_work_on_leave,
        },
        user.id,
        'Approved'
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Update an absence
 */
export function useUpdateAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AbsenceUpdate }) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data: existingAbsence, error: existingAbsenceError } = await supabase
        .from('absences')
        .select(
          `
          profile_id,
          date,
          end_date,
          reason_id,
          duration_days,
          is_half_day,
          half_day_session,
          status,
          notes,
          is_bank_holiday,
          auto_generated,
          bulk_batch_id,
          allow_timesheet_work_on_leave,
          absence_reasons(name),
          profile:profiles!absences_profile_id_fkey(full_name)
        `
        )
        .eq('id', id)
        .single();

      if (existingAbsenceError) throw existingAbsenceError;
      const previousProcessedAbsenceSnapshot = buildProcessedAbsenceSnapshot(
        id,
        existingAbsence as unknown as AbsenceNotificationRelationShape
      );

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const hasUpdateField = <K extends keyof AbsenceUpdate>(key: K) =>
        Object.prototype.hasOwnProperty.call(updates, key);
      const resolveUpdatedField = <
        K extends keyof AbsenceUpdate,
        TExisting
      >(
        key: K,
        fallback: TExisting
      ) => (hasUpdateField(key) ? (updates[key] as TExisting) : fallback);
      const hasOverrideUpdate = hasUpdateField('allow_timesheet_work_on_leave');
      const updateKeys = Object.keys(updates);
      const hasOnlyOverrideUpdate = updateKeys.length > 0 && updateKeys.every((key) => key === 'allow_timesheet_work_on_leave');
      const isProtectedConfirmedBooking =
        (existingAbsence.status === 'approved' || existingAbsence.status === 'processed') &&
        (existingAbsence.is_bank_holiday || existingAbsence.auto_generated || Boolean(existingAbsence.bulk_batch_id));
      const finalReasonId = resolveUpdatedField('reason_id', existingAbsence.reason_id);
      const finalAllowTimesheetWorkOnLeave = resolveUpdatedField(
        'allow_timesheet_work_on_leave',
        existingAbsence.allow_timesheet_work_on_leave
      );
      const annualLeaveReasonId = await getAnnualLeaveReasonIdByReason(supabase, finalReasonId);
      const isFinalReasonAnnualLeave = annualLeaveReasonId === finalReasonId;

      if (isProtectedConfirmedBooking && !hasOverrideUpdate) {
        throw new Error('Protected confirmed bookings can only update the timesheet work override');
      }

      if (isProtectedConfirmedBooking && !hasOnlyOverrideUpdate) {
        throw new Error('Protected confirmed bookings only allow timesheet work override updates');
      }

      if (finalAllowTimesheetWorkOnLeave && !isFinalReasonAnnualLeave) {
        throw new Error('Timesheet work override is only available for Annual leave bookings');
      }

      if (hasOnlyOverrideUpdate) {
        await assertAbsenceTimesheetChangesUnlocked(supabase, existingAbsence as AbsenceValidationShape);

        const { data, error } = await supabase
          .from('absences')
          .update({
            allow_timesheet_work_on_leave: Boolean(finalAllowTimesheetWorkOnLeave),
          })
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;
        await removeLeaveTimesheetEffects(
          supabase,
          {
            ...(existingAbsence as AbsenceValidationShape),
            id,
            allow_timesheet_work_on_leave: existingAbsence.allow_timesheet_work_on_leave,
          },
          user.id
        );
        await applyApprovedLeaveTimesheetEffects(
          supabase,
          {
            ...(existingAbsence as AbsenceValidationShape),
            id: data.id,
            allow_timesheet_work_on_leave: data.allow_timesheet_work_on_leave,
          },
          user.id,
          'Updated'
        );
        await notifyProcessedAbsenceChange({
          absenceId: id,
          action: 'updated',
          previousAbsence: previousProcessedAbsenceSnapshot,
          changedFields: getChangedAbsenceFields(
            existingAbsence as unknown as AbsenceNotificationRelationShape,
            data as unknown as Partial<AbsenceNotificationRelationShape>,
            ['allow_timesheet_work_on_leave']
          ),
        });
        return data;
      }

      const validatedAbsence = await buildValidatedAbsence(
        supabase,
        {
          profile_id: resolveUpdatedField('profile_id', existingAbsence.profile_id),
          date: resolveUpdatedField('date', existingAbsence.date),
          end_date: resolveUpdatedField('end_date', existingAbsence.end_date),
          reason_id: resolveUpdatedField('reason_id', existingAbsence.reason_id),
          duration_days: resolveUpdatedField('duration_days', existingAbsence.duration_days),
          is_half_day: Boolean(resolveUpdatedField('is_half_day', existingAbsence.is_half_day)),
          half_day_session: resolveUpdatedField('half_day_session', existingAbsence.half_day_session),
          status: resolveUpdatedField('status', existingAbsence.status),
          notes: resolveUpdatedField('notes', existingAbsence.notes),
        },
        {
          excludeAbsenceId: id,
          currentUserId: user?.id,
        }
      );

      await assertAnnualLeaveAllowanceAvailable(supabase, validatedAbsence, id);
      await assertAbsenceTimesheetChangesUnlocked(supabase, existingAbsence as AbsenceValidationShape);
      await assertAbsenceTimesheetChangesUnlocked(supabase, validatedAbsence);

      const { data, error } = await supabase
        .from('absences')
        .update({
          ...updates,
          profile_id: validatedAbsence.profile_id,
          date: validatedAbsence.date,
          end_date: validatedAbsence.end_date,
          reason_id: validatedAbsence.reason_id,
          duration_days: validatedAbsence.duration_days,
          is_half_day: validatedAbsence.is_half_day,
          half_day_session: validatedAbsence.half_day_session,
          status: validatedAbsence.status,
          notes: validatedAbsence.notes,
          allow_timesheet_work_on_leave: finalAllowTimesheetWorkOnLeave,
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      await removeLeaveTimesheetEffects(
        supabase,
        {
          ...(existingAbsence as AbsenceValidationShape),
          id,
          allow_timesheet_work_on_leave: existingAbsence.allow_timesheet_work_on_leave,
        },
        user.id
      );
      await applyApprovedLeaveTimesheetEffects(
        supabase,
        {
          ...validatedAbsence,
          id: data.id,
          allow_timesheet_work_on_leave: data.allow_timesheet_work_on_leave,
        },
        user.id,
        'Updated'
      );
      await notifyProcessedAbsenceChange({
        absenceId: id,
        action: 'updated',
        previousAbsence: previousProcessedAbsenceSnapshot,
        changedFields: getChangedAbsenceFields(
          existingAbsence as unknown as AbsenceNotificationRelationShape,
          data as unknown as Partial<AbsenceNotificationRelationShape>,
          [
            'profile_id',
            'date',
            'end_date',
            'reason_id',
            'duration_days',
            'is_half_day',
            'half_day_session',
            'status',
            'notes',
            'allow_timesheet_work_on_leave',
          ]
        ),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Cancel an absence (user or admin)
 */
export function useCancelAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const canProceed = await assertAbsenceFinancialYearOpen(supabase, id, { treatMissingAsNoop: true });
      if (!canProceed) {
        // Stale UI state: record already removed or unavailable. Treat as an idempotent success.
        return { id, status: 'cancelled' } as const;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: existingAbsence, error: existingAbsenceError } = await supabase
        .from('absences')
        .select(`
          profile_id,
          date,
          end_date,
          reason_id,
          duration_days,
          is_half_day,
          half_day_session,
          status,
          notes,
          allow_timesheet_work_on_leave,
          absence_reasons(name),
          profile:profiles!absences_profile_id_fkey(full_name)
        `)
        .eq('id', id)
        .maybeSingle();

      if (existingAbsenceError) throw existingAbsenceError;
      const previousProcessedAbsenceSnapshot = existingAbsence
        ? buildProcessedAbsenceSnapshot(
            id,
            existingAbsence as unknown as AbsenceNotificationRelationShape
          )
        : null;
      if (existingAbsence) {
        await assertAbsenceTimesheetChangesUnlocked(supabase, existingAbsence as AbsenceValidationShape);
      }

      const { data, error } = await supabase
        .from('absences')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select()
        .maybeSingle();
      
      if (error) throw error;
      if (existingAbsence) {
        await removeLeaveTimesheetEffects(
          supabase,
          {
            ...(existingAbsence as AbsenceValidationShape),
            id,
            allow_timesheet_work_on_leave: existingAbsence.allow_timesheet_work_on_leave,
          },
          user.id
        );
      }
      if (previousProcessedAbsenceSnapshot) {
        await notifyProcessedAbsenceChange({
          absenceId: id,
          action: 'cancelled',
          previousAbsence: previousProcessedAbsenceSnapshot,
          changedFields: ['status'],
        });
      }
      if (!data) return { id, status: 'cancelled' } as const;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Delete an absence (pending only)
 */
export function useDeleteAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: existingAbsence, error: existingAbsenceError } = await supabase
        .from('absences')
        .select(`
          profile_id,
          date,
          end_date,
          reason_id,
          duration_days,
          is_half_day,
          half_day_session,
          status,
          notes,
          allow_timesheet_work_on_leave,
          absence_reasons(name),
          profile:profiles!absences_profile_id_fkey(full_name)
        `)
        .eq('id', id)
        .single();

      if (existingAbsenceError) throw existingAbsenceError;
      const previousProcessedAbsenceSnapshot = buildProcessedAbsenceSnapshot(
        id,
        existingAbsence as unknown as AbsenceNotificationRelationShape
      );
      await assertAbsenceTimesheetChangesUnlocked(supabase, existingAbsence as AbsenceValidationShape);

      const { error } = await supabase
        .from('absences')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      await removeLeaveTimesheetEffects(
        supabase,
        {
          ...(existingAbsence as AbsenceValidationShape),
          id,
          allow_timesheet_work_on_leave: existingAbsence.allow_timesheet_work_on_leave,
        },
        user.id
      );
      await notifyProcessedAbsenceChange({
        absenceId: id,
        action: 'deleted',
        previousAbsence: previousProcessedAbsenceSnapshot,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

// ============================================================================
// ABSENCE HOOKS - ADMIN
// ============================================================================

/**
 * Get all absences (admin view with filters)
 */
export function useAllAbsences(filters?: {
  profileId?: string;
  dateFrom?: string;
  dateTo?: string;
  reasonId?: string;
  status?: string;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  matchOverlappingDateRange?: boolean;
}) {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absences', 'all', filters],
    enabled: filters !== undefined,
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const includeArchived = filters?.includeArchived === true;
      const archivedOnly = filters?.archivedOnly === true;

      const fetchRows = async (
        source: 'active' | 'archived'
      ): Promise<AbsenceWithRelations[]> => {
        const allRows: AbsenceWithRelations[] = [];
        let from = 0;

        while (true) {
          const tableName = source === 'archived' ? 'absences_archive' : 'absences';
          const profileJoin =
            source === 'archived'
              ? 'profiles!absences_archive_profile_id_fkey (full_name, employee_id, team_id)'
              : 'profiles!absences_profile_id_fkey (full_name, employee_id, team_id)';
          const createdByJoin =
            source === 'archived'
              ? 'created_by_profile:profiles!absences_archive_created_by_fkey (full_name)'
              : 'created_by_profile:profiles!absences_created_by_fkey (full_name)';
          const approvedByJoin =
            source === 'archived'
              ? 'approved_by_profile:profiles!absences_archive_approved_by_fkey (full_name)'
              : 'approved_by_profile:profiles!absences_approved_by_fkey (full_name)';

          let query = supabase.from(tableName).select(`
            *,
            absence_reasons (*),
            ${profileJoin},
            ${createdByJoin},
            ${approvedByJoin}
          `);

          if (hasFilterValue(filters?.profileId)) {
            query = query.eq('profile_id', filters.profileId);
          }
          if (filters?.dateTo) {
            query = query.lte('date', filters.dateTo);
          }
          if (filters?.dateFrom) {
            if (filters.matchOverlappingDateRange) {
              query = query.or(
                `end_date.gte.${filters.dateFrom},and(end_date.is.null,date.gte.${filters.dateFrom})`
              );
            } else {
              query = query.gte('date', filters.dateFrom);
            }
          }
          if (hasFilterValue(filters?.reasonId)) {
            query = query.eq('reason_id', filters.reasonId);
          }
          if (hasFilterValue(filters?.status)) {
            query = query.eq('status', filters.status as 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled');
          }

          const { data, error } = await query
            .order('date', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

          if (error) throw error;

          const pageRows = ((data || []) as AbsenceWithRelations[]).map((row) => ({
            ...row,
            record_source: source,
          }));
          allRows.push(...pageRows);

          if (pageRows.length < PAGE_SIZE) {
            break;
          }
          from += PAGE_SIZE;
        }

        return allRows;
      };

      if (archivedOnly) {
        return fetchRows('archived');
      }

      const activeRows = await fetchRows('active');
      if (!includeArchived) {
        return activeRows;
      }

      const archivedRows = await fetchRows('archived');
      return [...activeRows, ...archivedRows].sort((a, b) => b.date.localeCompare(a.date));
    },
  });
}

/**
 * Get pending absences for approval (admin/manager)
 */
export function usePendingAbsences() {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absences', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absences')
        .select(`
          *,
          absence_reasons (*),
          profiles!absences_profile_id_fkey (full_name, employee_id, team_id)
        `)
        .eq('status', 'pending')
        .order('date', { ascending: true });
      
      if (error) throw error;
      return (data || []) as AbsenceWithRelations[];
    },
  });
}

/**
 * Approve an absence (admin/manager only)
 */
export function useApproveAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: existingAbsence, error: existingAbsenceError } = await supabase
        .from('absences')
        .select('profile_id, date, end_date, reason_id, duration_days, is_half_day, half_day_session, status, notes, allow_timesheet_work_on_leave')
        .eq('id', id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingAbsenceError) throw existingAbsenceError;
      if (!existingAbsence) return { id, status: 'approved' } as const;
      
      const { data, error } = await supabase
        .from('absences')
        .update({
          status: 'approved',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'pending')
        .select()
        .maybeSingle();
      
      if (error) throw error;
      if (!data) return { id, status: 'approved' } as const;
      await applyApprovedLeaveTimesheetEffects(
        supabase,
        {
          profile_id: data.profile_id,
          date: data.date,
          end_date: data.end_date,
          reason_id: data.reason_id,
          duration_days: data.duration_days,
          is_half_day: Boolean(data.is_half_day),
          half_day_session: data.half_day_session,
          status: data.status,
          notes: data.notes,
          id: data.id,
          allow_timesheet_work_on_leave: data.allow_timesheet_work_on_leave,
        },
        user.id,
        'Approved'
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Process an approved absence (admin/manager only)
 */
export function useProcessAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const canProceed = await assertAbsenceFinancialYearOpen(supabase, id, { treatMissingAsNoop: true });
      if (!canProceed) {
        // Stale UI state: record already removed or unavailable. Treat as an idempotent success.
        return { id, status: 'processed' } as const;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('absences')
        .update({
          status: 'processed',
          processed_by: user.id,
          processed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'approved')
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) return { id, status: 'processed' } as const;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Reject an absence (admin/manager only)
 */
export function useRejectAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const updates: AbsenceUpdate = {
        status: 'rejected',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      };
      
      if (reason) {
        updates.notes = `REJECTED: ${reason}${updates.notes ? '\n' + updates.notes : ''}`;
      }
      
      const { data, error } = await supabase
        .from('absences')
        .update(updates)
        .eq('id', id)
        .eq('status', 'pending')
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Get absence summary for a specific employee (admin view)
 */
export function useAbsenceSummaryForEmployee(profileId: string) {
  const supabase = createClient();
  const { start, end } = getCurrentFinancialYear();
  
  return useQuery({
    queryKey: ['absence-summary', profileId, start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const financialYearStartYear = start.getFullYear();

      const [{ data: profile, error: profileError }, carryoverByProfile] = await Promise.all([
        supabase
          .from('profiles')
          .select('annual_holiday_allowance_days')
          .eq('id', profileId)
          .single(),
        fetchCarryoverMapForFinancialYear(supabase, financialYearStartYear, [profileId]),
      ]);

      if (profileError) throw profileError;

      const allowance = getEffectiveAllowance(
        profile?.annual_holiday_allowance_days,
        carryoverByProfile.get(profileId) || 0
      );

      // Get Annual Leave reason ID
      const { data: annualLeaveReason, error: reasonError } = await supabase
        .from('absence_reasons')
        .select('id')
        .ilike('name', ANNUAL_LEAVE_REASON_NAME)
        .single();
      
      if (reasonError || !annualLeaveReason) {
        return {
          allowance,
          approved_taken: 0,
          pending_total: 0,
          remaining: allowance,
        } as AbsenceSummary;
      }
      
      // Get absences within financial year
      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('status, duration_days, reason_id')
        .eq('profile_id', profileId)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]);
      
      if (absencesError) throw absencesError;
      const typedAbsences = (absences || []) as Array<{
        status: string;
        duration_days: number | null;
        reason_id: string | null;
      }>;
      
      // Calculate approved and pending for Annual Leave only
      const approved_taken = typedAbsences
        .filter((a) => (a.status === 'approved' || a.status === 'processed') && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const pending_total = typedAbsences
        .filter((a) => a.status === 'pending' && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const remaining = allowance - approved_taken - pending_total;
      
      return {
        allowance,
        approved_taken,
        pending_total,
        remaining,
      } as AbsenceSummary;
    },
    enabled: !!profileId,
  });
}

// ============================================================================
// ADMIN - ABSENCE REASONS CRUD
// ============================================================================

/**
 * Create a new absence reason (admin only)
 */
export function useCreateAbsenceReason() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (reason: { name: string; is_paid: boolean; color?: string }) => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .insert(reason)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-reasons'] });
      queryClient.invalidateQueries({ queryKey: ['absence-reasons-all'] });
    },
  });
}

/**
 * Update an absence reason (admin only)
 */
export function useUpdateAbsenceReason() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<AbsenceReason> }) => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-reasons'] });
      queryClient.invalidateQueries({ queryKey: ['absence-reasons-all'] });
    },
  });
}

/**
 * Delete an absence reason (admin only) - soft delete by setting is_active = false
 */
export function useDeleteAbsenceReason() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-reasons'] });
      queryClient.invalidateQueries({ queryKey: ['absence-reasons-all'] });
    },
  });
}

// ============================================================================
// ADMIN - ALLOWANCE MANAGEMENT
// ============================================================================

/**
 * Update employee allowance (admin only)
 */
export function useUpdateEmployeeAllowance() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ profileId, allowance }: { profileId: string; allowance: number }) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ annual_holiday_allowance_days: allowance })
        .eq('id', profileId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

