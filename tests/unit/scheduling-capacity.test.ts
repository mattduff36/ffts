import { describe, expect, it } from 'vitest';
import { buildEmployeeCapacity } from '@/lib/server/scheduling-capacity';
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

function capacity(options: {
  assignments?: ScheduleEmployeeAssignment[];
  absences?: Array<{
    profile_id: string;
    date: string;
    end_date: string | null;
    is_half_day: boolean;
    half_day_session: 'AM' | 'PM' | null;
  }>;
  shift?: Record<string, boolean>;
} = {}) {
  return buildEmployeeCapacity({
    dates: [workDate],
    employees: [employee],
    assignments: options.assignments || [],
    absences: options.absences || [],
    shifts: options.shift
      ? new Map([[employee.id, options.shift]])
      : new Map(),
  })[0];
}

describe('weekly employee capacity', () => {
  it('uses a 7.5-hour day and leaves 3.5 hours after an 08:00–12:00 booking', () => {
    const morning = visit(
      'morning',
      '2026-01-12T08:00:00.000Z',
      '2026-01-12T12:00:00.000Z'
    );

    expect(capacity().employees[0].available_minutes).toBe(450);
    expect(capacity({ assignments: [assignment('a1', morning)] }).employees[0].available_minutes)
      .toBe(210);
  });

  it('merges overlapping bookings and ignores cancelled visits', () => {
    const first = visit(
      'first',
      '2026-01-12T08:00:00.000Z',
      '2026-01-12T12:00:00.000Z'
    );
    const second = visit(
      'second',
      '2026-01-12T10:00:00.000Z',
      '2026-01-12T14:00:00.000Z'
    );
    const cancelled = visit(
      'cancelled',
      '2026-01-12T14:00:00.000Z',
      '2026-01-12T16:00:00.000Z',
      'cancelled'
    );

    expect(capacity({
      assignments: [
        assignment('a1', first),
        assignment('a2', second),
        assignment('a3', cancelled),
      ],
    }).employees[0].available_minutes).toBe(90);
  });

  it('prorates half shifts and approved half-day absences', () => {
    expect(capacity({
      shift: { monday_am: true, monday_pm: false },
    }).employees[0].available_minutes).toBe(225);

    expect(capacity({
      absences: [{
        profile_id: employee.id,
        date: workDate,
        end_date: null,
        is_half_day: true,
        half_day_session: 'AM',
      }],
    }).employees[0].available_minutes).toBe(225);
  });

  it('returns no capacity for full-day absence, off-shift days, or untimed assignments', () => {
    const fullDay = capacity({
      absences: [{
        profile_id: employee.id,
        date: workDate,
        end_date: null,
        is_half_day: false,
        half_day_session: null,
      }],
    });
    const offShift = capacity({
      shift: { monday_am: false, monday_pm: false },
    });
    const untimed = capacity({
      assignments: [assignment('untimed', null)],
    });

    expect(fullDay.available_employee_count).toBe(0);
    expect(offShift.available_employee_count).toBe(0);
    expect(untimed.available_employee_count).toBe(0);
  });
});
