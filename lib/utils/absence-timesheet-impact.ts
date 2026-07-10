import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { Timesheet } from '@/types/timesheet';
import { calculateStandardTimesheetHours } from '@/lib/utils/time-calculations';
import { isTrainingReasonName } from '@/lib/utils/timesheet-off-days';

type DbClient = SupabaseClient<Database>;
type TimesheetStatus = Timesheet['status'];

const LOCKED_TIMESHEET_STATUSES: ReadonlySet<TimesheetStatus> = new Set(['processed', 'adjusted']);
const RECONCILABLE_TIMESHEET_STATUSES: ReadonlySet<TimesheetStatus> = new Set([
  'draft',
  'rejected',
  'submitted',
  'approved',
]);

interface TimesheetEntryImpactRow {
  id: string;
  timesheet_id: string;
  day_of_week: number;
  time_started: string | null;
  time_finished: string | null;
  job_number: string | null;
  working_in_yard: boolean | null;
  did_not_work: boolean | null;
  daily_total: number | null;
  remarks: string | null;
  night_shift: boolean | null;
  bank_holiday: boolean | null;
  operator_travel_hours: number | null;
  operator_yard_hours: number | null;
  operator_working_hours: number | null;
  machine_travel_hours: number | null;
  machine_start_time: string | null;
  machine_finish_time: string | null;
  machine_working_hours: number | null;
  machine_standing_hours: number | null;
  machine_operator_hours: number | null;
  maintenance_breakdown_hours: number | null;
  timesheet_entry_job_codes?: Array<{ job_number: string | null; display_order?: number | null }> | null;
}

interface TimesheetImpactRow {
  id: string;
  week_ending: string;
  status: TimesheetStatus;
  manager_comments: string | null;
}

interface SnapshotRow {
  id: string;
  absence_id: string;
  timesheet_id: string;
  timesheet_entry_id: string;
  day_of_week: number;
  had_entry: boolean;
  original_entry: Json;
  original_job_numbers: string[] | null;
  applied_entry: Json;
}

export interface AbsenceTimesheetImpactDate {
  date: string;
  dayOfWeek: number;
  entry: TimesheetEntryImpactRow | null;
  hasEntry: boolean;
  hasWorkingHours: boolean;
  hasJobCodes: boolean;
  hasAnyEnteredData: boolean;
}

export interface AbsenceTimesheetImpact {
  timesheetId: string;
  weekEnding: string;
  status: TimesheetStatus;
  managerComments: string | null;
  affectedDates: AbsenceTimesheetImpactDate[];
  hasExistingHours: boolean;
  hasExistingJobCodes: boolean;
  hasAnyEnteredData: boolean;
}

export interface ResolveAbsenceTimesheetImpactsInput {
  profileId: string;
  startDate: string;
  endDate?: string | null;
  isHalfDay?: boolean | null;
}

export interface AbsenceTimesheetReason {
  reasonName: string;
  isPaid: boolean;
  isTraining?: boolean;
  allowTimesheetWorkOnLeave?: boolean | null;
  halfDaySession?: 'AM' | 'PM' | null;
}

export interface ApplyAbsenceTimesheetEffectsInput extends ResolveAbsenceTimesheetImpactsInput, AbsenceTimesheetReason {
  absenceId: string;
  actorUserId: string;
  impacts?: AbsenceTimesheetImpact[];
  returnReason?: string;
}

export interface RemoveAbsenceTimesheetEffectsInput extends ApplyAbsenceTimesheetEffectsInput {
  snapshots?: SnapshotRow[];
}

