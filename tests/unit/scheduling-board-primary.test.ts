import { describe, expect, it } from 'vitest';
import { SCHEDULING_BOARD_PRIMARIES } from '@/lib/config/scheduling-primary-preference';
import { formatScheduleVisitTime, toScheduleLondonDateTimeIso } from '@/lib/utils/scheduling';
import {
  buildDateOnlyQuoteInitialVisit,
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
    required_staff_count: null,
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
    kind: 'employee',
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

  it('maps daily buckets from people or plant, preserving all chips and excluding unassigned visits', () => {
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.team,
      jobs: [jobOne, jobTwo], visits: [sharedVisit, unstaffedVisit],
      assignments: [employeeAssignment('a1', 'job-1', 'visit-shared', 'employee-1', '2026-07-14', alex),
        plantAssignment('p1', 'job-1', 'visit-shared', 'plant-1', '2026-07-14', loader)],
      employees: [alex], plant: [loader], dates: DATES,
      teamSettings: { visible_slot_count: 8, names: { '1': 'Oak crew' }, leaders: [], updated_by: null, updated_at: null },
      dayTeams: [{ date: '2026-07-14', slots: [
        { slot_index: 1, work_date: '2026-07-14', members: [{ profile_id: alex.id, employee: alex, work_date: '2026-07-14', slot_index: 1, added_by: null, created_at: '' }], plants: [] },
        { slot_index: 2, work_date: '2026-07-14', members: [], plants: [{ plant_id: loader.id, plant: loader, work_date: '2026-07-14', slot_index: 2, added_by: null, created_at: '' }] },
      ] }],
    });
    expect(rows).toHaveLength(8);
    expect(rows[0]?.teamName).toBe('Oak crew');
    expect(getScheduleBoardRowTestId(rows[0]!)).toBe('schedule-board-row-team-1');
    for (const row of rows.slice(0, 2)) {
      expect(row.visitsByDate['2026-07-14'].map(item => item.visit.id)).toEqual(['visit-shared']);
      expect(row.visitsByDate['2026-07-14'][0].assignments).toHaveLength(2);
      expect(row.visitsByDate['2026-07-15']).toEqual([]);
    }
    expect(rows.some(row => row.kind === 'unassigned')).toBe(false);
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

  it('keeps empty bucket rows without displaying untimed or unteamed work', () => {
    const rows = buildScheduleBoardRows({ primary: SCHEDULING_BOARD_PRIMARIES.team,
      jobs: [jobOne], visits: [sharedVisit], assignments: [employeeAssignment('legacy', 'job-1', null, alex.id, '2026-07-14', alex)],
      employees: [alex], plant: [], dates: DATES });
    expect(rows).toHaveLength(8);
    expect(rows.every(row => Object.values(row.visitsByDate).every(visits => visits.length === 0))).toBe(true);
    expect(rows.some(row => row.kind === 'unassigned')).toBe(false);
  });

  it('omits jobs with no visits, legacy assignments, cancelled visits, or visits outside the dates', () => {
    const legacyOnly = job('job-legacy', { start_date: '2026-07-13', end_date: '2026-07-15' });
    const untimed = job('job-none');
    const cancelled = job('job-cancelled');
    const otherPeriod = job('job-other', { start_date: '2026-08-01', end_date: '2026-08-02' });
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.job,
      jobs: [jobOne, legacyOnly, untimed, cancelled, otherPeriod],
      visits: [
        sharedVisit,
        { ...visit('visit-cancelled', 'job-cancelled', '2026-07-14T08:00:00Z', '2026-07-14T10:00:00Z'), status: 'cancelled' },
        visit('visit-other', 'job-other', '2026-08-01T08:00:00Z', '2026-08-01T10:00:00Z'),
      ],
      assignments: [
        employeeAssignment('legacy-1', 'job-legacy', null, 'employee-1', '2026-07-14', alex),
      ],
      employees: [alex],
      plant: [],
      dates: DATES,
    });

    expect(rows.map((row) => row.id)).toEqual(['job:job-1']);
    expect(rows[0]?.legacyAssignmentsByDate['2026-07-14']).toEqual([]);
  });

  it('keeps a visit that overlaps a day even when the job plan dates do not', () => {
    const mismatched = job('job-mismatch', {
      start_date: '2026-08-01',
      end_date: '2026-08-02',
    });
    const overnight = visit(
      'visit-overnight',
      'job-mismatch',
      toScheduleLondonDateTimeIso('2026-07-13', '22:00'),
      toScheduleLondonDateTimeIso('2026-07-14', '01:00')
    );
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.job,
      jobs: [mismatched],
      visits: [overnight],
      assignments: [],
      employees: [],
      plant: [],
      dates: ['2026-07-14'],
    });

    expect(rows.map((row) => row.id)).toEqual(['job:job-mismatch']);
    expect(rows[0]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id)).toEqual([
      'visit-overnight',
    ]);
  });

  it('includes boundary overlap and excludes visits that only touch a day boundary', () => {
    const boundaryJob = job('job-boundary');
    const overlapping = visit(
      'visit-overlap',
      'job-boundary',
      toScheduleLondonDateTimeIso('2026-07-13', '23:00'),
      toScheduleLondonDateTimeIso('2026-07-14', '00:30')
    );
    const endsAtStart = visit(
      'visit-touch-start',
      'job-boundary',
      toScheduleLondonDateTimeIso('2026-07-13', '22:00'),
      toScheduleLondonDateTimeIso('2026-07-14', '00:00')
    );
    const startsAtEnd = visit(
      'visit-touch-end',
      'job-boundary',
      toScheduleLondonDateTimeIso('2026-07-15', '00:00'),
      toScheduleLondonDateTimeIso('2026-07-15', '02:00')
    );
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.job,
      jobs: [boundaryJob],
      visits: [endsAtStart, overlapping, startsAtEnd],
      assignments: [],
      employees: [],
      plant: [],
      dates: ['2026-07-14'],
    });

    expect(rows[0]?.visitsByDate['2026-07-14']?.map((item) => item.visit.id)).toEqual([
      'visit-overlap',
    ]);
  });

  it('keeps plant assignment on the overlapping day of an overnight visit', () => {
    const machine = plantResource('plant-night', 'Night chipper');
    const overnight = visit('night', 'job-1', toScheduleLondonDateTimeIso('2026-07-13', '22:00'), toScheduleLondonDateTimeIso('2026-07-14', '01:00'));
    const rows = buildScheduleBoardRows({
      primary: SCHEDULING_BOARD_PRIMARIES.plant, jobs: [jobOne], visits: [overnight],
      assignments: [plantAssignment('night-assignment', 'job-1', 'night', machine.id, '2026-07-13', machine)],
      employees: [], plant: [machine], dates: ['2026-07-14'],
    });
    expect(rows.map(row => row.id)).toEqual(['plant:plant-night']);
    expect(rows[0].visitsByDate['2026-07-14'][0].visit.id).toBe('night');
  });

  it('builds an 08:00 initial visit capped by the existing estimate helper', () => {
    const defaultVisit = buildDateOnlyQuoteInitialVisit('2026-07-14', null);
    const shortVisit = buildDateOnlyQuoteInitialVisit('2026-07-14', 60);
    const cappedVisit = buildDateOnlyQuoteInitialVisit('2026-07-14', 400);

    expect(formatScheduleVisitTime(defaultVisit.starts_at)).toBe('08:00');
    expect(formatScheduleVisitTime(defaultVisit.ends_at)).toBe('11:00');
    expect(formatScheduleVisitTime(shortVisit.ends_at)).toBe('09:00');
    expect(formatScheduleVisitTime(cappedVisit.ends_at)).toBe('11:00');
  });
});
