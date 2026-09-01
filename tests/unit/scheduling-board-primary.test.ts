import { describe, expect, it } from 'vitest';
import { SCHEDULING_BOARD_PRIMARIES } from '@/lib/config/scheduling-primary-preference';
import {
  buildScheduleBoardRows,
  getScheduleBoardRowTestId,
} from '@/lib/utils/scheduling-board-primary';
import type {
  ScheduleAssignment,
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantResource,
  ScheduleVisit,
} from '@/types/scheduling';

const DATES = ['2026-07-13', '2026-07-14', '2026-07-15'];

function job(id: string, overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id,
    job_reference: id.toUpperCase(),
    title: `${id} title`,
    description: null,
    site_address: 'Site',
    status: 'scheduled',
    source_type: 'manual',
    start_date: '2026-07-13',
    end_date: '2026-07-15',
    estimated_duration_minutes: 120,
    quote_id: null,
    quote_project_number_id: null,
    customer_id: null,
    customer_site_id: null,
    is_drop_on_ready: false,
    tags: [],
    created_by: null,
    updated_by: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function visit(
  id: string,
  jobId: string,
  startsAt: string,
  endsAt: string
): ScheduleVisit {
  return {
    id,
    job_id: jobId,
    sequence_number: 1,
    title: null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'planned',
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: startsAt,
    updated_at: startsAt,
  };
}

function employee(
  id: string,
  fullName: string
): ScheduleEmployeeResource {
  return {
    id,
    full_name: fullName,
    employee_id: id,
    team_id: 'team-1',
    team_name: 'Arborists',
  };
}

function plantResource(id: string, nickname: string): SchedulePlantResource {
  return {
    id,
    plant_id: id.toUpperCase(),
    nickname,
    make: 'Make',
    model: 'Model',
    status: 'active',
  };
}

function employeeAssignment(
  id: string,
  jobId: string,
  visitId: string | null,
  profileId: string,
  workDate: string,
  employeeResource: ScheduleEmployeeResource | null
): ScheduleAssignment {
  return {
    id,
    job_id: jobId,
    work_date: workDate,
    visit_id: visitId,
    profile_id: profileId,
    resource_type: 'employee',
    employee: employeeResource,
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-07-14T07:00:00Z',
    updated_at: '2026-07-14T07:00:00Z',
    conflicts: [],
    visit: null,
  };
}

function plantAssignment(
  id: string,
  jobId: string,
  visitId: string | null,
  plantId: string,
  workDate: string,
  plant: SchedulePlantResource | null
): ScheduleAssignment {
  return {
    id,
    job_id: jobId,
    work_date: workDate,
    visit_id: visitId,
    plant_id: plantId,
    resource_type: 'plant',
    plant,
    notes: null,
    conflict_override: false,
    conflict_codes: [],
    conflict_override_by: null,
    conflict_override_at: null,
    assigned_by: null,
    created_at: '2026-07-14T07:00:00Z',
    updated_at: '2026-07-14T07:00:00Z',
    conflicts: [],
    visit: null,
  };
}

describe('buildScheduleBoardRows', () => {
  const jobOne = job('job-1');
  const jobTwo = job('job-2', { job_reference: 'JOB-2', title: 'Second' });
  const alex = employee('employee-1', 'Alex Smith');
  const bob = employee('employee-2', 'Bob Jones');
  const loader = plantResource('plant-1', 'Loader');
  const chipper = plantResource('plant-2', 'Chipper');
  const sharedVisit = visit(
    'visit-shared',
    'job-1',
    '2026-07-14T08:00:00Z',
    '2026-07-14T12:00:00Z'
  );
  const unstaffedVisit = visit(
    'visit-open',
    'job-2',
    '2026-07-14T13:00:00Z',
    '2026-07-14T16:00:00Z'
  );

  it('preserves filtered job rows and visit membership for job primary', () => {
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.job,
      jobs: [jobOne, jobTwo],
      visits: [sharedVisit, unstaffedVisit],
      assignments: [
        employeeAssignment('a1', 'job-1', 'visit-shared', 'employee-1', '2026-07-14', alex),
      ],
      employees: [alex, bob],
      plant: [loader],
      dates: DATES,
    });

    expect(rows.map((row) => row.id)).toEqual(['job:job-1', 'job:job-2']);
    expect(rows[0]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id)).toEqual([
      'visit-shared',
    ]);
    expect(rows[1]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id)).toEqual([
      'visit-open',
    ]);
    expect(rows.some((row) => row.kind === 'unassigned')).toBe(false);
  });

  it('splits a two-person visit onto employee rows and puts unstaffed visits in Unassigned', () => {
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.employee,
      jobs: [jobOne, jobTwo],
      visits: [sharedVisit, unstaffedVisit],
      assignments: [
        employeeAssignment('a1', 'job-1', 'visit-shared', 'employee-1', '2026-07-14', alex),
        employeeAssignment('a2', 'job-1', 'visit-shared', 'employee-2', '2026-07-14', bob),
        plantAssignment('p1', 'job-1', 'visit-shared', 'plant-1', '2026-07-14', loader),
      ],
      employees: [alex, bob],
      plant: [loader],
      dates: DATES,
    });

    expect(rows.map((row) => row.id)).toEqual([
      'employee:employee-1',
      'employee:employee-2',
      'unassigned',
    ]);
    expect(getScheduleBoardRowTestId(rows[0]!)).toBe('schedule-board-row-employee-employee-1');
    expect(getScheduleBoardRowTestId(rows[2]!)).toBe('schedule-board-row-unassigned');

    const alexVisitIds = rows[0]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id);
    const bobVisitIds = rows[1]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id);
    expect(alexVisitIds).toEqual(['visit-shared']);
    expect(bobVisitIds).toEqual(['visit-shared']);
    expect(alexVisitIds?.[0]).toBe(bobVisitIds?.[0]);

    expect(rows[0]?.visitsByDate['2026-07-14']?.[0]?.assignments).toHaveLength(3);
    expect(rows[2]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id)).toEqual([
      'visit-open',
    ]);
  });

  it('groups plant primary the same way, with Unassigned for visits without plant', () => {
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.plant,
      jobs: [jobOne, jobTwo],
      visits: [sharedVisit, unstaffedVisit],
      assignments: [
        plantAssignment('p1', 'job-1', 'visit-shared', 'plant-1', '2026-07-14', loader),
        plantAssignment('p2', 'job-1', 'visit-shared', 'plant-2', '2026-07-14', chipper),
        employeeAssignment('a1', 'job-1', 'visit-shared', 'employee-1', '2026-07-14', alex),
      ],
      employees: [alex],
      plant: [loader, chipper],
      dates: DATES,
    });

    expect(rows.map((row) => row.id)).toEqual([
      'plant:plant-2',
      'plant:plant-1',
      'unassigned',
    ]);
    expect(rows[0]?.visitsByDate['2026-07-14']?.[0]?.visit.id).toBe('visit-shared');
    expect(rows[1]?.visitsByDate['2026-07-14']?.[0]?.visit.id).toBe('visit-shared');
    expect(rows[2]?.visitsByDate['2026-07-14']?.[0]?.visit.id).toBe('visit-open');
  });

  it('hides resource rows when job filters remove all of their visits', () => {
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.employee,
      jobs: [jobTwo],
      visits: [sharedVisit, unstaffedVisit],
      assignments: [
        employeeAssignment('a1', 'job-1', 'visit-shared', 'employee-1', '2026-07-14', alex),
      ],
      employees: [alex, bob],
      plant: [],
      dates: DATES,
    });

    expect(rows.map((row) => row.id)).toEqual(['unassigned']);
    expect(rows[0]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id)).toEqual([
      'visit-open',
    ]);
  });

  it('omits Unassigned and empty resource rows when every in-range visit is staffed', () => {
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.employee,
      jobs: [jobOne],
      visits: [sharedVisit],
      assignments: [
        employeeAssignment('a1', 'job-1', 'visit-shared', 'employee-1', '2026-07-14', alex),
      ],
      employees: [alex, bob],
      plant: [],
      dates: DATES,
    });

    expect(rows.map((row) => row.id)).toEqual(['employee:employee-1']);
    expect(rows.some((row) => row.kind === 'unassigned')).toBe(false);
  });

  it('does not create an employee row for untimed own assignments only', () => {
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.employee,
      jobs: [jobOne],
      visits: [sharedVisit],
      assignments: [
        employeeAssignment('legacy-1', 'job-1', null, 'employee-1', '2026-07-14', alex),
      ],
      employees: [alex],
      plant: [],
      dates: DATES,
    });

    expect(rows.map((row) => row.id)).toEqual(['unassigned']);
    expect(rows[0]?.legacyAssignmentsByDate['2026-07-14']).toEqual([]);
  });
});
