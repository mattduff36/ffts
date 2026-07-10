import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET, POST } from '@/app/api/quotes/route';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCalculateQuoteTotals,
  mockAppendQuoteTimelineEvent,
  mockFetchQuoteBundle,
  mockGenerateQuoteReferenceForManager,
  mockGetInitialsFromName,
  mockGetInvoiceSummary,
  mockGetQuoteManagerOption,
  mockLoadQuoteModuleSettings,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCalculateQuoteTotals: vi.fn(),
  mockAppendQuoteTimelineEvent: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockGenerateQuoteReferenceForManager: vi.fn(),
  mockGetInitialsFromName: vi.fn(),
  mockGetInvoiceSummary: vi.fn(),
  mockGetQuoteManagerOption: vi.fn(),
  mockLoadQuoteModuleSettings: vi.fn(),
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
  calculateQuoteTotals: mockCalculateQuoteTotals,
  appendQuoteTimelineEvent: mockAppendQuoteTimelineEvent,
  fetchQuoteBundle: mockFetchQuoteBundle,
  generateQuoteReferenceForManager: mockGenerateQuoteReferenceForManager,
  getInitialsFromName: mockGetInitialsFromName,
  getInvoiceSummary: mockGetInvoiceSummary,
  getQuoteManagerOption: mockGetQuoteManagerOption,
  loadQuoteModuleSettings: mockLoadQuoteModuleSettings,
}));

function createQueryableResult<T>(rows: T[]) {
  const result = { data: rows, error: null };
  return createSupabaseQueryMock(result, ['eq', 'in', 'order']);
}

function createPaginatedQuoteQuery(rows: Array<Record<string, unknown>>) {
  const query = createQueryableResult(rows);
  const range = vi.fn().mockReturnValue(query);
  const order = vi.fn().mockReturnValue({ range });

  return { query, order, range };
}

describe('GET /api/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInvoiceSummary.mockImplementation(({ total, invoices }) => ({
      invoicedTotal: (invoices || []).reduce((sum: number, invoice: { amount: number }) => sum + invoice.amount, 0),
      pendingRequestedTotal: 0,
      remainingBalance: total,
      availableToRequest: total,
      lastInvoiceAt: null,
      status: 'not_invoiced',
    }));
  });

  it('returns global summary metrics alongside paginated quotes', async () => {
    const paginatedQuotes = [
      {
        id: 'quote-1',
        quote_thread_id: 'thread-1',
        quote_reference: 'Q-001',
        total: 1200,
        status: 'draft',
        quote_date: '2026-03-24',
        base_quote_reference: 'Q-001',
        customer: { company_name: 'Acme Ltd' },
      },
      {
        id: 'quote-2',
        quote_thread_id: 'thread-2',
        quote_reference: 'Q-002',
        total: 2500,
        status: 'in_progress',
        quote_date: '2026-03-23',
        base_quote_reference: 'Q-002',
        sage_posted_at: '2026-03-24T10:00:00.000Z',
        customer: { company_name: 'Bravo Ltd' },
      },
    ];
    const summaryRows = [
      { status: 'draft', total: 1200 },
      { status: 'in_progress', total: 2500 },
      { status: 'invoiced', total: 3000 },
      { status: 'lost', total: 900 },
    ];
    const { query: listQuery, order, range } = createPaginatedQuoteQuery(paginatedQuotes);
    const previousVersionsQuery = createQueryableResult([]);
    const summaryQuery = createQueryableResult(summaryRows);
    const invoiceIn = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });
    const invoiceRequestIn = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });
    let quoteSelectCount = 0;
    const selectQuotes = vi.fn((columns: string) => {
      if (columns.includes('customer:customers')) {
        quoteSelectCount += 1;
        if (quoteSelectCount === 1) {
          return { order };
        }

        return previousVersionsQuery;
      }

      if (columns === 'status, total') {
        return summaryQuery;
      }

      throw new Error(`Unexpected select columns: ${columns}`);
    });
    const selectInvoices = vi.fn(() => ({
      in: invoiceIn,
    }));
    const selectInvoiceRequests = vi.fn(() => ({
      in: invoiceRequestIn,
    }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return { select: selectQuotes };
        }

        if (table === 'quote_invoices') {
          return { select: selectInvoices };
        }

        if (table === 'quote_invoice_requests') {
          return { select: selectInvoiceRequests };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/quotes?limit=2&offset=0'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(0, 1);
    expect(listQuery.eq).toHaveBeenCalledWith('is_latest_version', true);
    expect(previousVersionsQuery.in).toHaveBeenCalledWith('quote_thread_id', ['thread-1', 'thread-2']);
    expect(previousVersionsQuery.eq).toHaveBeenCalledWith('is_latest_version', false);
    expect(summaryQuery.eq).toHaveBeenCalledWith('is_latest_version', true);
    expect(invoiceIn).toHaveBeenCalledWith('quote_id', ['quote-1', 'quote-2']);
    expect(invoiceRequestIn).toHaveBeenCalledWith('quote_id', ['quote-1', 'quote-2']);
    expect(payload.summary).toEqual({
      total_quotes: 4,
      status_counts: expect.objectContaining({
        all: 4,
        draft: 1,
        in_progress: 1,
        invoiced: 1,
      }),
      accepted_quotes: 2,
      accepted_value: 5500,
    });
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 2,
      has_more: true,
    });
    expect(payload.quotes[0].previous_versions).toEqual([]);
    expect(payload.quotes.map((quote: { sage_status: string }) => quote.sage_status)).toEqual([
      'not_on_sage',
      'on_sage',
    ]);
  });
});

