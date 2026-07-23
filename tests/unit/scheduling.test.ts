import { describe, expect, it } from 'vitest';
import {
  conflictCodes,
  isDateWithinRange,
  isEmployeeWorkingOnDate,
} from '@/lib/server/scheduling-conflicts';
import {
  enumerateScheduleDates,
  formatScheduleEmployeeCompactName,
  getDailyInitialVisitWindow,
  getScheduleQuoteEndDate,
  getScheduleQuoteStage,
  getSchedulingWeek,
  isScheduleDate,
  mapDailyScheduleClientXToMinutes,
} from '@/lib/utils/scheduling';
import {
  buildEmployeeAssignmentConflicts,
  buildPlantAssignmentConflicts,
} from '@/lib/server/scheduling-board';
import type { ScheduleJob, SchedulePlantResource } from '@/types/scheduling';

function job(id: string, reference: string): ScheduleJob {
  return {
    id,
    job_reference: reference,
    title: reference,
    description: null,
    site_address: null,
    status: 'scheduled',
    source_type: 'manual',
    start_date: '2026-07-13',
    end_date: '2026-07-19',
    estimated_duration_minutes: null,
    quote_id: null,
    quote_project_number_id: null,
    customer_id: null,
    customer_site_id: null,
    is_drop_on_ready: false,
    tags: [],
    created_by: null,
    updated_by: null,
    created_at: '2026-07-13T00:00:00.000Z',
    updated_at: '2026-07-13T00:00:00.000Z',
  };
}

describe('scheduling date utilities', () => {
  it('normalizes any date to a Monday-Sunday week', () => {
    expect(getSchedulingWeek('2026-07-15')).toEqual({
      start: '2026-07-13',
      end: '2026-07-19',
    });
  });

  it('enumerates inclusive job dates', () => {
    expect(enumerateScheduleDates('2026-07-13', '2026-07-15')).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
    ]);
  });

  it('rejects invalid and reversed date ranges', () => {
    expect(enumerateScheduleDates('2026-07-15', '2026-07-13')).toEqual([]);
    expect(isScheduleDate('15/07/2026')).toBe(false);
    expect(isDateWithinRange('2026-07-14', '2026-07-13', '2026-07-15')).toBe(true);
  });
});

describe('daily scheduling coordinate mapping', () => {
  it('snaps pointer coordinates to half-hours without adding scroll twice', () => {
    expect(mapDailyScheduleClientXToMinutes({
      clientX: 392,
      rangeLeft: 200,
      hourWidth: 96,
      startHour: 5,
      endHour: 20,
    })).toBe(420);
  });

  it('clamps starts and caps estimated visit duration at the visible day end', () => {
    expect(mapDailyScheduleClientXToMinutes({
      clientX: -100,
      rangeLeft: 200,
      hourWidth: 64,
      startHour: 5,
      endHour: 20,
    })).toBe(300);
    expect(mapDailyScheduleClientXToMinutes({
      clientX: 9999,
      rangeLeft: 200,
      hourWidth: 96,
      startHour: 5,
      endHour: 20,
    })).toBe(1170);
    expect(getDailyInitialVisitWindow(1170, 400)).toEqual({
      startMinutes: 1170,
      endMinutes: 1200,
      durationMinutes: 30,
    });
    expect(getDailyInitialVisitWindow(420, 400).durationMinutes).toBe(180);
    expect(getDailyInitialVisitWindow(420, null).durationMinutes).toBe(180);
  });
});

describe('scheduling presentation utilities', () => {
  it('groups Quote workflow statuses for the scheduling queue', () => {
    expect(getScheduleQuoteStage('draft')).toBe('draft');
    expect(getScheduleQuoteStage('changes_requested')).toBe('draft');
    expect(getScheduleQuoteStage('sent')).toBe('pending');
    expect(getScheduleQuoteStage('po_received')).toBe('accepted');
    expect(getScheduleQuoteStage('invoiced')).toBe('accepted');
    expect(getScheduleQuoteStage('lost')).toBeNull();
  });

  it('calculates an inclusive Quote planning range with a one-day fallback', () => {
    expect(getScheduleQuoteEndDate('2026-07-13', 3)).toBe('2026-07-15');
    expect(getScheduleQuoteEndDate('2026-07-13', null)).toBe('2026-07-13');
  });

  it('compacts employee names to a first name and surname initial', () => {
    expect(formatScheduleEmployeeCompactName('Matt Doe')).toBe('Matt D');
    expect(formatScheduleEmployeeCompactName('  Alice Mary van Pelt  ')).toBe('Alice P');
    expect(formatScheduleEmployeeCompactName('Prince')).toBe('Prince');
    expect(formatScheduleEmployeeCompactName('')).toBe('Employee');
  });
});

describe('scheduling conflict utilities', () => {
  it('treats either AM or PM as a working day', () => {
    expect(
      isEmployeeWorkingOnDate('2026-07-13', {
        monday_am: false,
        monday_pm: true,
      })
    ).toBe(true);
    expect(
      isEmployeeWorkingOnDate('2026-07-14', {
        tuesday_am: false,
        tuesday_pm: false,
      })
    ).toBe(false);
  });

  it('does not warn when no explicit shift record exists', () => {
    expect(isEmployeeWorkingOnDate('2026-07-13', null)).toBe(true);
  });

  it('deduplicates conflict codes for assignment audit metadata', () => {
    expect(
      conflictCodes([
        { code: 'employee_absent', severity: 'warning', message: 'Absent' },
        { code: 'employee_absent', severity: 'warning', message: 'Still absent' },
        { code: 'employee_off_shift', severity: 'warning', message: 'Off shift' },
      ])
    ).toEqual(['employee_absent', 'employee_off_shift']);
  });

  it('combines employee double-booking, absence, and off-shift warnings', () => {
    const current = { profile_id: 'employee-1', job_id: 'job-1', work_date: '2026-07-13' };
    const other = { profile_id: 'employee-1', job_id: 'job-2', work_date: '2026-07-13' };
    const conflicts = buildEmployeeAssignmentConflicts(
      current,
      [current, other],
      new Map([
        ['job-1', job('job-1', 'JOB-1')],
        ['job-2', job('job-2', 'JOB-2')],
      ]),
      [{ profile_id: 'employee-1', date: '2026-07-13', end_date: null }],
      new Map([
        ['employee-1', { monday_am: false, monday_pm: false }],
      ])
    );

    expect(conflicts.map((conflict) => conflict.code)).toEqual([
      'employee_double_booked',
      'employee_absent',
      'employee_off_shift',
    ]);
  });

  it('combines plant double-booking, status, and dated unavailability warnings', () => {
    const current = { plant_id: 'plant-1', job_id: 'job-1', work_date: '2026-07-13' };
    const other = { plant_id: 'plant-1', job_id: 'job-2', work_date: '2026-07-13' };
    const plant: SchedulePlantResource = {
      id: 'plant-1',
      plant_id: 'P001',
      nickname: 'Loader',
      make: null,
      model: null,
      status: 'maintenance',
    };
    const conflicts = buildPlantAssignmentConflicts(
      current,
      [current, other],
      new Map([
        ['job-1', job('job-1', 'JOB-1')],
        ['job-2', job('job-2', 'JOB-2')],
      ]),
      new Map([['plant-1', plant]]),
      [{
        plant_id: 'plant-1',
        start_date: '2026-07-13',
        end_date: '2026-07-14',
        reason: 'LOLER inspection',
      }]
    );

    expect(conflicts.map((conflict) => conflict.code)).toEqual([
      'plant_double_booked',
      'plant_inactive',
      'plant_unavailable',
    ]);
  });
});
