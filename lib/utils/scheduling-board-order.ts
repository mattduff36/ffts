import type { ScheduleJob } from '@/types/scheduling';

export function readBoardSequence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function compareScheduleBoardJobs(
  first: Pick<ScheduleJob, 'id'> & { board_sequence?: number | null },
  second: Pick<ScheduleJob, 'id'> & { board_sequence?: number | null }
): number {
  const firstSequence = readBoardSequence(first.board_sequence);
  const secondSequence = readBoardSequence(second.board_sequence);
  if (firstSequence === null && secondSequence === null) {
    return first.id.localeCompare(second.id);
  }
  if (firstSequence === null) return 1;
  if (secondSequence === null) return -1;
  if (firstSequence !== secondSequence) return firstSequence - secondSequence;
  return first.id.localeCompare(second.id);
}

export function sortJobsByBoardSequence<T extends Pick<ScheduleJob, 'id'> & { board_sequence?: number | null }>(
  jobs: T[]
): T[] {
  return [...jobs].sort(compareScheduleBoardJobs);
}

export function insertJobInBoardOrder(
  jobs: ScheduleJob[],
  job: ScheduleJob,
  replaceId?: string
): ScheduleJob[] {
  const existingIndex = jobs.findIndex(
    (item) => item.id === job.id || item.id === replaceId
  );
  const without = jobs.filter((item) => item.id !== job.id && item.id !== replaceId);
  if (existingIndex >= 0) {
    const next = [...without];
    next.splice(Math.min(existingIndex, next.length), 0, job);
    return next;
  }
  if (readBoardSequence(job.board_sequence) === null) {
    return [...without, job];
  }

  let insertAt = without.length;
  for (let index = 0; index < without.length; index += 1) {
    const item = without[index];
    if (
      readBoardSequence(item.board_sequence) === null
      || compareScheduleBoardJobs(job, item) < 0
    ) {
      insertAt = index;
      break;
    }
  }
  const next = [...without];
  next.splice(insertAt, 0, job);
  return next;
}
