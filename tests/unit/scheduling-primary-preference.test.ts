import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSchedulingPrimaryStorageKey,
  readSchedulingPrimaryPreference,
  SCHEDULING_BOARD_PRIMARIES,
  writeSchedulingPrimaryPreference,
} from '@/lib/config/scheduling-primary-preference';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('scheduling primary preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to jobs when nothing is stored', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', createMemoryStorage());

    expect(readSchedulingPrimaryPreference('manager-1')).toBe(
      SCHEDULING_BOARD_PRIMARIES.job
    );
  });

  it('restores a stored employee primary and ignores invalid values', () => {
    const storage = createMemoryStorage({
      [getSchedulingPrimaryStorageKey('manager-1')]: SCHEDULING_BOARD_PRIMARIES.employee,
      [getSchedulingPrimaryStorageKey('manager-2')]: 'crew',
    });
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);

    expect(readSchedulingPrimaryPreference('manager-1')).toBe(
      SCHEDULING_BOARD_PRIMARIES.employee
    );
    expect(readSchedulingPrimaryPreference('manager-2')).toBe(
      SCHEDULING_BOARD_PRIMARIES.job
    );
  });

  it('persists the selected primary per user', () => {
    const storage = createMemoryStorage();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);

    writeSchedulingPrimaryPreference('manager-1', SCHEDULING_BOARD_PRIMARIES.plant);

    expect(storage.getItem(getSchedulingPrimaryStorageKey('manager-1'))).toBe(
      SCHEDULING_BOARD_PRIMARIES.plant
    );
    expect(readSchedulingPrimaryPreference('manager-1')).toBe(
      SCHEDULING_BOARD_PRIMARIES.plant
    );
  });
});
