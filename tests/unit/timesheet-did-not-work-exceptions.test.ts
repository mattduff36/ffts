import { describe, expect, it } from 'vitest';
import {
  formatDidNotWorkReasonRemark,
  getMissingScheduledDidNotWorkReasonException,
  getScheduledDidNotWorkExceptions,
  parseDidNotWorkReasonRemark,
} from '@/lib/utils/timesheet-did-not-work-exceptions';
import { resolveTimesheetOffDayStates, type TimesheetEntryLike } from '@/lib/utils/timesheet-off-days';
import { STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';

function buildEntry(dayOfWeek: number, overrides: Partial<TimesheetEntryLike> = {}): TimesheetEntryLike {
  return {
    day_of_week: dayOfWeek,
    time_started: '',
    time_finished: '',
    job_number: '',
    job_numbers: [],
    working_in_yard: false,
    did_not_work: false,
    didNotWorkReason: null,
    daily_total: null,
    remarks: '',
    ...overrides,
  };
}

describe('scheduled Did Not Work exceptions', () => {
  it('requires and extracts a reason for scheduled working days', () => {
    const states = resolveTimesheetOffDayStates('2026-05-03', [], STANDARD_WORK_SHIFT_PATTERN);
    const entries = [
      buildEntry(3, {
        did_not_work: true,
        remarks: formatDidNotWorkReasonRemark('Off sick'),
      }),
    ];

    expect(getScheduledDidNotWorkExceptions(entries, states, '2026-05-03')).toEqual([
      {
        dayOfWeek: 3,
        dayName: 'Wednesday',
        date: '2026-04-29',
        reason: 'Off sick',
      },
    ]);
    expect(getMissingScheduledDidNotWorkReasonException(entries, states, '2026-05-03')).toBeNull();
  });

  it('ignores non-shift days, approved leave, and training bookings', () => {
    const states = resolveTimesheetOffDayStates(
      '2026-05-03',
      [
        {
          date: '2026-04-29',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Annual Leave', is_paid: true },
        },
        {
          date: '2026-05-01',
          end_date: null,
          is_half_day: false,
          absence_reasons: { name: 'Training', is_paid: true },
        },
      ],
      STANDARD_WORK_SHIFT_PATTERN
    );
    const entries = [
      buildEntry(3, { did_not_work: true, remarks: 'Annual Leave' }),
      buildEntry(5, { did_not_work: true, remarks: 'Training' }),
      buildEntry(6, { did_not_work: true, remarks: 'Not on Shift' }),
    ];

    expect(getScheduledDidNotWorkExceptions(entries, states, '2026-05-03')).toEqual([]);
  });

  it('flags scheduled Did Not Work entries without a reason', () => {
    const states = resolveTimesheetOffDayStates('2026-05-03', [], STANDARD_WORK_SHIFT_PATTERN);
    const missingReason = getMissingScheduledDidNotWorkReasonException(
      [buildEntry(2, { did_not_work: true, remarks: 'Did Not Work' })],
      states,
      '2026-05-03'
    );

    expect(missingReason?.dayName).toBe('Tuesday');
    expect(parseDidNotWorkReasonRemark('Did Not Work: Medical appointment')).toBe('Medical appointment');
  });
});
