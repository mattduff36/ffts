import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFetchQuoteBundle,
  mockAppendQuoteTimelineEvent,
  mockSendQuoteToCustomerEmail,
  mockSendQuoteRamsRequestEmail,
  mockQuoteUpdate,
  mockListRemainingVersions,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockAppendQuoteTimelineEvent: vi.fn(),
  mockSendQuoteToCustomerEmail: vi.fn(),
  mockSendQuoteRamsRequestEmail: vi.fn(),
  mockQuoteUpdate: vi.fn(),
  mockListRemainingVersions: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/quote-workflow', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/quote-workflow')>('@/lib/server/quote-workflow');
  return {
    ...actual,
    appendQuoteTimelineEvent: mockAppendQuoteTimelineEvent,
    fetchQuoteBundle: mockFetchQuoteBundle,
    sendQuoteRamsRequestEmail: mockSendQuoteRamsRequestEmail,
    sendQuoteToCustomerEmail: mockSendQuoteToCustomerEmail,
  };
});

describe('PATCH /api/quotes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendQuoteToCustomerEmail.mockResolvedValue({ success: true });
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                neq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => mockListRemainingVersions()),
                  })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });
    mockListRemainingVersions.mockResolvedValue({ data: [], error: null });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return {
            update: vi.fn((payload: unknown) => {
              mockQuoteUpdate(payload);
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              };
            }),
            delete: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          };
        }

        return {
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }),
    });
  });

  it('returns a validation error when confirm_and_send has no customer email', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        is_latest_version: true,
        quote_reference: 'Q-001',
        subject_line: 'Fence repairs',
        manager_email: 'manager@example.com',
        attention_email: null,
        customer: {
          id: 'customer-1',
          company_name: 'Acme Ltd',
          contact_email: null,
          contact_name: 'Alex',
          short_name: 'Acme',
        },
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'confirm_and_send' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Add a customer contact email before confirming this quote.');
    expect(mockSendQuoteToCustomerEmail).not.toHaveBeenCalled();
  }, 15000);

  it('confirms and sends draft quotes in one action', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: true,
        quote_reference: 'Q-001',
        subject_line: 'Fence repairs',
        pricing_mode: 'itemized',
        manager_email: 'manager@example.com',
        attention_email: 'alex@example.com',
        customer: {
          id: 'customer-1',
          company_name: 'Acme Ltd',
          contact_email: 'alex@example.com',
          contact_name: 'Alex',
          short_name: 'Acme',
        },
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'confirm_and_send' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
    expect(mockSendQuoteToCustomerEmail).toHaveBeenCalled();
    expect(mockQuoteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'sent',
      approved_by: 'user-1',
      customer_sent_by: 'user-1',
    }));
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'confirmed_and_sent',
      toStatus: 'sent',
    }));
  });

  it('saves PO details without advancing the quote status', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'sent',
        is_latest_version: true,
        quote_reference: 'Q-001',
        subject_line: 'Fence repairs',
        manager_name: 'Manager',
        manager_email: 'manager@example.com',
        po_number: null,
        po_value: null,
        po_received_at: null,
        customer: {
          id: 'customer-1',
          company_name: 'Acme Ltd',
          contact_email: 'alex@example.com',
          contact_name: 'Alex',
          short_name: 'Acme',
        },
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'save_po_details', po_number: 'PO-123', po_value: 5000 }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
    expect(mockQuoteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        po_number: 'PO-123',
        po_value: 5000,
        updated_by: 'user-1',
      })
    );
    expect(mockQuoteUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'po_received' }));
    expect(mockSendQuoteRamsRequestEmail).not.toHaveBeenCalled();
  });

  it('triggers RAMS from sent quotes without requiring a PO number', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'sent',
        is_latest_version: true,
        quote_reference: 'Q-001',
        subject_line: 'Fence repairs',
        manager_name: 'Manager',
        manager_email: 'manager@example.com',
        po_number: null,
        po_value: null,
        po_received_at: null,
        customer: {
          id: 'customer-1',
          company_name: 'Acme Ltd',
          contact_email: 'alex@example.com',
          contact_name: 'Alex',
          short_name: 'Acme',
        },
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'trigger_rams', rams_comments: 'Mind the gate access.' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
    expect(mockQuoteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'po_received',
        updated_by: 'user-1',
      })
    );
    expect(mockSendQuoteRamsRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        poNumber: 'Not supplied',
        quoteReference: 'Q-001',
        ramsComments: 'Mind the gate access.',
      })
    );
  });

  it('rejects the removed legacy mark_po_received action', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'sent',
        is_latest_version: true,
        quote_reference: 'Q-001',
        subject_line: 'Fence repairs',
        manager_name: 'Manager',
        manager_email: 'manager@example.com',
        po_number: null,
        po_value: null,
        po_received_at: null,
        customer: {
          id: 'customer-1',
          company_name: 'Acme Ltd',
          contact_email: 'alex@example.com',
          contact_name: 'Alex',
          short_name: 'Acme',
        },
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'mark_po_received' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Unsupported quote action');
    expect(mockQuoteUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'po_received' }));
    expect(mockSendQuoteRamsRequestEmail).not.toHaveBeenCalled();
  });

  it('returns field errors for invalid generic quote edits', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: true,
        quote_reference: 'Q-001',
        quote_date: '2026-03-24',
        requester_initials: 'MD',
        subject_line: null,
        manager_name: 'Example Admin',
        manager_email: 'template-admin@example.com',
        signoff_name: 'Example Admin',
        signoff_title: 'Contracts Manager',
        validity_days: 30,
        customer: {
          id: 'customer-1',
          company_name: 'Acme Ltd',
          contact_email: 'alex@example.com',
          contact_name: 'Alex',
          short_name: 'Acme',
        },
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({
        customer_id: '',
        manager_profile_id: '',
        start_alert_days: 'abc',
        line_items: [
          { description: '', quantity: 2, unit: '', unit_rate: 50, sort_order: 0 },
        ],
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Please correct the highlighted fields and try again.');
    expect(payload.field_errors).toEqual({
      customer_id: 'Select a customer.',
      manager_profile_id: 'Select a manager.',
      start_alert_days: 'Alert days before start must be a whole number.',
      'line_items.0.description': 'Enter a description for this line item.',
    });
  });

  it('rejects changes to historical quote versions', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: false,
        quote_reference: 'Q-001',
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'submit_for_approval' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Only the latest quote version can be changed.');
    expect(mockQuoteUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/quotes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                neq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => mockListRemainingVersions()),
                  })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });
    mockListRemainingVersions.mockResolvedValue({ data: [], error: null });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return {
            update: vi.fn((payload: unknown) => {
              mockQuoteUpdate(payload);
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              };
            }),
            delete: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });
  });

  it('deletes draft quotes', async () => {
    const { DELETE } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: true,
        quote_thread_id: 'thread-1',
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const response = await DELETE(new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'DELETE',
    }), { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
  });

  it('promotes the previous version after deleting the latest draft', async () => {
    const { DELETE } = await import('@/app/api/quotes/[id]/route');
    mockListRemainingVersions.mockResolvedValue({
      data: [{ id: 'quote-older' }],
      error: null,
    });
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: true,
        quote_thread_id: 'thread-1',
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const response = await DELETE(new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'DELETE',
    }), { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
    expect(mockQuoteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        is_latest_version: true,
        updated_by: 'user-1',
      })
    );
  });

  it('rejects deleting historical draft versions', async () => {
    const { DELETE } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: false,
        quote_thread_id: 'thread-1',
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const response = await DELETE(new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'DELETE',
    }), { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Only the latest draft version can be deleted.');
  });

  it('rejects deleting non-draft quotes', async () => {
    const { DELETE } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'sent',
        is_latest_version: true,
        quote_thread_id: 'thread-1',
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const response = await DELETE(new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'DELETE',
    }), { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Only draft quotes can be deleted.');
  });
});
