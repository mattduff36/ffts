/** Shared draft locks prevent background reads from replacing unsaved dialog state. */
const draftLocks = new Set<symbol>();

export function pauseSoftRefresh(): () => void {
  const key = Symbol('draft');
  draftLocks.add(key);
  return () => { draftLocks.delete(key); };
}

export function isSoftRefreshPaused(): boolean {
  return draftLocks.size > 0;
}
