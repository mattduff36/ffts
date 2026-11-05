import { resolveScheduleDayTeamName, defaultScheduleTeamSettings, visibleScheduleDayTeamSlotIndexes } from '@/lib/utils/scheduling-day-teams';
import { addDays, format, parseISO } from 'date-fns';
import {
  SCHEDULING_BOARD_PRIMARIES,
  type SchedulingBoardPrimary,
} from '@/lib/config/scheduling-primary-preference';
import {
  getDailyInitialVisitWindow,
  toScheduleLondonDateTimeIso,
} from '@/lib/utils/scheduling';
import type {
  ScheduleDayTeams,
  ScheduleTeamSettings,
  ScheduleAssignment,
  ScheduleEmployeeResource,
  ScheduleJob,
  SchedulePlantResource,
  ScheduleVisit,
} from '@/types/scheduling';

export type ScheduleBoardRowKind = 'job' | 'team' | 'employee' | 'plant' | 'unassigned';

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
  teamName?: string;
  slotIndex?: number;
  job: ScheduleJob | null;
  employee: ScheduleEmployeeResource | null;
  plant: SchedulePlantResource | null;
  hiddenAssignment: ScheduleBoardHiddenAssignment | null;
  visitsByDate: Record<string, ScheduleBoardVisitPlacement[]>;
  legacyAssignmentsByDate: Record<string, ScheduleAssignment[]>;
}

