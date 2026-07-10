import { describe, expect, it } from 'vitest';
import {
  formatNumericTimeDraft,
  formatTimeForNumericInput,
  normalizeAndRoundNumericTimeInput,
  normalizeNumericTimeInput,
  shouldCommitNumericTimeInput,
} from '@/lib/utils/numeric-time-input';

describe('numeric time input helpers', () => {
  it('formats persisted HH:mm values as readable input text', () => {
    expect(formatTimeForNumericInput('08:30')).toBe('08:30');
    expect(formatTimeForNumericInput('17:00')).toBe('17:00');
    expect(formatTimeForNumericInput('invalid')).toBe('');
  });

  it('formats persisted database TIME values with seconds as readable input text', () => {
    expect(formatTimeForNumericInput('06:00:00')).toBe('06:00');
    expect(formatTimeForNumericInput('17:45:00')).toBe('17:45');
  });

  it('formats partial draft input without treating 164 as 01:45', () => {
    expect(formatNumericTimeDraft('16')).toBe('16');
    expect(formatNumericTimeDraft('164')).toBe('16:4');
    expect(formatNumericTimeDraft('1645')).toBe('16:45');
    expect(formatNumericTimeDraft('830')).toBe('8:30');
  });

  it('normalizes common mobile keypad entries to HH:mm', () => {
    expect(normalizeNumericTimeInput('8')).toBe('08:00');
    expect(normalizeNumericTimeInput('830')).toBe('08:30');
    expect(normalizeNumericTimeInput('1730')).toBe('17:30');
    expect(normalizeNumericTimeInput('08:15')).toBe('08:15');
  });

  it('rejects impossible times without committing partial input too early', () => {
    expect(shouldCommitNumericTimeInput('17')).toBe(false);
    expect(shouldCommitNumericTimeInput('164')).toBe(false);
    expect(shouldCommitNumericTimeInput('1730')).toBe(true);
    expect(normalizeNumericTimeInput('2460')).toBeNull();
    expect(normalizeNumericTimeInput('9999')).toBeNull();
  });

  it('rounds valid completed times to the nearest quarter hour on blur', () => {
    expect(normalizeAndRoundNumericTimeInput('1607')).toBe('16:00');
    expect(normalizeAndRoundNumericTimeInput('1608')).toBe('16:15');
    expect(normalizeAndRoundNumericTimeInput('1622')).toBe('16:15');
    expect(normalizeAndRoundNumericTimeInput('1623')).toBe('16:30');
    expect(normalizeAndRoundNumericTimeInput('1652')).toBe('16:45');
    expect(normalizeAndRoundNumericTimeInput('1653')).toBe('17:00');
  });
});
