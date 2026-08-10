import type {
  ScheduleAssignment,
  ScheduleDayCapacity,
  ScheduleJob,
  ScheduleVisit,
  SchedulingBoardPayload,
} from '@/types/scheduling';

export function snapshotBoard(
  board: SchedulingBoardPayload | undefined
): SchedulingBoardPayload | undefined {
  if (!board) return undefined;
  return structuredClone(board);
}

export function replaceEmployeeCapacity(
  board: SchedulingBoardPayload,
  capacityDays: ScheduleDayCapacity[]
): SchedulingBoardPayload {
  if (capacityDays.length === 0) return board;
  const byDate = new Map(capacityDays.map((day) => [day.date, day]));
  const remaining = new Set(byDate.keys());
  const nextCapacity = board.employee_capacity.map((day) => {
    const replacement = byDate.get(day.date);
    if (!replacement) return day;
    remaining.delete(day.date);
    return replacement;
  });
  for (const date of remaining) {
    const day = byDate.get(date);
    if (day) nextCapacity.push(day);
  }
  nextCapacity.sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...board,
    employee_capacity: nextCapacity,
  };
}

export function patchBoardWithAssignment(
  board: SchedulingBoardPayload,
  assignment: ScheduleAssignment,
  options?: {
    replaceOptimisticId?: string;
    capacityDays?: ScheduleDayCapacity[];
  }
): SchedulingBoardPayload {
  const withoutOptimistic = options?.replaceOptimisticId
    ? board.assignments.filter((item) => item.id !== options.replaceOptimisticId)
    : board.assignments.filter((item) => item.id !== assignment.id);
  const next: SchedulingBoardPayload = {
    ...board,
    assignments: [...withoutOptimistic, assignment],
  };
  return options?.capacityDays
    ? replaceEmployeeCapacity(next, options.capacityDays)
    : next;
}

export function patchBoardMoveAssignment(
  board: SchedulingBoardPayload,
  assignmentId: string,
  updater: (assignment: ScheduleAssignment) => ScheduleAssignment,
  capacityDays?: ScheduleDayCapacity[]
): SchedulingBoardPayload {
  const next: SchedulingBoardPayload = {
    ...board,
    assignments: board.assignments.map((item) =>
      item.id === assignmentId ? updater(item) : item
    ),
  };
  return capacityDays ? replaceEmployeeCapacity(next, capacityDays) : next;
}

export function patchBoardRemoveAssignment(
  board: SchedulingBoardPayload,
  assignmentId: string,
  capacityDays?: ScheduleDayCapacity[]
): SchedulingBoardPayload {
  const next: SchedulingBoardPayload = {
    ...board,
    assignments: board.assignments.filter((item) => item.id !== assignmentId),
  };
  return capacityDays ? replaceEmployeeCapacity(next, capacityDays) : next;
}

export function patchBoardWithQuickAdd(input: {
  board: SchedulingBoardPayload;
  job: ScheduleJob;
  visit: ScheduleVisit;
}): SchedulingBoardPayload {
  const jobs = input.board.jobs.some((job) => job.id === input.job.id)
    ? input.board.jobs.map((job) => (job.id === input.job.id ? input.job : job))
    : [...input.board.jobs, input.job];
  const visits = input.board.visits.some((visit) => visit.id === input.visit.id)
    ? input.board.visits.map((visit) =>
        visit.id === input.visit.id ? input.visit : visit
      )
    : [...input.board.visits, input.visit];

  return {
    ...input.board,
    jobs,
    visits,
  };
}

export function removeProjectCandidateFromQueue(
  projects: Array<{ id: string }> | undefined,
  projectNumberId: string
): Array<{ id: string }> | undefined {
  if (!projects) return projects;
  return projects.filter((project) => project.id !== projectNumberId);
}
