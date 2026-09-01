import type {
  ScheduleAssignment,
  ScheduleDayCapacity,
  ScheduleDayTeamMember,
  ScheduleDayTeamSlotIndex,
  ScheduleJob,
  SchedulePlantUnavailability,
  ScheduleProjectCandidate,
  ScheduleQuoteCandidate,
  ScheduleVisit,
  ScheduleVisitBacklogItem,
  SchedulingBoardPayload,
} from '@/types/scheduling';
import {
  removeScheduleDayTeamMember as removeDayTeamMemberFromBoard,
  upsertScheduleDayTeamMember,
} from '@/lib/utils/scheduling-day-teams';

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

export function patchBoardWithDayTeamMember(
  board: SchedulingBoardPayload,
  member: ScheduleDayTeamMember
): SchedulingBoardPayload {
  return upsertScheduleDayTeamMember(board, member);
}

export function patchBoardRemoveDayTeamMember(
  board: SchedulingBoardPayload,
  workDate: string,
  slotIndex: ScheduleDayTeamSlotIndex,
  profileId: string
): SchedulingBoardPayload {
  return removeDayTeamMemberFromBoard(board, workDate, slotIndex, profileId);
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

export function patchBoardWithJob(
  board: SchedulingBoardPayload,
  job: ScheduleJob,
  replaceId?: string
): SchedulingBoardPayload {
  const existingIndex = board.jobs.findIndex(
    (item) => item.id === job.id || item.id === replaceId
  );
  const jobs = board.jobs.filter((item) => item.id !== job.id && item.id !== replaceId);
  if (existingIndex >= 0) {
    jobs.splice(Math.min(existingIndex, jobs.length), 0, job);
    return { ...board, jobs };
  }
  return {
    ...board,
    jobs: [...jobs, job],
  };
}

export function patchBoardRemoveJob(
  board: SchedulingBoardPayload,
  jobId: string
): SchedulingBoardPayload {
  const removedVisitIds = new Set(
    board.visits.filter((visit) => visit.job_id === jobId).map((visit) => visit.id)
  );
  return {
    ...board,
    jobs: board.jobs.filter((job) => job.id !== jobId),
    visits: board.visits.filter((visit) => visit.job_id !== jobId),
    assignments: board.assignments.filter(
      (assignment) =>
        assignment.job_id !== jobId
        && (!assignment.visit_id || !removedVisitIds.has(assignment.visit_id))
    ),
  };
}

export function patchBoardWithVisit(
  board: SchedulingBoardPayload,
  visit: ScheduleVisit,
  replaceId?: string
): SchedulingBoardPayload {
  const visits = board.visits
    .filter((item) => item.id !== visit.id && item.id !== replaceId);
  const nextVisits = [...visits, visit].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at) || a.sequence_number - b.sequence_number
  );
  const visitById = new Map(nextVisits.map((item) => [item.id, item]));
  return {
    ...board,
    visits: nextVisits,
    assignments: board.assignments.map((assignment) => {
      const assignmentVisit = assignment.visit_id
        ? visitById.get(assignment.visit_id)
        : undefined;
      if (!assignmentVisit) return assignment;
      return {
        ...assignment,
        job_id: assignmentVisit.job_id,
        work_date: assignmentVisit.starts_at.slice(0, 10),
        visit: assignmentVisit,
      };
    }),
  };
}

export function patchBoardRemoveVisit(
  board: SchedulingBoardPayload,
  visitId: string
): SchedulingBoardPayload {
  return {
    ...board,
    visits: board.visits.filter((visit) => visit.id !== visitId),
    assignments: board.assignments.filter((assignment) => assignment.visit_id !== visitId),
  };
}

export function patchBoardWithPlantBlock(
  board: SchedulingBoardPayload,
  block: SchedulePlantUnavailability,
  replaceId?: string
): SchedulingBoardPayload {
  const blocks = board.plant_unavailability
    .filter((item) => item.id !== block.id && item.id !== replaceId);
  return {
    ...board,
    plant_unavailability: [...blocks, block].sort((a, b) =>
      a.start_date.localeCompare(b.start_date)
    ),
  };
}

export function patchBoardRemovePlantBlock(
  board: SchedulingBoardPayload,
  blockId: string
): SchedulingBoardPayload {
  return {
    ...board,
    plant_unavailability: board.plant_unavailability.filter(
      (block) => block.id !== blockId
    ),
  };
}

export function upsertQuoteCandidate(
  candidates: ScheduleQuoteCandidate[] | undefined,
  candidate: ScheduleQuoteCandidate
): ScheduleQuoteCandidate[] {
  return [
    ...(candidates || []).filter((item) => item.id !== candidate.id),
    candidate,
  ];
}

export function removeQuoteCandidate(
  candidates: ScheduleQuoteCandidate[] | undefined,
  candidateId: string
): ScheduleQuoteCandidate[] {
  return (candidates || []).filter((candidate) => candidate.id !== candidateId);
}

export function upsertProjectCandidate(
  candidates: ScheduleProjectCandidate[] | undefined,
  candidate: ScheduleProjectCandidate
): ScheduleProjectCandidate[] {
  return [
    ...(candidates || []).filter((item) => item.id !== candidate.id),
    candidate,
  ];
}

export function removeProjectCandidateFromQueue(
  projects: ScheduleProjectCandidate[] | undefined,
  projectNumberId: string
): ScheduleProjectCandidate[] {
  return (projects || []).filter((project) => project.id !== projectNumberId);
}

export function upsertVisitBacklogItem(
  items: ScheduleVisitBacklogItem[] | undefined,
  item: ScheduleVisitBacklogItem
): ScheduleVisitBacklogItem[] {
  return [
    ...(items || []).filter((current) => current.visit_id !== item.visit_id),
    item,
  ].sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

export function removeVisitBacklogItem(
  items: ScheduleVisitBacklogItem[] | undefined,
  visitId: string
): ScheduleVisitBacklogItem[] {
  return (items || []).filter((item) => item.visit_id !== visitId);
}
