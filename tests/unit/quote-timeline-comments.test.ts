import { describe, expect, it } from 'vitest';
import {
  buildInvoiceAddedTimelineDescription,
  buildInvoiceRequestTimelineDescription,
  enrichQuoteTimelineEventDescriptions,
} from '@/lib/quotes/quote-timeline-comments';

describe('quote timeline comments', () => {
  it('includes invoice request comments in new timeline descriptions', () => {
    expect(
      buildInvoiceRequestTimelineDescription({
        requestedScope: 'full',
        requestedAmount: 4227,
        comments: 'May Invoice',
      })
    ).toBe('Requested full invoice • £4,227.00\nComments: May Invoice');
  });

  it('includes invoice comments in new timeline descriptions', () => {
    expect(
      buildInvoiceAddedTimelineDescription({
        invoiceNumber: '34375',
        amount: 4227,
        comments: 'TO PROJECT 5534-LC',
      })
    ).toBe('34375 • £4,227.00\nComments: TO PROJECT 5534-LC');
  });

  it('enriches existing invoice timeline events from stored comments', () => {
    const events = enrichQuoteTimelineEventDescriptions(
      [
        {
          id: 'event-1',
          quote_id: 'quote-1',
          event_type: 'invoice_requested',
          description: 'Requested full invoice • £4,227.00',
          created_at: '2026-06-09T13:42:09.393995+00:00',
        },
        {
          id: 'event-2',
          quote_id: 'quote-1',
          event_type: 'invoice_added',
          description: '34375 • £4,227.00',
          created_at: '2026-06-10T09:49:35.361199+00:00',
        },
      ],
      {
        invoiceRequests: [
          {
            quote_id: 'quote-1',
            requested_at: '2026-06-09T13:42:09.393995+00:00',
            manager_comments: 'May Invoice',
          },
        ],
        invoices: [
          {
            quote_id: 'quote-1',
            created_at: '2026-06-10T09:49:35.361199+00:00',
            comments: 'TO PROJECT 5534-LC',
          },
        ],
      }
    );

    expect(events[0]?.description).toBe('Requested full invoice • £4,227.00\nComments: May Invoice');
    expect(events[1]?.description).toBe('34375 • £4,227.00\nComments: TO PROJECT 5534-LC');
  });
});
