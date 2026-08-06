export const QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY = 'ffts-quotes-overview-date-range';

export interface QuotesOverviewDateRange {
  from: string;
  to: string;
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDateInput(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && formatDateInput(parsed) === value;
}

function getBrowserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Current calendar week bounds (Monday–Sunday) in local time. */
export function getCurrentWeekBounds(referenceDate: Date = new Date()): QuotesOverviewDateRange {
  const daysSinceMonday = (referenceDate.getDay() + 6) % 7;
  const monday = new Date(referenceDate);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(referenceDate.getDate() - daysSinceMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    from: formatDateInput(monday),
    to: formatDateInput(sunday),
  };
}

export function getDefaultQuotesOverviewDateRange(
  referenceDate: Date = new Date()
): QuotesOverviewDateRange {
  return getCurrentWeekBounds(referenceDate);
}

export function readQuotesOverviewDateRange(
  storage: Pick<Storage, 'getItem'> | null = getBrowserLocalStorage()
): QuotesOverviewDateRange {
  const fallback = getDefaultQuotesOverviewDateRange();
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<QuotesOverviewDateRange>;
    if (!isValidDateInput(parsed.from) || !isValidDateInput(parsed.to)) return fallback;
    if (parsed.from > parsed.to) return fallback;
    return { from: parsed.from, to: parsed.to };
  } catch {
    return fallback;
  }
}

export function writeQuotesOverviewDateRange(
  range: QuotesOverviewDateRange,
  storage: Pick<Storage, 'setItem'> | null = getBrowserLocalStorage()
): void {
  if (!storage) return;
  if (!isValidDateInput(range.from) || !isValidDateInput(range.to) || range.from > range.to) return;

  try {
    storage.setItem(QUOTES_OVERVIEW_DATE_RANGE_STORAGE_KEY, JSON.stringify(range));
  } catch {
    // Ignore unavailable or restricted localStorage.
  }
}
