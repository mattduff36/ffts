import {
  SCHEDULING_BOARD_PRIMARIES,
  type SchedulingBoardPrimary,
} from '@/lib/config/scheduling-primary-preference';
import { getScheduleVisitDate } from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantResource,
  ScheduleVisit,
} from '@/types/scheduling';

export type ScheduleBoardRowKind = 'job' | 'employee' | 'plant' | 'unassigned';

export interface ScheduleBoardHiddenAssignment {
  type: 'employee' | 'plant';
  id: string;
}

export interface ScheduleBoardVisitPlacement {
  job: ScheduleJob;
  visit: ScheduleVisit;
  assignments: ScheduleAssignment[];
}

export interface ScheduleBoardRow {
  id: string;
  kind: ScheduleBoardRowKind;
  job: ScheduleJob | null;
  employee: ScheduleEmployeeResource | null;
  plant: SchedulePlantResource | null;
  hiddenAssignment: ScheduleBoardHiddenAssignment | null;
  visitsByDate: Record<string, ScheduleBoardVisitPlacement[]>;
  legacyAssignmentsByDate: Record<string, ScheduleAssignment[]>;
}

export interface BuildScheduleBoardRowsInput {
  primary: SchedulingBoardPrimary;
  jobs: ScheduleJob[];
  visits: ScheduleVisit[];
  assignments: ScheduleAssignment[];
  employees: ScheduleEmployeeResource[];
  plant: SchedulePlantResource[];
  dates: string[];
}

function assignmentResourceId(assignment: ScheduleAssignment): string {
  return assignment.resource_type === 'employee'
    ? assignment.profile_id
    : assignment.plant_id;
}

function emptyDateBuckets(dates: string[]): Pick<
  ScheduleBoardRow,
  'visitsByDate' | 'legacyAssignmentsByDate'
> {
  const visitsByDate: Record<string, ScheduleBoardVisitPlacement[]> = {};
  const legacyAssignmentsByDate: Record<string, ScheduleAssignment[]> = {};
  for (const date of dates) {
    visitsByDate[date] = [];
    legacyAssignmentsByDate[date] = [];
  }
  return { visitsByDate, legacyAssignmentsByDate };
}

function rowHasVisibleWork(
  dates: string[],
  visitsByDate: Record<string, ScheduleBoardVisitPlacement[]>,
  legacyAssignmentsByDate: Record<string, ScheduleAssignment[]>
): boolean {
  return dates.some(
    (date) =>
      (visitsByDate[date]?.length || 0) > 0
      || (legacyAssignmentsByDate[date]?.length || 0) > 0
  );
}

function sortPlacements(
  placements: ScheduleBoardVisitPlacement[]
): ScheduleBoardVisitPlacement[] {
  return [...placements].sort((first, second) =>
    first.visit.starts_at.localeCompare(second.visit.starts_at)
  );
}

function buildJobRows(
  jobs: ScheduleJob[],
  visits: ScheduleVisit[],
  assignments: ScheduleAssignment[],
  dates: string[]
): ScheduleBoardRow[] {
  const dateSet = new Set(dates);
  return jobs.map((job) => {
    const { visitsByDate, legacyAssignmentsByDate } = emptyDateBuckets(dates);
    const jobAssignments = assignments.filter(
      (assignment) => assignment.job_id === job.id
    );

    for (const visit of visits) {
      if (visit.job_id !== job.id) continue;
      const date = getScheduleVisitDate(visit.starts_at);
      if (!dateSet.has(date)) continue;
      visitsByDate[date].push({
        job,
        visit,
        assignments: jobAssignments.filter(
          (assignment) => assignment.visit_id === visit.id
        ),
      });
    }

    for (const assignment of jobAssignments) {
      if (assignment.visit_id || !dateSet.has(assignment.work_date)) continue;
      legacyAssignmentsByDate[assignment.work_date].push(assignment);
    }

    for (const date of dates) {
      visitsByDate[date] = sortPlacements(visitsByDate[date]);
    }

    return {
      id: `job:${job.id}`,
      kind: 'job',
      job,
      employee: null,
      plant: null,
      hiddenAssignment: null,
      visitsByDate,
      legacyAssignmentsByDate,
    };
  });
}

