import { describe, expect, it } from 'vitest';
import {
  formatTrackerTimestamp,
  normalizeTrackerTimestamp,
  parseTrackerTimestamp,
} from '@/lib/utils/tracker-dates';

describe('tracker date utilities', () => {
  it('parses epoch seconds and milliseconds from tracker APIs', () => {
    expect(normalizeTrackerTimestamp(1_778_178_900)).toBe('2026-05-07T18:35:00.000Z');
    expect(normalizeTrackerTimestamp(1_778_178_900_000)).toBe('2026-05-07T18:35:00.000Z');
    expect(normalizeTrackerTimestamp('1778178900')).toBe('2026-05-07T18:35:00.000Z');
  });

  it('parses UK-style tracker timestamps without relying on browser Date parsing', () => {
    const date = parseTrackerTimestamp('07/05/2026 18:35:12');

    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(4);
    expect(date?.getDate()).toBe(7);
    expect(date?.getHours()).toBe(18);
    expect(date?.getMinutes()).toBe(35);
    expect(date?.getSeconds()).toBe(12);
  });

  it('uses a fallback label for malformed tracker timestamps', () => {
    expect(formatTrackerTimestamp('not-a-date')).toBe('Unknown');
    expect(formatTrackerTimestamp(null, 'Not available')).toBe('Not available');
  });
});
