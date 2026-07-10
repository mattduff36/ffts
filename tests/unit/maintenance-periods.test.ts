import { describe, expect, it } from 'vitest';
import { addDatePeriod, formatDistancePeriodValue, toDateOnlyString } from '@/lib/utils/maintenancePeriods';

describe('maintenance periods', () => {
  it('clamps Jan 31 plus one month to Feb end', () => {
    const result = addDatePeriod(new Date('2026-01-31T12:00:00.000Z'), 1, 'months');

    expect(toDateOnlyString(result)).toBe('2026-02-28');
  });

  it('clamps Mar 31 plus one month to Apr end', () => {
    const result = addDatePeriod(new Date('2026-03-31T12:00:00.000Z'), 1, 'months');

    expect(toDateOnlyString(result)).toBe('2026-04-30');
  });

  it('adds weekly periods without changing the interval meaning', () => {
    const result = addDatePeriod(new Date('2026-04-07T15:15:00.000Z'), 6, 'weeks');

    expect(toDateOnlyString(result)).toBe('2026-05-19');
  });

  it('formats distance periods with contextual labels', () => {
    expect(formatDistancePeriodValue(10000, 'Miles / Kilometres')).toBe('10,000 miles / kilometres');
  });
});
