export type SchedulingLayout = 'standard' | 'columns';

export function schedulingLayoutStorageKey(userId: string): string {
  return `ffts:scheduling-layout:v1:${userId}`;
}

export function readSchedulingLayoutPreference(userId: string): SchedulingLayout {
  if (typeof window === 'undefined' || !userId) return 'standard';
  try {
    return localStorage.getItem(schedulingLayoutStorageKey(userId)) === 'columns'
      ? 'columns'
      : 'standard';
  } catch {
    return 'standard';
  }
}

export function writeSchedulingLayoutPreference(userId: string, layout: SchedulingLayout): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    localStorage.setItem(schedulingLayoutStorageKey(userId), layout);
  } catch {
    // Match the other scheduling preferences when browser storage is restricted.
  }
}
