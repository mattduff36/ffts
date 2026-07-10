import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockAppendQuoteTimelineEvent,
  mockCreateQuoteNotification,
  mockFetchQuoteBundle,
  mockGetQuoteAccountsRecipientIds,
  mockRenderConfiguredQuoteEmailTemplate,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockAppendQuoteTimelineEvent: vi.fn(),
  mockCreateQuoteNotification: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockGetQuoteAccountsRecipientIds: vi.fn(),
  mockRenderConfiguredQuoteEmailTemplate: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  appendQuoteTimelineEvent: mockAppendQuoteTimelineEvent,
  createQuoteNotification: mockCreateQuoteNotification,
  fetchQuoteBundle: mockFetchQuoteBundle,
  getQuoteAccountsRecipientIds: mockGetQuoteAccountsRecipientIds,
}));

vi.mock('@/lib/server/quote-email-templates', () => ({
  renderConfiguredQuoteEmailTemplate: mockRenderConfiguredQuoteEmailTemplate,
}));

describe('POST /api/quotes/[id]/invoice-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderConfiguredQuoteEmailTemplate.mockResolvedValue({
      subject: 'Ready to invoice: Q-001',
      bodyText: 'Quote Q-001 is ready to invoice.',
      bodyHtml: 'Quote Q-001 is ready to invoice.',
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    });
  });

  it('rejects invoice requests above the available balance', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoice-requests/route');

    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        is_latest_version: true,
      },
      invoiceSummary: {
        availableToRequest: 100,
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoice-requests', {
      method: 'POST',
      body: JSON.stringify({
        requested_amount: 150,
        requested_invoice_date: '2026-03-24',
        requested_invoice_scope: 'partial',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.field_errors).toEqual({
      requested_amount: 'This quote has £100.00 available to request.',
    });
    expect(mockGetQuoteAccountsRecipientIds).not.toHaveBeenCalled();
  });

  it('requires Accounts recipients before creating a ready-to-invoice request', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoice-requests/route');

    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        is_latest_version: true,
      },
      invoiceSummary: {
        availableToRequest: 100,
      },
    });
    mockGetQuoteAccountsRecipientIds.mockResolvedValue([]);

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoice-requests', {
      method: 'POST',
      body: JSON.stringify({
        requested_amount: 50,
        requested_invoice_date: '2026-03-24',
        requested_invoice_scope: 'partial',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('No quote invoice notification recipients have been configured.');
  });

  it('creates a pending invoice request and notifies Accounts', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoice-requests/route');
    const insertedRequest = {
      id: 'request-1',
      requested_amount: 50,
      requested_invoice_date: '2026-03-24',
      requested_invoice_scope: 'partial',
      requested_at: '2026-03-24T09:00:00.000Z',
    };

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'quote_invoice_requests') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: insertedRequest,
                error: null,
              }),
            })),
          })),
        };
      }),
    });

    mockFetchQuoteBundle
      .mockResolvedValueOnce({
        quote: {
          id: 'quote-1',
          quote_reference: '40000-GH',
          quote_thread_id: 'thread-1',
          is_latest_version: true,
          customer: { company_name: 'Acme Ltd' },
          status: 'completed_full',
        },
        invoiceSummary: {
          availableToRequest: 100,
        },
      })
      .mockResolvedValueOnce({
        invoiceRequests: [{ ...insertedRequest, status: 'pending' }],
        invoiceSummary: {
          availableToRequest: 50,
          pendingRequestedTotal: 50,
          status: 'ready_to_invoice',
        },
      });
    mockGetQuoteAccountsRecipientIds.mockResolvedValue(['accounts-1']);
    mockCreateQuoteNotification.mockResolvedValue(undefined);

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoice-requests', {
      method: 'POST',
      body: JSON.stringify({
        requested_amount: 50,
        requested_invoice_date: '2026-03-24',
        requested_invoice_scope: 'partial',
        manager_comments: 'Invoice phase one.',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(201);
    expect(mockRenderConfiguredQuoteEmailTemplate).toHaveBeenCalledWith(expect.anything(), 'invoice_request', expect.objectContaining({
      quote_reference: '40000-GH',
      invoice_amount: '£50.00',
      invoice_scope: 'Partial invoice',
    }));
    expect(mockCreateQuoteNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientIds: ['accounts-1'],
      subject: 'Ready to invoice: Q-001',
      body: 'Quote Q-001 is ready to invoice.',
      sendEmail: true,
    }));
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'invoice_requested',
      fromStatus: 'completed_full',
      toStatus: 'completed_full',
    }));
  });

  it('retracts an unprocessed pending invoice request', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/invoice-requests/route');
    const updateRequest = vi.fn((_updates: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'quote_invoice_requests') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          update: updateRequest,
        };
      }),
    });

    mockFetchQuoteBundle
      .mockResolvedValueOnce({
        quote: {
          id: 'quote-1',
          quote_reference: '40000-GH',
          quote_thread_id: 'thread-1',
          is_latest_version: true,
          status: 'completed_full',
        },
        invoiceRequests: [{
          id: 'request-1',
          requested_amount: 50,
          requested_invoice_scope: 'partial',
          status: 'pending',
          fulfilled_invoice_id: null,
        }],
      })
      .mockResolvedValueOnce({
        invoiceRequests: [{ id: 'request-1', status: 'cancelled' }],
        invoiceSummary: {
          availableToRequest: 100,
          pendingRequestedTotal: 0,
        },
      });

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoice-requests', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'cancel',
        invoice_request_id: 'request-1',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.invoice_requests).toEqual([{ id: 'request-1', status: 'cancelled' }]);
    expect(updateRequest).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'invoice_request_cancelled',
      title: 'Invoice request retracted',
    }));
  });
});
