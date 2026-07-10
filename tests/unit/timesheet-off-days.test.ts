import { describe, expect, it } from 'vitest';
import {
  getTimesheetEntryDateFromWeekEnding,
  isTimeWithinWorkWindow,
  normalizeTimesheetEntriesForOffDays,
  PAID_LEAVE_DAILY_HOURS,
  resolveTimesheetOffDayStates,
  type TimesheetEntryLike,
} from '@/lib/utils/timesheet-off-days';
import { cloneWorkShiftPattern, STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';

function buildEntries(): TimesheetEntryLike[] {
  return Array.from({ length: 7 }, (_, i) => ({
    day_of_week: i + 1,
    time_started: '',
    time_finished: '',
    job_number: '',
    job_numbers: [],
    working_in_yard: false,
    did_not_work: false,
    didNotWorkReason: null,
    daily_total: null,
    remarks: '',
  }));
}

describe('timesheet off-day resolver', () => {
  it('maps day_of_week to expected calendar dates', () => {
    const monday = getTimesheetEntryDateFromWeekEnding('2026-03-29', 1);
    const sunday = getTimesheetEntryDateFromWeekEnding('2026-03-29', 7);

    expect(monday.toISOString().slice(0, 10)).toBe('2026-03-23');
    expect(sunday.toISOString().slice(0, 10)).toBe('2026-03-29');
  });

  it('marks approved annual leave as locked off-day', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Annual Leave', color: '#7c3aed', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const tuesday = states.find((row) => row.day_of_week === 2);
    expect(tuesday?.isOnApprovedLeave).toBe(true);
    expect(tuesday?.isAnnualLeave).toBe(true);
    expect(tuesday?.isLeaveLocked).toBe(true);
    expect(tuesday?.leaveReasonColor).toBe('#7c3aed');
    expect(tuesday?.paidLeaveHours).toBe(PAID_LEAVE_DAILY_HOURS);
  });

  it('clears subsistence markers from locked leave days', () => {
    const entries = buildEntries();
    entries[1] = {
      ...entries[1],
      time_started: '08:00',
      time_finished: '17:00',
      subsistence_payment_required: true,
      remarks: 'Stayed away - subsistence payment required',
    };
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Annual Leave', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states);

    expect(normalized[1].subsistence_payment_required).toBe(false);
    expect(normalized[1].remarks).toBe('Annual Leave');
  });

  it('keeps annual leave credit but unlocks work entry when override is enabled', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: false,
          allow_timesheet_work_on_leave: true,
          absence_reasons: { name: 'Annual Leave', color: '#7c3aed', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const tuesday = states.find((row) => row.day_of_week === 2);
    expect(tuesday?.isOnApprovedLeave).toBe(true);
    expect(tuesday?.isAnnualLeave).toBe(true);
    expect(tuesday?.isLeaveLocked).toBe(false);
    expect(tuesday?.isPartialLeave).toBe(true);
    expect(tuesday?.workWindow).toBeNull();
    expect(tuesday?.paidLeaveHours).toBe(PAID_LEAVE_DAILY_HOURS);
  });

  it('still marks approved leave when work-shift pattern is unavailable', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-27',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Annual Leave' },
        },
      ],
      null
    );

    const friday = states.find((row) => row.day_of_week === 5);
    expect(friday?.isOnApprovedLeave).toBe(true);
    expect(friday?.isLeaveLocked).toBe(true);
    // Pattern fallback still resolves expected shift days without disabling leave lock.
    expect(friday?.isExpectedShiftDay).toBe(true);
  });

  it('does not treat half-day leave as full off-day lock', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-25',
          end_date: null,
          is_half_day: true,
          half_day_session: 'AM',
          absence_reasons: { name: 'Annual Leave', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const wednesday = states.find((row) => row.day_of_week === 3);
    expect(wednesday?.isOnApprovedLeave).toBe(true);
    expect(wednesday?.isLeaveLocked).toBe(false);
    expect(wednesday?.isPartialLeave).toBe(true);
    expect(wednesday?.workWindow?.start).toBe('12:00');
    expect(wednesday?.workWindow?.end).toBe('23:59');
    expect(wednesday?.paidLeaveHours).toBe(4.5);
    expect(wednesday?.leaveLabels[0]?.label).toBe('Annual Leave (AM)');
  });

  it('treats legacy half-day rows with an end date as single-day only', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-25',
          end_date: '2026-03-27',
          is_half_day: true,
          half_day_session: 'AM',
          absence_reasons: { name: 'Unpaid leave', is_paid: false },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const wednesday = states.find((row) => row.day_of_week === 3);
    const thursday = states.find((row) => row.day_of_week === 4);
    const friday = states.find((row) => row.day_of_week === 5);

    expect(wednesday?.isOnApprovedLeave).toBe(true);
    expect(wednesday?.isPartialLeave).toBe(true);
    expect(wednesday?.workWindow?.start).toBe('12:00');
    expect(wednesday?.workWindow?.end).toBe('23:59');
    expect(wednesday?.paidLeaveHours).toBe(0);

    expect(thursday?.isOnApprovedLeave).toBe(false);
    expect(thursday?.isPartialLeave).toBe(false);
    expect(thursday?.workWindow).toBeNull();

    expect(friday?.isOnApprovedLeave).toBe(false);
    expect(friday?.isPartialLeave).toBe(false);
    expect(friday?.workWindow).toBeNull();
  });

  it('supports two separate half-day leave reasons in one day', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: true,
          half_day_session: 'AM',
          absence_reasons: { name: 'Annual Leave', is_paid: true },
        },
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: true,
          half_day_session: 'PM',
          absence_reasons: { name: 'Training', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const tuesday = states.find((row) => row.day_of_week === 2);
    expect(tuesday?.isLeaveLocked).toBe(false);
    expect(tuesday?.leaveLabels.map((row) => row.label)).toEqual(['Annual Leave (AM)']);
    expect(tuesday?.trainingLabels.map((row) => row.label)).toEqual(['Training (PM)']);
    expect(tuesday?.hasTrainingBooking).toBe(true);
    expect(tuesday?.paidLeaveHours).toBe(4.5);
  });

  it('exposes training bookings separately from approved leave totals', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          id: 'training-absence-id',
          date: '2026-03-24',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Training', color: '#22c55e', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const tuesday = states.find((row) => row.day_of_week === 2);
    expect(tuesday?.isOnApprovedLeave).toBe(false);
    expect(tuesday?.isLeaveLocked).toBe(false);
    expect(tuesday?.paidLeaveHours).toBe(0);
    expect(tuesday?.leaveLabels).toEqual([]);
    expect(tuesday?.trainingLabels.map((row) => row.label)).toEqual(['Training']);
    expect(tuesday?.hasTrainingBooking).toBe(true);
    expect(tuesday?.trainingAbsenceIds).toEqual(['training-absence-id']);
    expect(tuesday?.trainingDisplayRemarks).toBe('Training');
    expect(tuesday?.trainingReasonColor).toBe('#22c55e');
  });

  it('shows pending training separately without relaxing approved training rules', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          id: 'pending-training-id',
          date: '2026-03-24',
          end_date: null,
          status: 'pending',
          is_half_day: false,
          absence_reasons: { name: 'Training', color: '#38bdf8', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const tuesday = states.find((row) => row.day_of_week === 2);
    expect(tuesday?.hasTrainingBooking).toBe(false);
    expect(tuesday?.trainingLabels).toEqual([]);
    expect(tuesday?.trainingAbsenceIds).toEqual([]);
    expect(tuesday?.hasPendingTrainingBooking).toBe(true);
    expect(tuesday?.pendingTrainingLabels.map((row) => row.label)).toEqual(['Training']);
    expect(tuesday?.pendingTrainingAbsenceIds).toEqual(['pending-training-id']);
    expect(tuesday?.pendingTrainingDisplayRemarks).toBe('Training (pending)');
    expect(tuesday?.paidLeaveHours).toBe(0);
  });

  it('supports overnight work windows when validating time bounds', () => {
    const overnightWindow = { start: '17:00', end: '05:00' };

    expect(isTimeWithinWorkWindow('17:00', overnightWindow)).toBe(true);
    expect(isTimeWithinWorkWindow('23:45', overnightWindow)).toBe(true);
    expect(isTimeWithinWorkWindow('00:15', overnightWindow)).toBe(true);
    expect(isTimeWithinWorkWindow('05:00', overnightWindow)).toBe(true);
    expect(isTimeWithinWorkWindow('12:00', overnightWindow)).toBe(false);
  });

  it('does not count leave on non-working shift days', () => {
    const patternWithoutThursday = cloneWorkShiftPattern({
      ...STANDARD_WORK_SHIFT_PATTERN,
      thursday_am: false,
      thursday_pm: false,
    });
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-26',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Annual Leave', is_paid: true },
        },
      ],
      patternWithoutThursday
    );

    const thursday = states.find((row) => row.day_of_week === 4);
    expect(thursday?.isExpectedShiftDay).toBe(false);
    expect(thursday?.isOnApprovedLeave).toBe(false);
    expect(thursday?.isLeaveLocked).toBe(false);
    expect(thursday?.isPartialLeave).toBe(false);
    expect(thursday?.paidLeaveHours).toBe(0);
    expect(thursday?.leaveLabels).toEqual([]);
    expect(thursday?.displayRemarks).toBe('');
    expect(thursday?.isAnnualLeave).toBe(false);
  });
});

