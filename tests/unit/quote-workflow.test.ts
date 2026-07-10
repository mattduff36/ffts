import { describe, expect, it } from 'vitest';
import {
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  getInvoiceSummary,
} from '@/lib/utils/quote-workflow';

describe('quote workflow helpers', () => {
  it('calculates quote totals for line items', () => {
    expect(
      calculateQuoteTotals(
        [
          { quantity: 2, unit_rate: 125.5 },
          { quantity: 1.5, unit_rate: 80 },
        ]
      )
    ).toEqual({
      subtotal: 371,
      total: 371,
    });
  });

  it('builds readable version labels and references', () => {
    expect(buildVersionLabel('original', 0)).toBe('Original');
    expect(buildVersionLabel('revision', 2)).toBe('Rev 2');
    expect(buildVersionReference('40000-GH', 'revision', 2)).toBe('40000-GH-REV2');
    expect(buildVersionReference('40000-GH', 'future_work', 1)).toBe('40000-GH-FW1');
  });

  it('summarises invoice history and remaining balance', () => {
    expect(
      getInvoiceSummary({
        total: 1000,
        invoices: [
          { amount: 250, invoice_date: '2026-03-01' },
          { amount: 300, invoice_date: '2026-04-01' },
        ],
      })
    ).toEqual({
      invoicedTotal: 550,
      pendingRequestedTotal: 0,
      remainingBalance: 450,
      availableToRequest: 450,
      lastInvoiceAt: '2026-04-01',
      status: 'partially_invoiced',
    });
  });

  it('marks a quote fully invoiced once the balance is cleared', () => {
    expect(
      getInvoiceSummary({
        total: 500,
        invoices: [
          { amount: 250, invoice_date: '2026-03-01' },
          { amount: 250, invoice_date: '2026-03-15' },
        ],
      }).status
    ).toBe('invoiced');
  });

  it('keeps pending invoice requests separate from actual invoiced totals', () => {
    expect(
      getInvoiceSummary({
        total: 1000,
        invoices: [{ amount: 250, invoice_date: '2026-03-01' }],
        invoiceRequests: [
          { requested_amount: 300, status: 'pending' },
          { requested_amount: 50, status: 'cancelled' },
        ],
      })
    ).toEqual({
      invoicedTotal: 250,
      pendingRequestedTotal: 300,
      remainingBalance: 750,
      availableToRequest: 450,
      lastInvoiceAt: '2026-03-01',
      status: 'ready_to_invoice',
    });
  });
});
