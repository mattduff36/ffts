import { describe, expect, it } from 'vitest';
import { normalizeEstimatedDuration, estimatedDurationErrors } from '@/lib/quotes/estimated-duration';
import { buildQuoteCreatePayload } from '@/app/(dashboard)/quotes/quote-creation-client';
import type { QuoteFormData } from '@/app/(dashboard)/quotes/types';

describe('quote estimate alternatives', () => {
  it.each([null, undefined, '', 0, '0'])('allows an empty estimate (%s)', value => {
    expect(normalizeEstimatedDuration(value)).toBeNull();
  });
  it.each([-1, 1.5, Infinity, 'bad', true, 100801])('rejects invalid stored minutes (%s)', value => {
    expect(normalizeEstimatedDuration(value)).toBeNaN();
  });
  it('converts sub-day hours to minutes and excludes the display-only field', () => {
    const payload = buildQuoteCreatePayload({ estimated_duration_days: '', estimated_duration_hours: 2.25, request_id: 'fixed' } as QuoteFormData);
    expect(payload.estimated_duration_minutes).toBe(135);
    expect(payload).not.toHaveProperty('estimated_duration_hours');
    expect(estimatedDurationErrors(null, 135)).toEqual({});
    expect(estimatedDurationErrors(2, 135)).toHaveProperty('estimated_duration_days');
  });
});