describe('timesheet off-day normalization', () => {
  it('hard-overwrites paid full-day leave to did-not-work with 9.00 hours', () => {
    const entries = buildEntries();
    entries[1] = {
      ...entries[1],
      time_started: '08:00',
      time_finished: '17:00',
      job_number: '1234-AB',
      daily_total: 8.5,
      remarks: 'Worked anyway',
    };

    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Sickness', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: false,
    });

    expect(normalized[1].did_not_work).toBe(true);
    expect(normalized[1].didNotWorkReason).toBe('Sickness');
    expect(normalized[1].time_started).toBe('');
    expect(normalized[1].time_finished).toBe('');
    expect(normalized[1].job_number).toBe('');
    expect(normalized[1].job_numbers).toEqual([]);
    expect(normalized[1].daily_total).toBe(9);
    expect(normalized[1].remarks).toBe('Sickness');
  });

  it('uses 0.00 hours for unpaid full-day leave', () => {
    const entries = buildEntries();
    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Unpaid leave', is_paid: false },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: true,
    });

    expect(normalized[1].did_not_work).toBe(true);
    expect(normalized[1].daily_total).toBe(0);
    expect(normalized[1].remarks).toBe('Unpaid leave');
  });

  it('adds paid half-day credit to worked hours for partial leave', () => {
    const entries = buildEntries();
    entries[1] = {
      ...entries[1],
      time_started: '12:00',
      time_finished: '17:00',
      job_number: '1234-AB',
    };

    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: true,
          half_day_session: 'AM',
          absence_reasons: { name: 'Annual Leave', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: true,
    });

    // 12:00-17:00 = 5.00 worked hours + 4.50 paid leave = 9.50
    expect(normalized[1].did_not_work).toBe(false);
    expect(normalized[1].daily_total).toBe(9.5);
    expect(normalized[1].remarks).toBe('Annual Leave (AM)');
  });

  it('keeps training bookings editable without adding leave credit', () => {
    const entries = buildEntries();
    entries[1] = {
      ...entries[1],
      time_started: '12:00',
      time_finished: '17:00',
      daily_total: 5,
      remarks: '',
    };

    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          id: 'training-absence-id',
          date: '2026-03-24',
          end_date: null,
          is_half_day: true,
          half_day_session: 'AM',
          absence_reasons: { name: 'Training', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: true,
    });

    expect(normalized[1].did_not_work).toBe(false);
    expect(normalized[1].daily_total).toBe(5);
    expect(normalized[1].remarks).toBe('');
  });

  it('keeps unpaid half-day worked hours when persisted times include seconds', () => {
    const entries = buildEntries();
    entries[1] = {
      ...entries[1],
      time_started: '13:00:00',
      time_finished: '15:45:00',
      job_number: '1234-AB',
    };

    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: true,
          half_day_session: 'AM',
          absence_reasons: { name: 'Unpaid leave', is_paid: false },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: true,
    });

    expect(normalized[1].did_not_work).toBe(false);
    expect(normalized[1].daily_total).toBe(2.75);
    expect(normalized[1].remarks).toBe('Unpaid leave (AM)');
  });

  it('adds worked hours on full-day annual leave when override is enabled', () => {
    const entries = buildEntries();
    entries[1] = {
      ...entries[1],
      time_started: '08:00',
      time_finished: '12:00',
      job_number: '1234-AB',
      did_not_work: false,
    };

    const states = resolveTimesheetOffDayStates(
      '2026-03-29',
      [
        {
          date: '2026-03-24',
          end_date: null,
          is_half_day: false,
          allow_timesheet_work_on_leave: true,
          absence_reasons: { name: 'Annual Leave', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: true,
    });

    // 08:00-12:00 = 4.00 worked hours + 9.00 paid leave = 13.00
    expect(normalized[1].did_not_work).toBe(false);
    expect(normalized[1].time_started).toBe('08:00');
    expect(normalized[1].time_finished).toBe('12:00');
    expect(normalized[1].daily_total).toBe(13);
    expect(normalized[1].remarks).toBe('Annual Leave');
  });

  it('defaults non-shift days to Off Shift when no work was entered', () => {
    const entries = buildEntries();
    const states = resolveTimesheetOffDayStates('2026-03-29', [], STANDARD_WORK_SHIFT_PATTERN);

    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: false,
      applyNonShiftDefaults: true,
    });

    expect(normalized[5].did_not_work).toBe(true);
    expect(normalized[5].didNotWorkReason).toBe('Off Shift');
    expect(normalized[5].remarks).toBe('Not on Shift');
  });

  it('keeps non-shift day editable data when hours were entered', () => {
    const entries = buildEntries();
    entries[5] = {
      ...entries[5],
      time_started: '09:00',
      time_finished: '13:00',
      daily_total: 4,
      did_not_work: false,
      remarks: 'Overtime Saturday',
    };

    const states = resolveTimesheetOffDayStates('2026-03-29', [], STANDARD_WORK_SHIFT_PATTERN);
    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: false,
      applyNonShiftDefaults: true,
    });

    expect(normalized[5].did_not_work).toBe(false);
    expect(normalized[5].time_started).toBe('09:00');
    expect(normalized[5].time_finished).toBe('13:00');
    expect(normalized[5].remarks).toBe('Overtime Saturday');
  });

  it('treats multiple job codes as explicit work input on non-shift days', () => {
    const entries = buildEntries();
    entries[5] = {
      ...entries[5],
      job_number: '1234-AB',
      job_numbers: ['1234-AB', '5678-CD'],
      did_not_work: false,
      remarks: 'Weekend split jobs',
    };

    const states = resolveTimesheetOffDayStates('2026-03-29', [], STANDARD_WORK_SHIFT_PATTERN);
    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: false,
      applyNonShiftDefaults: true,
    });

    expect(normalized[5].did_not_work).toBe(false);
    expect(normalized[5].job_numbers).toEqual(['1234-AB', '5678-CD']);
    expect(normalized[5].remarks).toBe('Weekend split jobs');
  });

  it('resets legacy non-shift leave placeholders to off-shift defaults', () => {
    const entries = buildEntries();
    entries[3] = {
      ...entries[3],
      did_not_work: true,
      didNotWorkReason: 'Holiday',
      daily_total: 9,
      remarks: 'Annual Leave',
    };

    const customPattern = {
      ...STANDARD_WORK_SHIFT_PATTERN,
      thursday_am: false,
      thursday_pm: false,
    };
    const states = resolveTimesheetOffDayStates('2026-03-29', [], customPattern);
    const normalized = normalizeTimesheetEntriesForOffDays(entries, states, {
      enforceLeaveOverwrite: false,
      applyNonShiftDefaults: true,
    });

    expect(normalized[3].did_not_work).toBe(true);
    expect(normalized[3].didNotWorkReason).toBe('Off Shift');
    expect(normalized[3].daily_total).toBe(0);
    expect(normalized[3].remarks).toBe('Not on Shift');
  });

  it('retains overnight worked hours when partial leave uses an overnight window', () => {
    const entries = buildEntries();
    entries[1] = {
      ...entries[1],
      time_started: '17:00',
      time_finished: '05:00',
      job_number: '1234-AB',
    };

    const normalized = normalizeTimesheetEntriesForOffDays(entries, [
      {
        day_of_week: 2,
        date: '2026-03-24',
        isExpectedShiftDay: true,
        isOnApprovedLeave: true,
        isLeaveLocked: false,
        isPartialLeave: true,
        hasAmLeave: false,
        hasPmLeave: false,
        workWindow: { start: '17:00', end: '05:00' },
        paidLeaveHours: 0,
        leaveLabels: [],
        trainingLabels: [],
        pendingTrainingLabels: [],
        hasTrainingBooking: false,
        hasPendingTrainingBooking: false,
        trainingAbsenceIds: [],
        pendingTrainingAbsenceIds: [],
        trainingDisplayRemarks: '',
        pendingTrainingDisplayRemarks: '',
        displayRemarks: '',
        leaveReasonName: null,
        leaveReasonColor: null,
        trainingReasonColor: null,
        isAnnualLeave: false,
      },
    ], {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: true,
    });

    expect(normalized[1].daily_total).toBe(11.5);
    expect(normalized[1].did_not_work).toBe(false);
  });
});