function collectVisitAssignments(
  assignments: ScheduleAssignment[],
  visitId: string
): ScheduleAssignment[] {
  return assignments.filter((assignment) => assignment.visit_id === visitId);
}

function buildResourceRows(
  primary: 'employee' | 'plant',
  jobs: ScheduleJob[],
  visits: ScheduleVisit[],
  assignments: ScheduleAssignment[],
  employees: ScheduleEmployeeResource[],
  plant: SchedulePlantResource[],
  dates: string[]
): ScheduleBoardRow[] {
  const dateSet = new Set(dates);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const visitsById = new Map(
    visits
      .filter((visit) => {
        if (!jobsById.has(visit.job_id)) return false;
        return dateSet.has(getScheduleVisitDate(visit.starts_at));
      })
      .map((visit) => [visit.id, visit])
  );
  const scopedAssignments = assignments.filter(
    (assignment) =>
      jobsById.has(assignment.job_id) && dateSet.has(assignment.work_date)
  );
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const plantById = new Map(plant.map((item) => [item.id, item]));

  for (const assignment of scopedAssignments) {
    if (assignment.resource_type === 'employee' && assignment.employee) {
      employeesById.set(assignment.profile_id, assignment.employee);
    }
    if (assignment.resource_type === 'plant' && assignment.plant) {
      plantById.set(assignment.plant_id, assignment.plant);
    }
  }

  const resourceIds = new Set<string>();
  for (const assignment of scopedAssignments) {
    if (assignment.resource_type === primary) {
      resourceIds.add(assignmentResourceId(assignment));
    }
  }

  const rows: ScheduleBoardRow[] = [];
  for (const resourceId of resourceIds) {
    const { visitsByDate, legacyAssignmentsByDate } = emptyDateBuckets(dates);
    const ownAssignments = scopedAssignments.filter(
      (assignment) =>
        assignment.resource_type === primary
        && assignmentResourceId(assignment) === resourceId
    );
    const placedVisitIds = new Set<string>();

    for (const assignment of ownAssignments) {
      if (!assignment.visit_id) continue;
      if (placedVisitIds.has(assignment.visit_id)) continue;
      const visit = visitsById.get(assignment.visit_id);
      const job = visit ? jobsById.get(visit.job_id) : undefined;
      if (!visit || !job) continue;
      const date = getScheduleVisitDate(visit.starts_at);
      visitsByDate[date].push({
        job,
        visit,
        assignments: collectVisitAssignments(assignments, visit.id),
      });
      placedVisitIds.add(visit.id);
    }

    if (!rowHasVisibleWork(dates, visitsByDate, legacyAssignmentsByDate)) {
      continue;
    }

    for (const date of dates) {
      visitsByDate[date] = sortPlacements(visitsByDate[date]);
    }

    if (primary === 'employee') {
      const employee = employeesById.get(resourceId) || {
        id: resourceId,
        full_name: 'Employee',
        employee_id: null,
        team_id: null,
        team_name: null,
      };
      rows.push({
        id: `employee:${resourceId}`,
        kind: 'employee',
        job: null,
        employee,
        plant: null,
        hiddenAssignment: { type: 'employee', id: resourceId },
        visitsByDate,
        legacyAssignmentsByDate,
      });
      continue;
    }

    const plantResource = plantById.get(resourceId) || {
      id: resourceId,
      plant_id: resourceId,
      nickname: null,
      make: null,
      model: null,
      status: null,
    };
    rows.push({
      id: `plant:${resourceId}`,
      kind: 'plant',
      job: null,
      employee: null,
      plant: plantResource,
      hiddenAssignment: { type: 'plant', id: resourceId },
      visitsByDate,
      legacyAssignmentsByDate,
    });
  }

  rows.sort((first, second) => {
    const firstLabel =
      first.kind === 'employee'
        ? first.employee?.full_name || first.id
        : first.plant?.nickname || first.plant?.plant_id || first.id;
    const secondLabel =
      second.kind === 'employee'
        ? second.employee?.full_name || second.id
        : second.plant?.nickname || second.plant?.plant_id || second.id;
    return firstLabel.localeCompare(secondLabel);
  });

  const unassignedVisits = [...visitsById.values()].filter((visit) =>
    !scopedAssignments.some(
      (assignment) =>
        assignment.visit_id === visit.id
        && assignment.resource_type === primary
    )
  );
  if (unassignedVisits.length > 0) {
    const { visitsByDate, legacyAssignmentsByDate } = emptyDateBuckets(dates);
    for (const visit of unassignedVisits) {
      const job = jobsById.get(visit.job_id);
      if (!job) continue;
      const date = getScheduleVisitDate(visit.starts_at);
      visitsByDate[date].push({
        job,
        visit,
        assignments: collectVisitAssignments(assignments, visit.id),
      });
    }
    for (const date of dates) {
      visitsByDate[date] = sortPlacements(visitsByDate[date]);
    }
    rows.push({
      id: 'unassigned',
      kind: 'unassigned',
      job: null,
      employee: null,
      plant: null,
      hiddenAssignment: null,
      visitsByDate,
      legacyAssignmentsByDate,
    });
  }

  return rows;
}

