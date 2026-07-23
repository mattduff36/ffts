import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isOperationalSchedulingQuote,
  mapOperationalQuoteToScheduleJob,
  type SchedulingQuoteSource,
} from '@/lib/server/scheduling-quotes';

function quote(overrides: Partial<SchedulingQuoteSource> = {}): SchedulingQuoteSource {
  return {
    id: 'quote-1',
    quote_reference: '99000-SD',
    base_quote_reference: '99000-SD',
    customer_id: 'customer-1',
    customer_site_id: 'site-1',
    subject_line: 'Crown reduction',
    project_description: 'Reduce the crown.',
    site_address: '1 Sample Lane',
    status: 'po_received',
    commercial_status: 'open',
    is_latest_version: true,
    start_date: '2026-07-20',
    estimated_duration_days: 5,
    estimated_duration_minutes: 2400,
    created_by: 'manager-1',
    updated_by: null,
    ...overrides,
  };
}

describe('Quote-driven scheduling mapping', () => {
  it('activates any latest commercially open Quote with a start date', () => {
    expect(isOperationalSchedulingQuote(quote())).toBe(true);
    expect(isOperationalSchedulingQuote(quote({ status: 'sent' }))).toBe(true);
    expect(isOperationalSchedulingQuote(quote({ status: 'draft' }))).toBe(true);
    expect(isOperationalSchedulingQuote(quote({ commercial_status: 'closed' }))).toBe(false);
    expect(isOperationalSchedulingQuote(quote({ is_latest_version: false }))).toBe(false);
    expect(isOperationalSchedulingQuote(quote({ start_date: null }))).toBe(false);
  });

  it('keeps the base Quote reference and planning window authoritative', () => {
    const source = quote();
    if (!isOperationalSchedulingQuote(source)) throw new Error('Expected active Quote');

    expect(mapOperationalQuoteToScheduleJob(source)).toEqual(
      expect.objectContaining({
        job_reference: '99000-SD',
        title: 'Crown reduction',
        source_type: 'quote',
        status: 'scheduled',
        start_date: '2026-07-20',
        end_date: '2026-07-24',
        estimated_duration_minutes: 2400,
        quote_id: 'quote-1',
        customer_id: 'customer-1',
        customer_site_id: 'site-1',
        site_address: '1 Sample Lane',
      })
    );
  });

  it('maps an in-progress Quote to an in-progress scheduling job', () => {
    const source = quote({ status: 'in_progress' });
    if (!isOperationalSchedulingQuote(source)) throw new Error('Expected active Quote');
    expect(mapOperationalQuoteToScheduleJob(source).status).toBe('in_progress');
  });
});
