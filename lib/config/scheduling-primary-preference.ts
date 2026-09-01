export const SCHEDULING_PRIMARY_STORAGE_KEY_PREFIX =
  'ffts:scheduling-board-primary:v1';

export const SCHEDULING_BOARD_PRIMARIES = {
  job: 'job',
  employee: 'employee',
  plant: 'plant',
} as const;

export type SchedulingBoardPrimary =
  (typeof SCHEDULING_BOARD_PRIMARIES)[keyof typeof SCHEDULING_BOARD_PRIMARIES];

export function getSchedulingPrimaryStorageKey(userId: string): string {
  return `${SCHEDULING_PRIMARY_STORAGE_KEY_PREFIX}:${userId}`;
}

export function isSchedulingBoardPrimary(
  value: unknown
): value is SchedulingBoardPrimary {
  return (
    value === SCHEDULING_BOARD_PRIMARIES.job
    || value === SCHEDULING_BOARD_PRIMARIES.employee
    || value === SCHEDULING_BOARD_PRIMARIES.plant
  );
}

export function readSchedulingPrimaryPreference(
  userId: string
): SchedulingBoardPrimary {
  if (typeof window === 'undefined' || !userId) {
    return SCHEDULING_BOARD_PRIMARIES.job;
  }

  try {
    const storedPrimary = localStorage.getItem(
      getSchedulingPrimaryStorageKey(userId)
    );
    return isSchedulingBoardPrimary(storedPrimary)
      ? storedPrimary
      : SCHEDULING_BOARD_PRIMARIES.job;
  } catch {
    return SCHEDULING_BOARD_PRIMARIES.job;
  }
}

export function writeSchedulingPrimaryPreference(
  userId: string,
  primary: SchedulingBoardPrimary
): void {
  if (typeof window === 'undefined' || !userId) return;

  try {
    localStorage.setItem(getSchedulingPrimaryStorageKey(userId), primary);
  } catch {
    // Ignore unavailable or restricted localStorage.
  }
}
