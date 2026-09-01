import { describe, expect, it } from 'vitest';
import { buildEmployeeDaySessions } from '@/lib/server/scheduling-capacity';
import {
  OCCUPANCY_AM_END_MINUTES,
  OCCUPANCY_EARLY_BUFFER_END_MINUTES,
  OCCUPANCY_PM_END_MINUTES,
  OCCUPANCY_STRIP_END_MINUTES,
  OCCUPANCY_STRIP_START_MINUTES,
  buildEmployeeOccupancySegments,
} from '@/lib/utils/scheduling-occupancy';
import type {
  ScheduleEmployeeAssignment,
  ScheduleEmployeeResource,
  ScheduleVisit,
} from '@/types/scheduling';

const workDate = '2026-01-12';
const employee: ScheduleEmployeeResource = {
  id: 'employee-1',
  full_name: 'Alex Smith',
  employee_id: 'E001',
  team_id: 'team-1',
  team_name: 'Arborists',
};

function visit(
  id: string,
  startsAt: string,
  endsAt: string,
  status: ScheduleVisit['status'] = 'planned'
): ScheduleVisit {
  return {
    id,
    job_id: `job-${id}`,
    sequence_number: 1,
    title: null,
    starts_at: startsAt,
    ends_at: endsAt,
    status,
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function assignment(
  id: string,
  scheduledVisit: ScheduleVisit | null
): ScheduleEmployeeAssignment {
  return {
    id,
    job_id: scheduledVisit?.job_id || `job-${id}`,
    work_date: workDate,
    visit_id: scheduledVisit?.id || null,
    profile_id: employee.id,
    resource_type: 'employee',
    employee,
    visit: scheduledVisit,
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    conflicts: [],
  };
}

function segments(options: {
  assignments?: ScheduleEmployeeAssignment[];
  am?: 'working' | 'off_shift' | 'absent';
  pm?: 'working' | 'off_shift' | 'absent';
} = {}) {
  return buildEmployeeOccupancySegments({
    profileId: employee.id,
    workDate,
    assignments: options.assignments || [],
    sessions: [{
      profile_id: employee.id,
      date: workDate,
      am: options.am || 'working',
      pm: options.pm || 'working',
    }],
  });
}

describe('employee occupancy segments', () => {
  it('occupancy-booked-visit paints 07:30–10:30 booked and leaves buffers available', () => {
    const result = segments({
      assignments: [assignment(
        'a1',
        visit('timed', '2026-01-12T07:30:00.000Z', '2026-01-12T10:30:00.000Z')
      )],
    });

    expect(result).toEqual([
      { startMinutes: OCCUPANCY_STRIP_START_MINUTES, endMinutes: 7 * 60 + 30, state: 'available' },
      { startMinutes: 7 * 60 + 30, endMinutes: 10 * 60 + 30, state: 'booked' },
      { startMinutes: 10 * 60 + 30, endMinutes: OCCUPANCY_STRIP_END_MINUTES, state: 'available' },
    ]);
  });

  it('occupancy-buffers-empty keeps 07:00–08:00 and 16:30–17:30 available when PM is off-shift', () => {
    expect(segments({ pm: 'off_shift' })).toEqual([
      {
        startMinutes: OCCUPANCY_STRIP_START_MINUTES,
        endMinutes: OCCUPANCY_AM_END_MINUTES,
        state: 'available',
      },
      {
        startMinutes: OCCUPANCY_AM_END_MINUTES,
        endMinutes: OCCUPANCY_PM_END_MINUTES,
        state: 'unavailable',
      },
      {
        startMinutes: OCCUPANCY_PM_END_MINUTES,
        endMinutes: OCCUPANCY_STRIP_END_MINUTES,
        state: 'available',
      },
    ]);
  });

  it('occupancy-absence-am paints 08:00–12:00 unavailable and leaves buffers and PM available', () => {
    expect(segments({ am: 'absent' })).toEqual([
      {
        startMinutes: OCCUPANCY_STRIP_START_MINUTES,
        endMinutes: OCCUPANCY_EARLY_BUFFER_END_MINUTES,
        state: 'available',
      },
      {
        startMinutes: OCCUPANCY_EARLY_BUFFER_END_MINUTES,
        endMinutes: OCCUPANCY_AM_END_MINUTES,
        state: 'unavailable',
      },
      {
        startMinutes: OCCUPANCY_AM_END_MINUTES,
        endMinutes: OCCUPANCY_STRIP_END_MINUTES,
        state: 'available',
      },
    ]);
  });

  it('occupancy-off-shift-pm paints 12:00–16:30 unavailable and keeps the late buffer available', () => {
    expect(segments({ pm: 'off_shift' })).toEqual([
      {
        startMinutes: OCCUPANCY_STRIP_START_MINUTES,
        endMinutes: OCCUPANCY_AM_END_MINUTES,
        state: 'available',
      },
      {
        startMinutes: OCCUPANCY_AM_END_MINUTES,
        endMinutes: OCCUPANCY_PM_END_MINUTES,
        state: 'unavailable',
      },
      {
        startMinutes: OCCUPANCY_PM_END_MINUTES,
        endMinutes: OCCUPANCY_STRIP_END_MINUTES,
        state: 'available',
      },
    ]);
  });

  it('occupancy-full-day-absence paints the whole 07:00–17:30 strip unavailable', () => {
    expect(segments({ am: 'absent', pm: 'absent' })).toEqual([{
      startMinutes: OCCUPANCY_STRIP_START_MINUTES,
      endMinutes: OCCUPANCY_STRIP_END_MINUTES,
      state: 'unavailable',
    }]);
  });

  it('occupancy-untimed paints the whole visible range booked', () => {
    expect(segments({ assignments: [assignment('untimed', null)] })).toEqual([{
      startMinutes: OCCUPANCY_STRIP_START_MINUTES,
      endMinutes: OCCUPANCY_STRIP_END_MINUTES,
      state: 'booked',
    }]);
  });

  it('occupancy-booked-wins keeps a visit booked over an absence window', () => {
    expect(segments({
      am: 'absent',
      assignments: [assignment(
        'overlap',
        visit('overlap', '2026-01-12T11:00:00.000Z', '2026-01-12T13:00:00.000Z')
      )],
    })).toEqual([
      {
        startMinutes: OCCUPANCY_STRIP_START_MINUTES,
        endMinutes: OCCUPANCY_EARLY_BUFFER_END_MINUTES,
        state: 'available',
      },
      { startMinutes: OCCUPANCY_EARLY_BUFFER_END_MINUTES, endMinutes: 11 * 60, state: 'unavailable' },
      { startMinutes: 11 * 60, endMinutes: 13 * 60, state: 'booked' },
      { startMinutes: 13 * 60, endMinutes: OCCUPANCY_STRIP_END_MINUTES, state: 'available' },
    ]);
  });

  it('occupancy-clip-outside clips a 06:00–08:00 visit to 07:00–08:00', () => {
    expect(segments({
      assignments: [assignment(
        'early',
        visit('early', '2026-01-12T06:00:00.000Z', '2026-01-12T08:00:00.000Z')
      )],
    })).toEqual([
      {
        startMinutes: OCCUPANCY_STRIP_START_MINUTES,
        endMinutes: OCCUPANCY_EARLY_BUFFER_END_MINUTES,
        state: 'booked',
      },
      {
        startMinutes: OCCUPANCY_EARLY_BUFFER_END_MINUTES,
        endMinutes: OCCUPANCY_STRIP_END_MINUTES,
        state: 'available',
      },
    ]);
  });

  it('treats missing sessions as both AM and PM working', () => {
    expect(buildEmployeeOccupancySegments({
      profileId: employee.id,
      workDate,
      assignments: [],
    })).toEqual([{
      startMinutes: OCCUPANCY_STRIP_START_MINUTES,
      endMinutes: OCCUPANCY_STRIP_END_MINUTES,
      state: 'available',
    }]);
  });
});

describe('employee day sessions', () => {
  it('classifies off-shift, half-day absence, and full-day absence', () => {
    const [working, offPm, halfAm, fullDay] = buildEmployeeDaySessions({
      dates: [workDate],
      employees: [
        employee,
        { ...employee, id: 'employee-2' },
        { ...employee, id: 'employee-3' },
        { ...employee, id: 'employee-4' },
      ],
      absences: [{
        profile_id: 'employee-3',
        date: workDate,
        end_date: null,
        is_half_day: true,
        half_day_session: 'AM',
      }, {
        profile_id: 'employee-4',
        date: workDate,
        end_date: null,
        is_half_day: false,
        half_day_session: null,
      }],
      shifts: new Map([
        ['employee-2', { monday_am: true, monday_pm: false }],
      ]),
    });

    expect(working).toMatchObject({ am: 'working', pm: 'working' });
    expect(offPm).toMatchObject({ am: 'working', pm: 'off_shift' });
    expect(halfAm).toMatchObject({ am: 'absent', pm: 'working' });
    expect(fullDay).toMatchObject({ am: 'absent', pm: 'absent' });
  });
});