export function buildScheduleBoardRows(
  input: BuildScheduleBoardRowsInput
): ScheduleBoardRow[] {
  if (input.primary === SCHEDULING_BOARD_PRIMARIES.job) {
    return buildJobRows(input.jobs, input.visits, input.assignments, input.dates);
  }

  return buildResourceRows(
    input.primary,
    input.jobs,
    input.visits,
    input.assignments,
    input.employees,
    input.plant,
    input.dates
  );
}

export function filterHiddenBoardAssignments(
  assignments: ScheduleAssignment[],
  hiddenAssignment: ScheduleBoardHiddenAssignment | null
): ScheduleAssignment[] {
  if (!hiddenAssignment) return assignments;
  return assignments.filter(
    (assignment) =>
      assignment.resource_type !== hiddenAssignment.type
      || assignmentResourceId(assignment) !== hiddenAssignment.id
  );
}

export function getScheduleBoardRowTestId(row: ScheduleBoardRow): string {
  if (row.kind === 'unassigned') return 'schedule-board-row-unassigned';
  if (row.kind === 'job' && row.job) return `schedule-board-row-job-${row.job.id}`;
  if (row.kind === 'employee' && row.employee) {
    return `schedule-board-row-employee-${row.employee.id}`;
  }
  if (row.kind === 'plant' && row.plant) {
    return `schedule-board-row-plant-${row.plant.id}`;
  }
  return `schedule-board-row-${row.id}`;
}

export function getScheduleBoardCellTestId(
  row: ScheduleBoardRow,
  date: string
): string {
  if (row.kind === 'job' && row.job) return `schedule-cell-${row.job.id}-${date}`;
  if (row.kind === 'employee' && row.employee) {
    return `schedule-cell-employee-${row.employee.id}-${date}`;
  }
  if (row.kind === 'plant' && row.plant) {
    return `schedule-cell-plant-${row.plant.id}-${date}`;
  }
  return `schedule-cell-unassigned-${date}`;
}

export function getScheduleBoardDailyRailTestId(row: ScheduleBoardRow): string {
  if (row.kind === 'job' && row.job) return `schedule-daily-job-cell-${row.job.id}`;
  if (row.kind === 'employee' && row.employee) {
    return `schedule-daily-row-cell-employee-${row.employee.id}`;
  }
  if (row.kind === 'plant' && row.plant) {
    return `schedule-daily-row-cell-plant-${row.plant.id}`;
  }
  return 'schedule-daily-row-cell-unassigned';
}

export function getScheduleBoardAxisLabel(
  primary: SchedulingBoardPrimary
): string {
  if (primary === SCHEDULING_BOARD_PRIMARIES.employee) return 'Employee';
  if (primary === SCHEDULING_BOARD_PRIMARIES.plant) return 'Plant';
  return 'Job';
}

export function getScheduleBoardTitle(
  viewLabel: 'Daily' | 'Weekly',
  primary: SchedulingBoardPrimary
): string {
  if (primary === SCHEDULING_BOARD_PRIMARIES.employee) {
    return `${viewLabel} employee board`;
  }
  if (primary === SCHEDULING_BOARD_PRIMARIES.plant) {
    return `${viewLabel} plant board`;
  }
  return `${viewLabel} job board`;
}
