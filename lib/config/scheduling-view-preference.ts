export const SCHEDULING_VIEW_STORAGE_KEY_PREFIX = 'ffts:scheduling-board-view:v1';

export const SCHEDULING_BOARD_VIEWS = {
  daily: 'daily',
  weekly: 'weekly',
} as const;

export type SchedulingBoardView =
  (typeof SCHEDULING_BOARD_VIEWS)[keyof typeof SCHEDULING_BOARD_VIEWS];

export function getSchedulingViewStorageKey(userId: string): string {
  return `${SCHEDULING_VIEW_STORAGE_KEY_PREFIX}:${userId}`;
}

export function readSchedulingViewPreference(userId: string): SchedulingBoardView {
  if (typeof window === 'undefined' || !userId) return SCHEDULING_BOARD_VIEWS.weekly;

  try {
    const storedView = localStorage.getItem(getSchedulingViewStorageKey(userId));
    return storedView === SCHEDULING_BOARD_VIEWS.daily
      ? SCHEDULING_BOARD_VIEWS.daily
      : SCHEDULING_BOARD_VIEWS.weekly;
  } catch {
    return SCHEDULING_BOARD_VIEWS.weekly;
  }
}

export function writeSchedulingViewPreference(
  userId: string,
  view: SchedulingBoardView
): void {
  if (typeof window === 'undefined' || !userId) return;

  try {
    localStorage.setItem(getSchedulingViewStorageKey(userId), view);
  } catch {
    // Ignore unavailable or restricted localStorage.
  }
}
