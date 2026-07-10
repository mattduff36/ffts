import { DAY_NAMES } from '@/types/timesheet';
import { calculateHours, calculatePlantDailyTotal, calculateStandardTimesheetHours } from '@/lib/utils/time-calculations';
import type { TimesheetDidNotWorkReason, TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';
import { getEntryJobNumbers } from '@/lib/utils/timesheet-job-codes';

export interface PlantEntryDraft {
  day_of_week: number;
  did_not_work: boolean;
  didNotWorkReason: TimesheetDidNotWorkReason | null;
  job_number: string;
  job_numbers: string[];
  working_in_yard: boolean;
  subsistence_payment_required: boolean;
  time_started: string;
  time_finished: string;
  operator_travel_hours: string;
  operator_yard_hours: string;
  operator_working_hours: number | null;
  daily_total: number | null;
  machine_travel_hours: string;
  machine_start_time: string;
  machine_finish_time: string;
  machine_working_hours: number | null;
  machine_standing_hours: string;
  machine_operator_hours: string;
  maintenance_breakdown_hours: string;
  remarks: string;
}

export interface RecalculateEntryOptions {
  paidLeaveHours?: number;
  isLeaveLocked?: boolean;
  preserveDailyTotal?: boolean;
}

export const EMPTY_ENTRY: Omit<PlantEntryDraft, 'day_of_week'> = {
  did_not_work: false,
  didNotWorkReason: null,
  job_number: '',
  job_numbers: [],
  working_in_yard: false,
  subsistence_payment_required: false,
  time_started: '',
  time_finished: '',
  operator_travel_hours: '',
  operator_yard_hours: '',
  operator_working_hours: null,
  daily_total: null,
  machine_travel_hours: '',
  machine_start_time: '',
  machine_finish_time: '',
  machine_working_hours: null,
  machine_standing_hours: '',
  machine_operator_hours: '',
  maintenance_breakdown_hours: '',
  remarks: '',
};

export function createBlankEntry(dayOfWeek: number): PlantEntryDraft {
  return {
    day_of_week: dayOfWeek,
    ...EMPTY_ENTRY,
  };
}

export function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function toHoursInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

export function hasPlantData(entry: PlantEntryDraft): boolean {
  return [
    entry.time_started,
    entry.time_finished,
    ...getEntryJobNumbers(entry),
    entry.operator_travel_hours,
    entry.operator_yard_hours,
    entry.machine_travel_hours,
    entry.machine_start_time,
    entry.machine_finish_time,
    entry.machine_standing_hours,
    entry.maintenance_breakdown_hours,
  ].some((value) => value.trim().length > 0);
}

function hasManualAdditionalPlantData(entry: PlantEntryDraft): boolean {
  return [
    entry.machine_travel_hours,
    entry.machine_start_time,
    entry.machine_finish_time,
    entry.machine_standing_hours,
    entry.maintenance_breakdown_hours,
  ].some((value) => value.trim().length > 0);
}

export function recalculateEntry(entry: PlantEntryDraft, options: RecalculateEntryOptions = {}): PlantEntryDraft {
  const operatorWorking = calculateStandardTimesheetHours(entry.time_started, entry.time_finished);

  const machineWorking = entry.machine_start_time && entry.machine_finish_time
    ? calculateHours(entry.machine_start_time, entry.machine_finish_time)
    : null;

  const machineOperatorHours = operatorWorking === null ? '' : String(roundHours(operatorWorking));
  const paidLeaveHours = roundHours(Math.max(0, options.paidLeaveHours ?? 0));
  const dailyTotal = calculatePlantDailyTotal({
    timeStarted: entry.time_started || null,
    timeFinished: entry.time_finished || null,
    paidLeaveHours,
    isLeaveLocked: options.isLeaveLocked,
    preserveDailyTotal: options.preserveDailyTotal,
    existingDailyTotal: entry.daily_total,
  });

  return {
    ...entry,
    operator_working_hours: operatorWorking === null ? null : roundHours(operatorWorking),
    machine_working_hours: machineWorking === null ? null : roundHours(machineWorking),
    machine_operator_hours: machineOperatorHours,
    daily_total: dailyTotal,
  };
}

export function getMachineMirrorUpdates(
  entry: PlantEntryDraft,
  field: 'time_started' | 'time_finished',
  nextValue: string
): Partial<PlantEntryDraft> {
  if (field === 'time_started') {
    const shouldMirrorMachineStart =
      entry.machine_start_time.length === 0 || entry.machine_start_time === entry.time_started;

    return shouldMirrorMachineStart ? { machine_start_time: nextValue } : {};
  }

  const shouldMirrorMachineFinish =
    entry.machine_finish_time.length === 0 || entry.machine_finish_time === entry.time_finished;

  return shouldMirrorMachineFinish ? { machine_finish_time: nextValue } : {};
}

export function buildValidationErrors(entries: PlantEntryDraft[]): Record<number, string> {
  const next: Record<number, string> = {};
  entries.forEach((entry, index) => {
    if (!hasPlantData(entry) || entry.did_not_work) return;

    const missing: string[] = [];
    if (!entry.time_started) missing.push('Operator start time');
    if (!entry.time_finished) missing.push('Operator finish time');
    if (hasManualAdditionalPlantData(entry)) {
      if (!entry.machine_start_time) missing.push('Machine start time');
      if (!entry.machine_finish_time) missing.push('Machine finish time');
    }

    if (missing.length > 0) {
      next[index] = `${DAY_NAMES[index]}: ${missing.join(', ')} required when row has plant data.`;
    }
  });
  return next;
}

export function isPlantEntryComplete(entry: PlantEntryDraft, offDayState?: TimesheetOffDayState): boolean {
  if (offDayState?.isOnApprovedLeave) return true;
  const hasHours = Boolean(entry.time_started && entry.time_finished);
  if (offDayState?.hasTrainingBooking) return hasHours;
  return hasHours || entry.did_not_work;
}
