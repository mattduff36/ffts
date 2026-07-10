import { describe, expect, it } from 'vitest';
import {
  buildQuoteConversionSummaryRows,
  buildQuoteDetailRows,
  buildQuoteStatusSummaryRows,
  getQuotePipelineStage,
  type QuoteConversionReportRow,
} from '@/lib/server/quote-conversion-report';

function quote(overrides: Partial<QuoteConversionReportRow>): QuoteConversionReportRow {
  return {
    id: overrides.id || crypto.randomUUID(),
    quote_reference: overrides.quote_reference || 'Q-001',
    quote_date: overrides.quote_date || '2026-05-01',
    status: overrides.status || 'draft',
    total: overrides.total ?? 0,
    accepted: overrides.accepted ?? false,
    created_at: overrides.created_at || '2026-05-01T09:00:00.000Z',
    updated_at: overrides.updated_at || '2026-05-01T09:00:00.000Z',
    sent_at: overrides.sent_at || null,
    accepted_at: overrides.accepted_at || null,
    customer_sent_at: overrides.customer_sent_at || null,
    po_received_at: overrides.po_received_at || null,
    closed_at: overrides.closed_at || null,
    commercial_status: overrides.commercial_status || 'open',
    customer: overrides.customer || { company_name: 'Acme Ltd', short_name: null },
    manager: overrides.manager || {
      full_name: 'Morgan Manager',
      employee_id: 'M1',
      team: { name: 'Civils', code: 'CIV' },
    },
  };
}

describe('quote conversion report helpers', () => {
  it('classifies accepted, declined, aging, and closed quote pipeline stages', () => {
    expect(getQuotePipelineStage(quote({ status: 'po_received', po_received_at: '2026-05-05' }))).toBe('Accepted');
    expect(getQuotePipelineStage(quote({ status: 'lost' }))).toBe('Declined');
    expect(getQuotePipelineStage(quote({ status: 'sent' }))).toBe('Aging Pipeline');
    expect(getQuotePipelineStage(quote({ status: 'closed', commercial_status: 'closed' }))).toBe('Closed');
  });

  it('groups funnel metrics by customer, owner, and team', () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const rows = [
      quote({ id: 'created-1', quote_reference: 'Q-001', status: 'sent', total: 1000, quote_date: '2026-05-01' }),
      quote({ id: 'accepted-1', quote_reference: 'Q-002', status: 'po_received', total: 2500, po_received_at: '2026-05-04' }),
      quote({ id: 'declined-1', quote_reference: 'Q-003', status: 'lost', total: 500 }),
    ];

    const [summary] = buildQuoteConversionSummaryRows(rows, now);

    expect(summary).toEqual({
      customerName: 'Acme Ltd',
      ownerName: 'Morgan Manager',
      teamName: 'Civils',
      createdCount: 3,
      acceptedCount: 1,
      declinedCount: 1,
      agingCount: 1,
      createdValue: 4000,
      acceptedValue: 2500,
      declinedValue: 500,
      agingValue: 1000,
      averageOpenAgeDays: 10,
      conversionRatePercent: 33.33,
    });
  });

  it('builds status breakdown and detail rows for the export workbook', () => {
    const rows = [
      quote({ id: 'quote-1', quote_reference: 'Q-001', status: 'sent', total: 1000, quote_date: '2026-05-01' }),
      quote({ id: 'quote-2', quote_reference: 'Q-002', status: 'sent', total: 1500, quote_date: '2026-05-02' }),
      quote({ id: 'quote-3', quote_reference: 'Q-003', status: 'lost', total: 500, quote_date: '2026-05-03' }),
    ];

    expect(buildQuoteStatusSummaryRows(rows)).toEqual([
      { status: 'sent', label: 'Confirmed', count: 2, value: 2500 },
      { status: 'lost', label: 'Lost', count: 1, value: 500 },
    ]);
    expect(buildQuoteDetailRows(rows, new Date('2026-05-11T12:00:00.000Z'))[0]).toMatchObject({
      quoteReference: 'Q-001',
      statusLabel: 'Confirmed',
      pipelineStage: 'Aging Pipeline',
      openAgeDays: 10,
    });
  });
});
