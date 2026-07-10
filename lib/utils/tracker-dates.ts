export function parseTrackerTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;

  if (typeof value === 'number') return parseEpochTimestamp(value);
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return parseEpochTimestamp(numericValue);
  }

  const ukDate = parseUkTimestamp(trimmed);
  if (ukDate) return ukDate;

  const isoLikeDate = parseIsoLikeTimestamp(trimmed);
  if (isoLikeDate) return isoLikeDate;

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

export function normalizeTrackerTimestamp(value: unknown): string | null {
  return parseTrackerTimestamp(value)?.toISOString() ?? null;
}

export function formatTrackerTimestamp(value: unknown, fallback = 'Unknown'): string {
  const date = parseTrackerTimestamp(value);
  return date ? date.toLocaleString('en-GB') : fallback;
}

function parseEpochTimestamp(value: number): Date | null {
  if (!Number.isFinite(value)) return null;

  const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseIsoLikeTimestamp(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;

  const normalized = value.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(.*)$/,
    '$1T$2$3'
  );
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function parseUkTimestamp(value: string): Date | null {
  const match = value.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:[,\s]+(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?$/
  );
  if (!match) return null;

  const [, dayValue, monthValue, yearValue, hourValue, minuteValue, secondValue] = match;
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = yearValue.length === 2 ? 2000 + Number(yearValue) : Number(yearValue);
  const hour = hourValue ? Number(hourValue) : 0;
  const minute = minuteValue ? Number(minuteValue) : 0;
  const second = secondValue ? Number(secondValue) : 0;

  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }

  return date;
}