export interface BuildScheduleBoardRowsInput {
  primary: SchedulingBoardPrimary;
  dayTeams?: ScheduleDayTeams[];
  teamSettings?: ScheduleTeamSettings;
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

function visitIntervalMs(visit: ScheduleVisit): { startMs: number; endMs: number } | null {
  if (visit.status === 'cancelled') return null;
  const startMs = Date.parse(visit.starts_at);
  const endMs = Date.parse(visit.ends_at);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

// Date boundaries are identical for every row/visit. The London conversion
// deliberately scans across DST transitions, so do it once per displayed date.
const londonDayBounds = new Map<string, { startMs: number; endMs: number }>();

function getLondonDayBounds(date: string) {
  const cached = londonDayBounds.get(date);
  if (cached) return cached;
  const nextDate = format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
  const bounds = {
    startMs: Date.parse(toScheduleLondonDateTimeIso(date, '00:00')),
    endMs: Date.parse(toScheduleLondonDateTimeIso(nextDate, '00:00')),
  };
  if (londonDayBounds.size >= 64) londonDayBounds.delete(londonDayBounds.keys().next().value!);
  londonDayBounds.set(date, bounds);
  return bounds;
}

export function scheduleVisitOverlapsLondonDate(
  visit: ScheduleVisit,
  date: string
): boolean {
  const interval = visitIntervalMs(visit);
  if (!interval) return false;
  const bounds = getLondonDayBounds(date);
  return interval.startMs < bounds.endMs && interval.endMs > bounds.startMs;
}

function placeVisitOnOverlappingDates(
  visitsByDate: Record<string, ScheduleBoardVisitPlacement[]>,
  dates: string[],
  placement: ScheduleBoardVisitPlacement
): boolean {
  let placed = false;
  for (const date of dates) {
    if (!scheduleVisitOverlapsLondonDate(placement.visit, date)) continue;
    visitsByDate[date].push(placement);
    placed = true;
  }
  return placed;
}

export function buildDateOnlyQuoteInitialVisit(
  startDate: string,
  estimatedMinutes: number | null | undefined
): { starts_at: string; ends_at: string } {
  const visitWindow = getDailyInitialVisitWindow(8 * 60, estimatedMinutes ?? null);
  const toIso = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return toScheduleLondonDateTimeIso(
      startDate,
      `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    );
  };
  return {
    starts_at: toIso(visitWindow.startMinutes),
    ends_at: toIso(visitWindow.endMinutes),
  };
}

function buildJobRows(
  jobs: ScheduleJob[],
  visits: ScheduleVisit[],
  assignments: ScheduleAssignment[],
  dates: string[]
): ScheduleBoardRow[] {
  return jobs.flatMap((job) => {
    const { visitsByDate, legacyAssignmentsByDate } = emptyDateBuckets(dates);
    const jobAssignments = assignments.filter(
      (assignment) => assignment.job_id === job.id
    );
    let placed = false;

    for (const visit of visits) {
      if (visit.job_id !== job.id) continue;
      placed = placeVisitOnOverlappingDates(visitsByDate, dates, {
        job,
        visit,
        assignments: jobAssignments.filter(
          (assignment) => assignment.visit_id === visit.id
        ),
      }) || placed;
    }

    if (!placed) return [];

    for (const date of dates) {
      visitsByDate[date] = sortPlacements(visitsByDate[date]);
    }

    return [{
      id: `job:${job.id}`,
      kind: 'job' as const,
      job,
      employee: null,
      plant: null,
      hiddenAssignment: null,
      visitsByDate,
      legacyAssignmentsByDate,
    }];
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
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const visitsById = new Map(
    visits
      .filter((visit) =>
        jobsById.has(visit.job_id)
        && dates.some((date) => scheduleVisitOverlapsLondonDate(visit, date))
      )
      .map((visit) => [visit.id, visit])
  );
  const scopedAssignments = assignments.filter(
    (assignment) =>
      jobsById.has(assignment.job_id)
      && Boolean(assignment.visit_id && visitsById.has(assignment.visit_id))
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
      placeVisitOnOverlappingDates(visitsByDate, dates, {
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
        kind: 'employee' as const,
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
      placeVisitOnOverlappingDates(visitsByDate, dates, {
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

function buildTeamRows(input: BuildScheduleBoardRowsInput): ScheduleBoardRow[] {
  const settings = input.teamSettings || defaultScheduleTeamSettings();
  const jobsById = new Map(input.jobs.map(job => [job.id, job]));
  return visibleScheduleDayTeamSlotIndexes(settings.visible_slot_count).map(slotIndex => {
    const { visitsByDate, legacyAssignmentsByDate } = emptyDateBuckets(input.dates);
    const firstSlot = input.dayTeams?.find(day => day.date === input.dates[0])?.slots.find(slot => slot.slot_index === slotIndex);
    for (const date of input.dates) {
      const slot = input.dayTeams?.find(day => day.date === date)?.slots.find(slot => slot.slot_index === slotIndex);
      if (!slot) continue;
      const employees = new Set(slot.members.map(member => member.profile_id));
      const plants = new Set((slot.plants || []).map(plant => plant.plant_id));
      for (const visit of input.visits) {
        const job = jobsById.get(visit.job_id);
        if (!job || !scheduleVisitOverlapsLondonDate(visit, date)) continue;
        const assignments = collectVisitAssignments(input.assignments, visit.id);
        if (!assignments.some(assignment => assignment.resource_type === 'employee'
          ? employees.has(assignment.profile_id) : plants.has(assignment.plant_id))) continue;
        visitsByDate[date].push({ job, visit, assignments });
      }
      visitsByDate[date] = sortPlacements(visitsByDate[date]);
    }
    return { id: `team:${slotIndex}`, kind: 'team' as const, slotIndex,
      teamName: resolveScheduleDayTeamName(firstSlot || { slot_index: slotIndex, members: [] }, settings),
      job: null, employee: null, plant: null, hiddenAssignment: null, visitsByDate, legacyAssignmentsByDate };
  });
}

export function buildScheduleBoardRows(
  input: BuildScheduleBoardRowsInput
): ScheduleBoardRow[] {
  if (input.primary === SCHEDULING_BOARD_PRIMARIES.team) return buildTeamRows(input);
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
  if (row.kind === 'team') return `schedule-board-row-team-${row.slotIndex}`;
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
  if (row.kind === 'team') return `schedule-cell-team-${row.slotIndex}-${date}`;
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
  if (row.kind === 'team') return `schedule-daily-row-cell-team-${row.slotIndex}`;
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
  if (primary === SCHEDULING_BOARD_PRIMARIES.team) return 'Team';
  if (primary === SCHEDULING_BOARD_PRIMARIES.plant) return 'Plant';
  return 'Job';
}

export function getScheduleBoardTitle(
  viewLabel: 'Daily' | 'Weekly',
  primary: SchedulingBoardPrimary
): string {
  if (primary === SCHEDULING_BOARD_PRIMARIES.team) {
    return `${viewLabel} team board`;
  }
  if (primary === SCHEDULING_BOARD_PRIMARIES.plant) {
    return `${viewLabel} plant board`;
  }
  return `${viewLabel} job board`;
}
