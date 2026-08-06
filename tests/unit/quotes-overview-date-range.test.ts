import { describe, expect, it } from 'vitest';
import {
  getCurrentWeekBounds,
  getDefaultQuotesOverviewDateRange,
  QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY,
  readQuotesOverviewDateRange,
  writeQuotesOverviewDateRange,
} from '@/lib/config/quotes-overview-date-range';

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

describe('quotes overview date range preference', () => {
  it('defaults to the current Monday–Sunday week', () => {
    // Thursday 6 Aug 2026 → week Mon 3 Aug – Sun 9 Aug
    const reference = new Date(2026, 7, 6);
    expect(getCurrentWeekBounds(reference)).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(getDefaultQuotesOverviewDateRange(reference)).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
  });

  it('restores a valid stored range from localStorage', () => {
    const storage = createMemoryStorage({
      [QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY]: JSON.stringify({
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    });

    expect(readQuotesOverviewDateRange(storage)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('falls back to the current week for missing or invalid stored values', () => {
    const referenceDefault = getDefaultQuotesOverviewDateRange(new Date(2026, 7, 6));
    expect(readQuotesOverviewDateRange(createMemoryStorage())).toEqual(
      getDefaultQuotesOverviewDateRange()
    );
    expect(
      readQuotesOverviewDateRange(
        createMemoryStorage({
          [QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY]: JSON.stringify({ from: 'bad', to: '2026-08-01' }),
        })
      )
    ).toEqual(getDefaultQuotesOverviewDateRange());
    expect(
      readQuotesOverviewDateRange(
        createMemoryStorage({
          [QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY]: JSON.stringify({
            from: '2026-08-10',
            to: '2026-08-01',
          }),
        })
      )
    ).toEqual(getDefaultQuotesOverviewDateRange());
    expect(referenceDefault.from <= referenceDefault.to).toBe(true);
  });

  it('persists a valid range to localStorage', () => {
    const storage = createMemoryStorage();
    writeQuotesOverviewDateRange({ from: '2026-08-03', to: '2026-08-09' }, storage);
    expect(storage.getItem(QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY)).toBe(
      JSON.stringify({ from: '2026-08-03', to: '2026-08-09' })
    );
  });
});
