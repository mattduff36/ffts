import { describe, expect, it } from 'vitest';
import { resolveTimesheetOffDayStates } from '@/lib/utils/timesheet-off-days';
import {
  applyPendingTrainingBookingsToOffDayStates,
  formatHalfDayTrainingRemark,
  getHalfDayTrainingRemarkForOffDayState,
  getPendingDidNotWorkBookingsPayload,
  type PendingDidNotWorkBookingMap,
} from '@/lib/utils/timesheet-did-not-work-bookings';
import { STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';

describe('timesheet Did Not Work booking helpers', () => {
  it('overlays pending training bookings as effective training days', () => {
    const states = resolveTimesheetOffDayStates('2026-05-03', [], STANDARD_WORK_SHIFT_PATTERN);
    const bookings: PendingDidNotWorkBookingMap = {
      1: {
        dayOfWeek: 2,
        dayName: 'Tuesday',
        date: '2026-04-28',
        kind: 'training',
        trainingSession: 'PM',
      },
    };

    const effectiveStates = applyPendingTrainingBookingsToOffDayStates(states, bookings);
    const tuesday = effectiveStates.find((state) => state.day_of_week === 2);

    expect(tuesday?.hasTrainingBooking).toBe(true);
    expect(tuesday?.trainingLabels.map((label) => label.label)).toEqual(['Training (PM)']);
    expect(tuesday?.trainingDisplayRemarks).toBe('Training (PM)');
    expect(getHalfDayTrainingRemarkForOffDayState(tuesday)).toBe('TRAINING - Half day training (PM)');
  });

  it('formats the payroll remark for half-day training', () => {
    expect(formatHalfDayTrainingRemark('AM')).toBe('TRAINING - Half day training (AM)');
  });

  it('serializes pending bookings in day order for the commit route', () => {
    const bookings: PendingDidNotWorkBookingMap = {
      4: {
        dayOfWeek: 5,
        dayName: 'Friday',
        date: '2026-05-01',
        kind: 'sickness',
      },
      0: {
        dayOfWeek: 1,
        dayName: 'Monday',
        date: '2026-04-27',
        kind: 'training',
        trainingSession: 'FULL',
      },
    };

    expect(getPendingDidNotWorkBookingsPayload(bookings)).toEqual([
      {
        dayOfWeek: 1,
        date: '2026-04-27',
        kind: 'training',
        trainingSession: 'FULL',
      },
      {
        dayOfWeek: 5,
        date: '2026-05-01',
        kind: 'sickness',
      },
    ]);
  });
});