describe('POST /api/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCalculateQuoteTotals.mockReturnValue({
      subtotal: 0,
      total: 0,
    });
    mockGetQuoteManagerOption.mockResolvedValue({
      profile_id: 'manager-1',
      initials: 'MD',
      manager_email: 'admin@mpdee.co.uk',
      approver_profile_id: 'approver-1',
      signoff_name: 'Example Admin',
      signoff_title: 'Contracts Manager',
      profile: { full_name: 'Example Admin' },
    });
    mockGenerateQuoteReferenceForManager.mockResolvedValue({
      quoteReference: '80000-MD',
      initials: 'MD',
    });
    mockGetInitialsFromName.mockReturnValue('MD');
    mockLoadQuoteModuleSettings.mockResolvedValue({
      default_start_alert_days: null,
      default_estimated_duration_days: null,
    });
    mockFetchQuoteBundle.mockResolvedValue({
      quote: { id: 'quote-1', quote_reference: '80000-MD' },
      lineItems: [],
      attachments: [],
      ramsDocuments: [],
      invoices: [],
      invoiceRequests: [],
      versions: [],
      selectedSecondaryContacts: [],
      invoiceSummary: {
        invoicedTotal: 0,
        pendingRequestedTotal: 0,
        remainingBalance: 0,
        availableToRequest: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });
  });

  it('returns field errors when required draft fields are missing', async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);

    const request = new NextRequest('http://localhost/api/quotes', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: '',
        manager_profile_id: '',
        start_alert_days: '',
        line_items: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Please correct the highlighted fields and try again.');
    expect(payload.field_errors).toEqual({
      attention_email: 'Enter the contact email.',
      attention_name: 'Enter who this quote is for the attention of.',
      customer_id: 'Select a customer.',
      manager_profile_id: 'Select a manager.',
      project_description: 'Enter a quote summary.',
      quote_date: 'Select a quote date.',
      scope: 'Enter the quote scope.',
      site_address: 'Enter the site address for this quote.',
      subject_line: 'Enter a quote title.',
      validity_days: 'Enter quote validity in days.',
    });
    expect(mockGetQuoteManagerOption).not.toHaveBeenCalled();
  });

  it('normalizes optional empty fields and skips blank line items', async () => {
    const quoteInsert = vi.fn().mockResolvedValue({ error: null });
    const lineItemInsert = vi.fn().mockResolvedValue({ error: null });
    const profileSingle = vi.fn().mockResolvedValue({
      data: { id: 'manager-1', full_name: 'Example Admin' },
      error: null,
    });
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return { insert: quoteInsert };
        }

        if (table === 'quote_line_items') {
          return { insert: lineItemInsert };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: profileEq,
            })),
          };
        }

        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const request = new NextRequest('http://localhost/api/quotes', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: 'customer-1',
        manager_profile_id: 'manager-1',
        quote_date: '2026-03-24',
        validity_days: 30,
        attention_name: 'Jane Customer',
        attention_email: 'jane@example.com',
        site_address: '1 Test Street',
        subject_line: 'Fence works',
        project_description: 'Short summary',
        scope: 'Install fencing',
        pricing_mode: 'attachments_only',
        start_date: '',
        start_alert_days: '',
        estimated_duration_days: 5,
        line_items: [
          {
            description: '',
            quantity: 1,
            unit: '',
            unit_rate: 0,
            sort_order: 0,
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(quoteInsert).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 'customer-1',
      quote_reference: '80000-MD',
      start_alert_days: null,
      start_date: null,
      estimated_duration_days: 5,
      subject_line: 'Fence works',
      project_description: 'Short summary',
      scope: 'Install fencing',
      pricing_mode: 'attachments_only',
      subtotal: 0,
      total: 0,
    }));
    expect(lineItemInsert).not.toHaveBeenCalled();
  });

  it('persists selected secondary customer contact recipients', async () => {
    const quoteInsert = vi.fn().mockResolvedValue({ error: null });
    const lineItemInsert = vi.fn().mockResolvedValue({ error: null });
    const recipientDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const recipientInsert = vi.fn().mockResolvedValue({ error: null });
    const profileSingle = vi.fn().mockResolvedValue({
      data: { id: 'manager-1', full_name: 'Matt Duffill' },
      error: null,
    });
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle });
    const contactIn = vi.fn().mockResolvedValue({
      data: [{ id: 'contact-1' }, { id: 'contact-2' }],
      error: null,
    });
    const contactEq = vi.fn().mockReturnValue({ in: contactIn });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return { insert: quoteInsert };
        }

        if (table === 'quote_line_items') {
          return { insert: lineItemInsert };
        }

        if (table === 'quote_customer_contact_recipients') {
          return {
            delete: vi.fn(() => ({
              eq: recipientDeleteEq,
            })),
            insert: recipientInsert,
          };
        }

        if (table === 'customer_contacts') {
          return {
            select: vi.fn(() => ({
              eq: contactEq,
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: profileEq,
            })),
          };
        }

        if (table === 'customer_contacts') {
          return {
            select: vi.fn(() => ({
              eq: contactEq,
            })),
          };
        }

        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await POST(new NextRequest('http://localhost/api/quotes', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: 'customer-1',
        manager_profile_id: 'manager-1',
        quote_date: '2026-03-24',
        validity_days: 30,
        attention_name: 'Jane Customer',
        attention_email: 'jane@example.com',
        site_address: '1 Test Street',
        subject_line: 'Recipient quote',
        project_description: 'Recipient summary',
        scope: 'Recipient scope',
        pricing_mode: 'attachments_only',
        secondary_contact_ids: ['contact-1', 'contact-2', 'contact-1'],
        line_items: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    const insertedQuoteId = quoteInsert.mock.calls[0][0].id;
    expect(contactEq).toHaveBeenCalledWith('customer_id', 'customer-1');
    expect(contactIn).toHaveBeenCalledWith('id', ['contact-1', 'contact-2']);
    expect(recipientDeleteEq).toHaveBeenCalledWith('quote_id', insertedQuoteId);
    expect(recipientInsert).toHaveBeenCalledWith([
      {
        quote_id: insertedQuoteId,
        customer_contact_id: 'contact-1',
        created_by: 'user-1',
      },
      {
        quote_id: insertedQuoteId,
        customer_contact_id: 'contact-2',
        created_by: 'user-1',
      },
    ]);
  });

  it('applies quote module defaults when schedule fields are blank', async () => {
    const quoteInsert = vi.fn().mockResolvedValue({ error: null });
    const lineItemInsert = vi.fn().mockResolvedValue({ error: null });
    const profileSingle = vi.fn().mockResolvedValue({
      data: { id: 'manager-1', full_name: 'Matt Duffill' },
      error: null,
    });
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle });

    mockLoadQuoteModuleSettings.mockResolvedValue({
      default_start_alert_days: 7,
      default_estimated_duration_days: 3,
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return { insert: quoteInsert };
        }

        if (table === 'quote_line_items') {
          return { insert: lineItemInsert };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: profileEq,
            })),
          };
        }

        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await POST(new NextRequest('http://localhost/api/quotes', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: 'customer-1',
        manager_profile_id: 'manager-1',
        quote_date: '2026-03-24',
        validity_days: 30,
        attention_name: 'Jane Customer',
        attention_email: 'jane@example.com',
        site_address: '1 Test Street',
        subject_line: 'Scheduled quote',
        project_description: 'Scheduled summary',
        scope: 'Scheduled scope',
        pricing_mode: 'attachments_only',
        start_alert_days: '',
        estimated_duration_days: '',
        line_items: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(quoteInsert).toHaveBeenCalledWith(expect.objectContaining({
      start_alert_days: 7,
      estimated_duration_days: 3,
    }));
  });
});