function parseIsoDate(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00`);
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

export function getAbsenceImpactWeekEnding(dateIso: string): string {
  const date = parseIsoDate(dateIso);
  const daysUntilSunday = (7 - date.getDay()) % 7;
  return formatLocalIsoDate(addDays(date, daysUntilSunday));
}

export function getAbsenceImpactDayOfWeek(dateIso: string): number {
  const day = parseIsoDate(dateIso).getDay();
  return day === 0 ? 7 : day;
}

export function expandAbsenceImpactDates(input: ResolveAbsenceTimesheetImpactsInput): string[] {
  const start = parseIsoDate(input.startDate);
  const end = input.isHalfDay ? start : parseIsoDate(input.endDate || input.startDate);
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(formatLocalIsoDate(cursor));
  }

  return dates;
}

function getEntryJobNumbers(entry: TimesheetEntryImpactRow | null | undefined): string[] {
  if (!entry) return [];

  const childJobNumbers = (entry.timesheet_entry_job_codes || [])
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((jobCode) => jobCode.job_number?.trim() || '')
    .filter(Boolean);

  if (childJobNumbers.length > 0) return childJobNumbers;
  return entry.job_number?.trim() ? [entry.job_number.trim()] : [];
}

function entryHasWorkingHours(entry: TimesheetEntryImpactRow | null | undefined): boolean {
  return Boolean(entry?.time_started || entry?.time_finished);
}

function entryHasJobCodes(entry: TimesheetEntryImpactRow | null | undefined): boolean {
  return getEntryJobNumbers(entry).length > 0;
}

function entryHasAnyEnteredData(entry: TimesheetEntryImpactRow | null | undefined): boolean {
  if (!entry) return false;
  return Boolean(
    entryHasWorkingHours(entry) ||
      entryHasJobCodes(entry) ||
      entry.working_in_yard ||
      entry.did_not_work ||
      (entry.daily_total !== null && Number(entry.daily_total) > 0) ||
      entry.remarks?.trim()
  );
}

function normalizeReason(value: string): string {
  return value.trim().toLowerCase();
}

function isAnnualLeaveReason(value: string): boolean {
  return normalizeReason(value) === 'annual leave';
}

function shouldApplyBlockingLeave(reason: AbsenceTimesheetReason): boolean {
  if (reason.isTraining || isTrainingReasonName(reason.reasonName)) return false;
  return !(isAnnualLeaveReason(reason.reasonName) && reason.allowTimesheetWorkOnLeave);
}

function formatLeaveRemark(reason: AbsenceTimesheetReason): string {
  if (reason.halfDaySession) return `${reason.reasonName} (${reason.halfDaySession})`;
  return reason.reasonName || 'Approved Leave';
}

function buildReturnComment(dates: string[], reasonName: string, action: string): string {
  return `${action} ${reasonName} booking for ${dates.join(', ')}. Please amend and resubmit this timesheet.`;
}

function toEntrySnapshot(entry: TimesheetEntryImpactRow | null): Record<string, Json> | null {
  if (!entry) return null;

  return {
    time_started: entry.time_started,
    time_finished: entry.time_finished,
    job_number: entry.job_number,
    working_in_yard: entry.working_in_yard,
    did_not_work: entry.did_not_work,
    daily_total: entry.daily_total,
    remarks: entry.remarks,
    night_shift: entry.night_shift,
    bank_holiday: entry.bank_holiday,
    operator_travel_hours: entry.operator_travel_hours,
    operator_yard_hours: entry.operator_yard_hours,
    operator_working_hours: entry.operator_working_hours,
    machine_travel_hours: entry.machine_travel_hours,
    machine_start_time: entry.machine_start_time,
    machine_finish_time: entry.machine_finish_time,
    machine_working_hours: entry.machine_working_hours,
    machine_standing_hours: entry.machine_standing_hours,
    machine_operator_hours: entry.machine_operator_hours,
    maintenance_breakdown_hours: entry.maintenance_breakdown_hours,
  };
}

function buildAppliedEntry(reason: AbsenceTimesheetReason, entry: TimesheetEntryImpactRow | null): Record<string, Json> {
  const remark = formatLeaveRemark(reason);
  if (reason.halfDaySession) {
    const workedHours = calculateStandardTimesheetHours(entry?.time_started || null, entry?.time_finished || null) || 0;
    const paidLeaveHours = reason.isPaid ? 4.5 : 0;

    return {
      did_not_work: false,
      daily_total: Math.round((workedHours + paidLeaveHours) * 100) / 100,
      remarks: remark,
    };
  }

  return {
    time_started: null,
    time_finished: null,
    job_number: null,
    working_in_yard: false,
    did_not_work: true,
    daily_total: reason.isPaid ? 9 : 0,
    remarks: remark,
    night_shift: false,
    bank_holiday: false,
  };
}

function isObjectRecord(value: Json): value is Record<string, Json> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeComparable(value: unknown): unknown {
  return value === undefined ? null : value;
}

function currentMatchesApplied(entry: TimesheetEntryImpactRow, applied: Json): boolean {
  if (!isObjectRecord(applied)) return false;

  return Object.entries(applied).every(([key, value]) => {
    const entryValue = (entry as unknown as Record<string, unknown>)[key];
    return normalizeComparable(entryValue) === normalizeComparable(value);
  });
}

function currentLooksAutoApplied(entry: TimesheetEntryImpactRow, reason: AbsenceTimesheetReason): boolean {
  const remark = formatLeaveRemark(reason);
  return Boolean(
    entry.did_not_work &&
      !entry.time_started &&
      !entry.time_finished &&
      getEntryJobNumbers(entry).length === 0 &&
      !entry.working_in_yard &&
      entry.remarks?.trim() === remark
  );
}

function stripLeaveRemark(remarks: string | null, reason: AbsenceTimesheetReason): string | null {
  if (!remarks) return null;
  const staleRemark = formatLeaveRemark(reason);
  const remaining = remarks
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== staleRemark)
    .join('\n');
  return remaining || null;
}

export async function resolveAbsenceTimesheetImpacts(
  supabase: DbClient,
  input: ResolveAbsenceTimesheetImpactsInput
): Promise<AbsenceTimesheetImpact[]> {
  const dates = expandAbsenceImpactDates(input);
  const weekEndings = Array.from(new Set(dates.map(getAbsenceImpactWeekEnding)));

  if (weekEndings.length === 0) return [];

  const { data: timesheets, error: timesheetError } = await supabase
    .from('timesheets')
    .select('id, week_ending, status, manager_comments')
    .eq('user_id', input.profileId)
    .in('week_ending', weekEndings);

  if (timesheetError) throw timesheetError;

  const timesheetRows = (timesheets || []) as TimesheetImpactRow[];
  if (timesheetRows.length === 0) return [];

  const timesheetIds = timesheetRows.map((timesheet) => timesheet.id);
  const { data: entries, error: entriesError } = await supabase
    .from('timesheet_entries')
    .select(`
      id,
      timesheet_id,
      day_of_week,
      time_started,
      time_finished,
      job_number,
      working_in_yard,
      did_not_work,
      daily_total,
      remarks,
      night_shift,
      bank_holiday,
      operator_travel_hours,
      operator_yard_hours,
      operator_working_hours,
      machine_travel_hours,
      machine_start_time,
      machine_finish_time,
      machine_working_hours,
      machine_standing_hours,
      machine_operator_hours,
      maintenance_breakdown_hours,
      timesheet_entry_job_codes(job_number, display_order)
    `)
    .in('timesheet_id', timesheetIds);

  if (entriesError) throw entriesError;

  const entriesByTimesheetAndDay = new Map<string, TimesheetEntryImpactRow>();
  for (const entry of (entries || []) as unknown as TimesheetEntryImpactRow[]) {
    entriesByTimesheetAndDay.set(`${entry.timesheet_id}:${entry.day_of_week}`, entry);
  }

  return timesheetRows.map((timesheet) => {
    const affectedDates = dates
      .filter((date) => getAbsenceImpactWeekEnding(date) === timesheet.week_ending)
      .map<AbsenceTimesheetImpactDate>((date) => {
        const dayOfWeek = getAbsenceImpactDayOfWeek(date);
        const entry = entriesByTimesheetAndDay.get(`${timesheet.id}:${dayOfWeek}`) || null;
        return {
          date,
          dayOfWeek,
          entry,
          hasEntry: Boolean(entry),
          hasWorkingHours: entryHasWorkingHours(entry),
          hasJobCodes: entryHasJobCodes(entry),
          hasAnyEnteredData: entryHasAnyEnteredData(entry),
        };
      });

    return {
      timesheetId: timesheet.id,
      weekEnding: timesheet.week_ending,
      status: timesheet.status,
      managerComments: timesheet.manager_comments,
      affectedDates,
      hasExistingHours: affectedDates.some((date) => date.hasWorkingHours),
      hasExistingJobCodes: affectedDates.some((date) => date.hasJobCodes),
      hasAnyEnteredData: affectedDates.some((date) => date.hasAnyEnteredData),
    };
  });
}

export function getLockedAbsenceTimesheetImpacts(
  impacts: AbsenceTimesheetImpact[]
): AbsenceTimesheetImpact[] {
  return impacts.filter((impact) => LOCKED_TIMESHEET_STATUSES.has(impact.status));
}

export function assertNoLockedAbsenceTimesheetImpacts(impacts: AbsenceTimesheetImpact[]): void {
  const locked = getLockedAbsenceTimesheetImpacts(impacts);
  if (locked.length === 0) return;

  const weeks = locked.map((impact) => `${impact.weekEnding} (${impact.status})`).join(', ');
  throw new Error(`This leave booking affects locked timesheets and cannot be changed: ${weeks}`);
}

export function buildAbsenceTimesheetImpactMessage(
  reasonName: string,
  impacts: AbsenceTimesheetImpact[]
): string | null {
  if (impacts.length === 0) return null;

  const lines = impacts.map((impact) => {
    const entered = impact.hasAnyEnteredData
      ? impact.hasExistingHours
        ? 'existing hours'
        : 'existing entries'
      : 'no entered hours';
    return `Week ending ${impact.weekEnding}: ${impact.status} timesheet with ${entered}`;
  });

  const locked = getLockedAbsenceTimesheetImpacts(impacts);
  const lockedLine =
    locked.length > 0
      ? 'Draft/submitted/approved timesheets will be reconciled. Processed/adjusted timesheets are locked and will be recorded without changing payroll history.'
      : 'Draft/submitted/approved timesheets will be reconciled immediately without returning submitted timesheets to the employee.';

  return [
    `This ${reasonName || 'leave'} booking affects existing timesheets:`,
    ...lines,
    lockedLine,
  ].join('\n');
}

export async function returnSubmittedAbsenceTimesheetsForAmendment(
  supabase: DbClient,
  input: {
    actorUserId: string;
    reasonName: string;
    impacts: AbsenceTimesheetImpact[];
    action?: string;
  }
): Promise<string[]> {
  const returnedTimesheetIds: string[] = [];

  for (const impact of input.impacts) {
    if (impact.status !== 'submitted') continue;

    const newComment = buildReturnComment(
      impact.affectedDates.map((date) => date.date),
      input.reasonName || 'Leave',
      input.action || 'Approved'
    );
    const managerComments = impact.managerComments
      ? `${impact.managerComments}\n\n${newComment}`
      : newComment;

    const { error } = await supabase
      .from('timesheets')
      .update({
        status: 'rejected',
        reviewed_by: input.actorUserId,
        reviewed_at: new Date().toISOString(),
        manager_comments: managerComments,
      })
      .eq('id', impact.timesheetId)
      .eq('status', 'submitted');

    if (error) throw error;
    returnedTimesheetIds.push(impact.timesheetId);
  }

  return returnedTimesheetIds;
}

async function replaceEntryJobCodes(
  supabase: DbClient,
  entryId: string,
  jobNumbers: string[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('timesheet_entry_job_codes')
    .delete()
    .eq('timesheet_entry_id', entryId);

  if (deleteError) throw deleteError;

  const rows = jobNumbers
    .map((jobNumber) => jobNumber.trim())
    .filter(Boolean)
    .map((jobNumber, displayOrder) => ({
      timesheet_entry_id: entryId,
      job_number: jobNumber,
      display_order: displayOrder,
    }));

  if (rows.length === 0) return;

  const { error: insertError } = await supabase
    .from('timesheet_entry_job_codes')
    .insert(rows);

  if (insertError) throw insertError;
}

async function ensureTimesheetEntry(
  supabase: DbClient,
  impact: AbsenceTimesheetImpact,
  affectedDate: AbsenceTimesheetImpactDate,
  appliedEntry: Record<string, Json>
): Promise<TimesheetEntryImpactRow> {
  if (affectedDate.entry) return affectedDate.entry;

  const { data, error } = await supabase
    .from('timesheet_entries')
    .insert({
      timesheet_id: impact.timesheetId,
      day_of_week: affectedDate.dayOfWeek,
      ...appliedEntry,
    })
    .select(`
      id,
      timesheet_id,
      day_of_week,
      time_started,
      time_finished,
      job_number,
      working_in_yard,
      did_not_work,
      daily_total,
      remarks,
      night_shift,
      bank_holiday,
      operator_travel_hours,
      operator_yard_hours,
      operator_working_hours,
      machine_travel_hours,
      machine_start_time,
      machine_finish_time,
      machine_working_hours,
      machine_standing_hours,
      machine_operator_hours,
      maintenance_breakdown_hours,
      timesheet_entry_job_codes(job_number, display_order)
    `)
    .single();

  if (error) throw error;
  return data as unknown as TimesheetEntryImpactRow;
}

async function snapshotEntryBeforeLeaveApply(
  supabase: DbClient,
  input: {
    absenceId: string;
    actorUserId: string;
    impact: AbsenceTimesheetImpact;
    affectedDate: AbsenceTimesheetImpactDate;
    entry: TimesheetEntryImpactRow;
    appliedEntry: Record<string, Json>;
  }
): Promise<void> {
  const snapshot = {
    absence_id: input.absenceId,
    timesheet_id: input.impact.timesheetId,
    timesheet_entry_id: input.entry.id,
    day_of_week: input.affectedDate.dayOfWeek,
    had_entry: input.affectedDate.hasEntry,
    original_entry: toEntrySnapshot(input.affectedDate.entry),
    original_job_numbers: getEntryJobNumbers(input.affectedDate.entry),
    applied_entry: input.appliedEntry,
    created_by: input.actorUserId,
  };

  const { error } = await supabase
    .from('timesheet_entry_leave_snapshots')
    .upsert(snapshot, { onConflict: 'absence_id,timesheet_id,day_of_week' });

  if (error) throw error;
}

export async function applyAbsenceToTimesheetRows(
  supabase: DbClient,
  input: ApplyAbsenceTimesheetEffectsInput
): Promise<void> {
  const isTraining = input.isTraining || isTrainingReasonName(input.reasonName);
  if (isTraining || !shouldApplyBlockingLeave(input)) return;

  const impacts = input.impacts || await resolveAbsenceTimesheetImpacts(supabase, input);

  for (const impact of impacts) {
    if (!RECONCILABLE_TIMESHEET_STATUSES.has(impact.status)) continue;

    for (const affectedDate of impact.affectedDates) {
      const appliedEntry = buildAppliedEntry(input, affectedDate.entry);
      const entry = await ensureTimesheetEntry(supabase, impact, affectedDate, appliedEntry);

      await snapshotEntryBeforeLeaveApply(supabase, {
        absenceId: input.absenceId,
        actorUserId: input.actorUserId,
        impact,
        affectedDate,
        entry,
        appliedEntry,
      });

      const { error } = await supabase
        .from('timesheet_entries')
        .update(appliedEntry)
        .eq('id', entry.id);

      if (error) throw error;

      if (!input.halfDaySession) {
        await replaceEntryJobCodes(supabase, entry.id, []);
      }
    }
  }
}

async function fetchLeaveSnapshots(supabase: DbClient, absenceId: string): Promise<SnapshotRow[]> {
  const { data, error } = await supabase
    .from('timesheet_entry_leave_snapshots')
    .select('*')
    .eq('absence_id', absenceId);

  if (error) throw error;
  return (data || []) as unknown as SnapshotRow[];
}

async function fetchEntryById(supabase: DbClient, entryId: string): Promise<TimesheetEntryImpactRow | null> {
  const { data, error } = await supabase
    .from('timesheet_entries')
    .select(`
      id,
      timesheet_id,
      day_of_week,
      time_started,
      time_finished,
      job_number,
      working_in_yard,
      did_not_work,
      daily_total,
      remarks,
      night_shift,
      bank_holiday,
      operator_travel_hours,
      operator_yard_hours,
      operator_working_hours,
      machine_travel_hours,
      machine_start_time,
      machine_finish_time,
      machine_working_hours,
      machine_standing_hours,
      machine_operator_hours,
      maintenance_breakdown_hours,
      timesheet_entry_job_codes(job_number, display_order)
    `)
    .eq('id', entryId)
    .maybeSingle();

  if (error) throw error;
  return data as unknown as TimesheetEntryImpactRow | null;
}

function toUpdatePayload(snapshot: SnapshotRow): Record<string, Json | undefined> {
  if (!isObjectRecord(snapshot.original_entry)) return {};
  return {
    time_started: snapshot.original_entry.time_started,
    time_finished: snapshot.original_entry.time_finished,
    job_number: snapshot.original_entry.job_number,
    working_in_yard: snapshot.original_entry.working_in_yard,
    did_not_work: snapshot.original_entry.did_not_work,
    daily_total: snapshot.original_entry.daily_total,
    remarks: snapshot.original_entry.remarks,
    night_shift: snapshot.original_entry.night_shift,
    bank_holiday: snapshot.original_entry.bank_holiday,
    operator_travel_hours: snapshot.original_entry.operator_travel_hours,
    operator_yard_hours: snapshot.original_entry.operator_yard_hours,
    operator_working_hours: snapshot.original_entry.operator_working_hours,
    machine_travel_hours: snapshot.original_entry.machine_travel_hours,
    machine_start_time: snapshot.original_entry.machine_start_time,
    machine_finish_time: snapshot.original_entry.machine_finish_time,
    machine_working_hours: snapshot.original_entry.machine_working_hours,
    machine_standing_hours: snapshot.original_entry.machine_standing_hours,
    machine_operator_hours: snapshot.original_entry.machine_operator_hours,
    maintenance_breakdown_hours: snapshot.original_entry.maintenance_breakdown_hours,
  };
}

async function clearSnapshot(supabase: DbClient, snapshotId: string): Promise<void> {
  const { error } = await supabase
    .from('timesheet_entry_leave_snapshots')
    .delete()
    .eq('id', snapshotId);

  if (error) throw error;
}

async function clearStaleAutoLeaveRow(
  supabase: DbClient,
  entry: TimesheetEntryImpactRow,
  reason: AbsenceTimesheetReason
): Promise<void> {
  if (currentLooksAutoApplied(entry, reason)) {
    const { error } = await supabase
      .from('timesheet_entries')
      .update({
        did_not_work: false,
        daily_total: null,
        remarks: null,
      })
      .eq('id', entry.id);

    if (error) throw error;
    return;
  }

  const cleanedRemarks = stripLeaveRemark(entry.remarks, reason);
  if (cleanedRemarks === entry.remarks) return;

  const { error } = await supabase
    .from('timesheet_entries')
    .update({ remarks: cleanedRemarks })
    .eq('id', entry.id);

  if (error) throw error;
}

export async function removeAbsenceFromTimesheetRows(
  supabase: DbClient,
  input: RemoveAbsenceTimesheetEffectsInput
): Promise<void> {
  const isTraining = input.isTraining || isTrainingReasonName(input.reasonName);
  if (isTraining || !shouldApplyBlockingLeave(input)) return;

  const snapshots = input.snapshots || await fetchLeaveSnapshots(supabase, input.absenceId);
  const restoredEntryIds = new Set<string>();

  for (const snapshot of snapshots) {
    const entry = await fetchEntryById(supabase, snapshot.timesheet_entry_id);
    if (!entry) {
      await clearSnapshot(supabase, snapshot.id);
      continue;
    }

    if (currentMatchesApplied(entry, snapshot.applied_entry)) {
      if (!snapshot.had_entry) {
        const { error } = await supabase
          .from('timesheet_entries')
          .delete()
          .eq('id', entry.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('timesheet_entries')
          .update(toUpdatePayload(snapshot))
          .eq('id', entry.id);

        if (error) throw error;
        await replaceEntryJobCodes(supabase, entry.id, snapshot.original_job_numbers || []);
      }

      restoredEntryIds.add(entry.id);
      await clearSnapshot(supabase, snapshot.id);
      continue;
    }

    await clearStaleAutoLeaveRow(supabase, entry, input);
    await clearSnapshot(supabase, snapshot.id);
  }

  const impacts = input.impacts || await resolveAbsenceTimesheetImpacts(supabase, input);
  for (const impact of impacts) {
    for (const affectedDate of impact.affectedDates) {
      const entry = affectedDate.entry;
      if (!entry || restoredEntryIds.has(entry.id)) continue;
      await clearStaleAutoLeaveRow(supabase, entry, input);
    }
  }
}

export async function applyApprovedAbsenceTimesheetEffects(
  supabase: DbClient,
  input: ApplyAbsenceTimesheetEffectsInput
): Promise<string[]> {
  const impacts = input.impacts || await resolveAbsenceTimesheetImpacts(supabase, input);

  await applyAbsenceToTimesheetRows(supabase, {
    ...input,
    impacts,
  });

  return [];
}
