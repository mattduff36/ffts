import { describe, expect, it } from 'vitest';
import {
  buildValidationErrors,
  getMachineMirrorUpdates,
  isPlantEntryComplete,
  recalculateEntry,
  type PlantEntryDraft,
} from '@/app/(dashboard)/timesheets/types/plant/plant-timesheet-v2-utils';

function createEntry(overrides: Partial<PlantEntryDraft> = {}): PlantEntryDraft {
  return {
    day_of_week: 1,
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
    ...overrides,
  };
}

describe('PlantTimesheetV2 calculations', () => {
  it('excludes travel hours from payable total and deducts lunch like the standard sheet', () => {
    const result = recalculateEntry(
      createEntry({
        time_started: '08:00',
        time_finished: '16:30',
        operator_travel_hours: '1.25',
        operator_yard_hours: '0.75',
        machine_start_time: '07:00',
        machine_finish_time: '15:00',
      })
    );

    expect(result.operator_working_hours).toBe(8);
    expect(result.machine_working_hours).toBe(8);
    expect(result.daily_total).toBe(8);
  });

  it('preserves normalized leave daily totals when requested', () => {
    const result = recalculateEntry(
      createEntry({
        did_not_work: true,
        didNotWorkReason: 'Holiday',
        daily_total: 9,
        remarks: 'Annual Leave',
      }),
      { preserveDailyTotal: true }
    );

    expect(result.daily_total).toBe(9);
  });

  it('adds paid leave hours for partial leave recalculation', () => {
    const result = recalculateEntry(
      createEntry({
        time_started: '12:00',
        time_finished: '17:00',
        operator_travel_hours: '1',
      }),
      { paidLeaveHours: 4.5 }
    );

    expect(result.daily_total).toBe(9.5);
  });

  it('does not change plant payable hours when subsistence is marked', () => {
    const result = recalculateEntry(
      createEntry({
        time_started: '08:00',
        time_finished: '17:00',
        subsistence_payment_required: true,
      })
    );

    expect(result.daily_total).toBe(8.5);
    expect(result.subsistence_payment_required).toBe(true);
  });

  it('forces locked leave totals to paid leave hours', () => {
    const result = recalculateEntry(
      createEntry({
        time_started: '08:00',
        time_finished: '17:00',
        operator_travel_hours: '1',
        daily_total: 99,
      }),
      { paidLeaveHours: 9, isLeaveLocked: true }
    );

    expect(result.daily_total).toBe(9);
  });

  it('requires operator and machine start/finish when row contains data', () => {
    const entries = [
      createEntry({
        operator_travel_hours: '1',
        machine_start_time: '08:00',
      }),
    ];

    const errors = buildValidationErrors(entries);
    expect(Object.keys(errors).length).toBe(1);
    expect(errors[0]).toContain('Operator start time');
    expect(errors[0]).toContain('Operator finish time');
    expect(errors[0]).toContain('Machine finish time');
  });

  it('does not add validation errors for empty rows', () => {
    const errors = buildValidationErrors([createEntry()]);
    expect(errors).toEqual({});
  });

  it('does not require times for remarks-only rows', () => {
    const errors = buildValidationErrors([
      createEntry({
        remarks: 'Did not work this day',
      }),
    ]);

    expect(errors).toEqual({});
  });

  it('does not require machine start/finish from derived operator total alone', () => {
    const recalculated = recalculateEntry(
      createEntry({
        time_started: '15:00',
        time_finished: '04:00',
        operator_travel_hours: '2',
      })
    );

    const errors = buildValidationErrors([recalculated]);
    expect(errors).toEqual({});
  });

  it('mirrors operator start time into machine start when machine start is blank', () => {
    const updates = getMachineMirrorUpdates(
      createEntry({
        time_started: '08:00',
        machine_start_time: '',
      }),
      'time_started',
      '09:00'
    );

    expect(updates).toEqual({ machine_start_time: '09:00' });
  });

  it('keeps machine start manual overrides when operator start changes later', () => {
    const updates = getMachineMirrorUpdates(
      createEntry({
        time_started: '08:00',
        machine_start_time: '07:30',
      }),
      'time_started',
      '09:00'
    );

    expect(updates).toEqual({});
  });

  it('mirrors operator finish time into machine finish while values stay in sync', () => {
    const updates = getMachineMirrorUpdates(
      createEntry({
        time_finished: '16:00',
        machine_finish_time: '16:00',
      }),
      'time_finished',
      '17:00'
    );

    expect(updates).toEqual({ machine_finish_time: '17:00' });
  });

  it('marks entries complete using civils parity rules', () => {
    const leaveState = { isOnApprovedLeave: true } as unknown as Parameters<typeof isPlantEntryComplete>[1];
    expect(isPlantEntryComplete(createEntry({ time_started: '08:00', time_finished: '16:00' }))).toBe(true);
    expect(isPlantEntryComplete(createEntry({ did_not_work: true }))).toBe(true);
    expect(isPlantEntryComplete(createEntry(), leaveState)).toBe(true);
    expect(isPlantEntryComplete(createEntry())).toBe(false);
  });
});
