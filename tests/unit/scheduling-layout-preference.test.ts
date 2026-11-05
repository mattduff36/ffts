import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readSchedulingLayoutPreference,
  schedulingLayoutStorageKey,
  writeSchedulingLayoutPreference,
} from '@/lib/config/scheduling-layout-preference';

afterEach(() => vi.unstubAllGlobals());

describe('scheduling layout preference', () => {
  it('preserves the standard layout by default and scopes the alternative to the user', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(readSchedulingLayoutPreference('a')).toBe('standard');
    writeSchedulingLayoutPreference('a', 'columns');
    expect(readSchedulingLayoutPreference('a')).toBe('columns');
    expect(readSchedulingLayoutPreference('b')).toBe('standard');
    expect([...values.keys()]).toEqual([schedulingLayoutStorageKey('a')]);
    values.set(schedulingLayoutStorageKey('a'), 'invalid');
    expect(readSchedulingLayoutPreference('a')).toBe('standard');
  });

  it('works with SSR and restricted storage', () => {
    expect(readSchedulingLayoutPreference('a')).toBe('standard');
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('restricted'); },
      setItem: () => { throw new Error('restricted'); },
    });
    expect(readSchedulingLayoutPreference('a')).toBe('standard');
    expect(() => writeSchedulingLayoutPreference('a', 'columns')).not.toThrow();
  });
});
