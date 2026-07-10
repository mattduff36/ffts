import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFetchQuoteBundle,
  mockAppendQuoteTimelineEvent,
  mockGenerateQuoteReferenceForManager,
  mockGetQuoteManagerOption,
  mockGetInitialsFromName,
  mockSendQuoteToCustomerEmail,
  mockSendQuotePoRequestEmail,
  mockSendQuoteRamsRequestEmail,
  mockGetQuoteEmailCcEmails,
  mockGetQuoteNotificationRecipientEmails,
  mockCanManageQuoteSage,
  mockCopyQuoteCustomerContactRecipients,
  mockNormalizeSecondaryContactIds,
  mockReplaceQuoteCustomerContactRecipients,
  mockValidateSecondaryContactIdsForCustomer,
  mockQuoteUpdate,
  mockQuoteUpdateEq,
  mockQuoteUpdateNeq,
  mockQuoteInsert,
  mockLineItemInsert,
  mockListRemainingVersions,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockAppendQuoteTimelineEvent: vi.fn(),
  mockGenerateQuoteReferenceForManager: vi.fn(),
  mockGetQuoteManagerOption: vi.fn(),
  mockGetInitialsFromName: vi.fn(),
  mockSendQuoteToCustomerEmail: vi.fn(),
  mockSendQuotePoRequestEmail: vi.fn(),
  mockSendQuoteRamsRequestEmail: vi.fn(),
  mockGetQuoteEmailCcEmails: vi.fn(),
  mockGetQuoteNotificationRecipientEmails: vi.fn(),
  mockCanManageQuoteSage: vi.fn(),
  mockCopyQuoteCustomerContactRecipients: vi.fn(),
  mockNormalizeSecondaryContactIds: vi.fn(),
  mockReplaceQuoteCustomerContactRecipients: vi.fn(),
  mockValidateSecondaryContactIdsForCustomer: vi.fn(),
  mockQuoteUpdate: vi.fn(),
  mockQuoteUpdateEq: vi.fn(),
  mockQuoteUpdateNeq: vi.fn(),
  mockQuoteInsert: vi.fn(),
  mockLineItemInsert: vi.fn(),
  mockListRemainingVersions: vi.fn(),
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

vi.mock('@/lib/server/quote-sage-access', () => ({
  canManageQuoteSage: mockCanManageQuoteSage,
}));

vi.mock('@/lib/server/quote-recipient-contacts', () => ({
  copyQuoteCustomerContactRecipients: mockCopyQuoteCustomerContactRecipients,
  normalizeSecondaryContactIds: mockNormalizeSecondaryContactIds,
  replaceQuoteCustomerContactRecipients: mockReplaceQuoteCustomerContactRecipients,
  validateSecondaryContactIdsForCustomer: mockValidateSecondaryContactIdsForCustomer,
}));

vi.mock('@/lib/server/quote-workflow', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/quote-workflow')>('@/lib/server/quote-workflow');
  return {
    ...actual,
    appendQuoteTimelineEvent: mockAppendQuoteTimelineEvent,
    fetchQuoteBundle: mockFetchQuoteBundle,
    generateQuoteReferenceForManager: mockGenerateQuoteReferenceForManager,
    getInitialsFromName: mockGetInitialsFromName,
    getQuoteEmailCcEmails: mockGetQuoteEmailCcEmails,
    getQuoteManagerOption: mockGetQuoteManagerOption,
    getQuoteNotificationRecipientEmails: mockGetQuoteNotificationRecipientEmails,
    sendQuotePoRequestEmail: mockSendQuotePoRequestEmail,
    sendQuoteRamsRequestEmail: mockSendQuoteRamsRequestEmail,
    sendQuoteToCustomerEmail: mockSendQuoteToCustomerEmail,
  };
});

describe('PATCH /api/quotes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendQuoteToCustomerEmail.mockResolvedValue({ success: true });
    mockSendQuotePoRequestEmail.mockResolvedValue({ success: true });
    mockGetQuoteEmailCcEmails.mockResolvedValue(['ops-copy@example.test']);
    mockGetQuoteNotificationRecipientEmails.mockResolvedValue(['ops-copy@example.test']);
    mockCanManageQuoteSage.mockResolvedValue(false);
    mockGenerateQuoteReferenceForManager.mockResolvedValue({ quoteReference: '80001-CD', initials: 'CD' });
    mockGetQuoteManagerOption.mockResolvedValue({
      profile_id: 'manager-2',
      initials: 'CD',
      manager_email: 'charlotte@example.test',
      signoff_name: 'Example Approver',
      signoff_title: 'Accounts Manager',
      profile: { full_name: 'Example Approver' },
    });
    mockGetInitialsFromName.mockReturnValue('CD');
    mockCopyQuoteCustomerContactRecipients.mockResolvedValue(undefined);
    mockNormalizeSecondaryContactIds.mockReturnValue([]);
    mockReplaceQuoteCustomerContactRecipients.mockResolvedValue({});
    mockValidateSecondaryContactIdsForCustomer.mockResolvedValue({});
    mockQuoteInsert.mockResolvedValue({ error: null });
    mockLineItemInsert.mockResolvedValue({ error: null });
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

        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id: 'manager-2', full_name: 'Example Approver' }, error: null }),
                maybeSingle: vi.fn().mockResolvedValue({ data: { full_name: 'Sender User' }, error: null }),
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
          data: { user: { id: 'user-1', email: 'sender@example.test' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return {
            insert: vi.fn((payload: unknown) => {
              mockQuoteInsert(payload);
              return Promise.resolve({ error: null });
            }),
            update: vi.fn((payload: unknown) => {
              mockQuoteUpdate(payload);
              return {
                eq: vi.fn((...args: unknown[]) => {
                  mockQuoteUpdateEq(...args);
                  return {
                    error: null,
                    neq: vi.fn((...neqArgs: unknown[]) => {
                      mockQuoteUpdateNeq(...neqArgs);
                      return Promise.resolve({ error: null });
                    }),
                  };
                }),
              };
            }),
            delete: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          };
        }

        if (table === 'quote_line_items') {
          return {
            insert: vi.fn((payload: unknown) => {
              mockLineItemInsert(payload);
              return Promise.resolve({ error: null });
            }),
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
      selectedSecondaryContacts: [],
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
    expect(payload.error).toBe('Add a primary customer contact email before confirming this quote.');
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
      selectedSecondaryContacts: [],
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
    expect(mockSendQuoteToCustomerEmail).toHaveBeenCalledWith(
      expect.anything(),
      ['manager@example.test', 'ops-copy@example.test'],
      'sender@example.test'
    );
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

  it.each(['confirm_and_send', 'approve_and_send'])(
    'keeps the sender eligible for customer email copies when sending on behalf via %s',
    async (action) => {
      const { PATCH } = await import('@/app/api/quotes/[id]/route');
      mockGetQuoteEmailCcEmails.mockResolvedValueOnce([
        'charlotte@example.test',
        'ops-copy@example.test',
      ]);
      mockFetchQuoteBundle.mockResolvedValue({
        quote: {
          id: 'quote-1',
          status: action === 'confirm_and_send' ? 'draft' : 'approved',
          is_latest_version: true,
          quote_reference: 'Q-001',
          quote_thread_id: 'thread-1',
          subject_line: 'Fence repairs',
          pricing_mode: 'itemized',
          requester_id: 'manager-neil',
          manager_email: 'neil@example.test',
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
        selectedSecondaryContacts: [],
        invoiceSummary: {
          invoicedTotal: 0,
          remainingBalance: 0,
          lastInvoiceAt: null,
          status: 'not_invoiced',
        },
      });

      const request = new NextRequest('http://localhost/api/quotes/quote-1', {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });

      expect(response.status).toBe(200);
      expect(mockGetQuoteEmailCcEmails).toHaveBeenCalledWith(
        expect.anything(),
        'quote_customer_email_copy',
        ['manager-neil']
      );
      expect(mockSendQuoteToCustomerEmail).toHaveBeenCalledWith(
        expect.anything(),
        ['neil@example.test', 'charlotte@example.test', 'ops-copy@example.test'],
        'sender@example.test'
      );
    }
  );

  it('duplicates a quote with a fresh selected-manager quote number', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    const sourceBundle = {
      quote: {
        id: 'quote-1',
        status: 'sent',
        is_latest_version: true,
        quote_reference: '80000-MD',
        base_quote_reference: '80000-MD',
        quote_thread_id: 'thread-1',
        revision_number: 0,
        revision_type: 'original',
        subject_line: 'Fence repairs',
        requester_id: 'manager-1',
        requester_initials: 'MD',
        manager_name: 'Example Manager',
        manager_email: 'matt@example.test',
        signoff_name: 'Example Manager',
        signoff_title: 'Contracts Manager',
        po_number: null,
        sage_posted_at: '2026-06-05T12:00:00.000Z',
        sage_posted_by: 'accounts-user',
        created_at: '2026-03-24T09:00:00.000Z',
        updated_at: '2026-03-24T09:00:00.000Z',
      },
      lineItems: [{
        id: 'line-1',
        description: 'Fence repairs',
        quantity: 1,
        unit: 'item',
        unit_rate: 100,
        line_total: 100,
        sort_order: 0,
      }],
      attachments: [],
      invoices: [],
      invoiceRequests: [],
      versions: [],
      timeline: [],
      selectedSecondaryContacts: [{ id: 'contact-1' }],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 100,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    };
    mockFetchQuoteBundle.mockResolvedValue(sourceBundle);

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'duplicate', manager_profile_id: 'manager-2', version_notes: 'Copy for new works' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
    expect(mockGenerateQuoteReferenceForManager).toHaveBeenCalledWith({
      managerProfileId: 'manager-2',
      fallbackInitials: 'CD',
    });
    expect(mockQuoteInsert).toHaveBeenCalledWith(expect.objectContaining({
      quote_reference: '80001-CD',
      base_quote_reference: '80001-CD',
      revision_number: 0,
      revision_type: 'original',
      version_label: 'Original',
      requester_id: 'manager-2',
      requester_initials: 'CD',
      manager_name: 'Example Approver',
      manager_email: 'charlotte@example.test',
      duplicate_source_quote_id: 'quote-1',
      status: 'draft',
      sage_posted_at: null,
      sage_posted_by: null,
    }));
    expect(mockCopyQuoteCustomerContactRecipients).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      [{ id: 'contact-1' }],
      'user-1'
    );
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'quote_duplicated',
      quoteReference: '80001-CD',
    }));
  });

  it('creates revisions that inherit the source quote Sage status', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'sent',
        is_latest_version: true,
        quote_reference: '80000-MD',
        base_quote_reference: '80000-MD',
        quote_thread_id: 'thread-1',
        revision_number: 0,
        revision_type: 'original',
        requester_id: 'manager-1',
        requester_initials: 'MD',
        sage_posted_at: '2026-06-05T12:00:00.000Z',
        sage_posted_by: 'accounts-user',
        created_at: '2026-03-24T09:00:00.000Z',
        updated_at: '2026-03-24T09:00:00.000Z',
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      invoiceRequests: [],
      versions: [],
      timeline: [],
      selectedSecondaryContacts: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 100,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'create_revision', revision_type: 'revision', version_notes: 'Client changes' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
    expect(mockQuoteInsert).toHaveBeenCalledWith(expect.objectContaining({
      quote_reference: '80000-MD-REV1',
      base_quote_reference: '80000-MD',
      quote_thread_id: 'thread-1',
      revision_number: 1,
      revision_type: 'revision',
      sage_posted_at: '2026-06-05T12:00:00.000Z',
      sage_posted_by: 'accounts-user',
    }));
    expect(mockQuoteUpdateEq).toHaveBeenCalledWith('quote_thread_id', 'thread-1');
    expect(mockQuoteUpdateNeq).toHaveBeenCalledWith('id', expect.any(String));
  });

  it('sends a PO request email to selected saved customer recipients', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'sent',
        is_latest_version: true,
        quote_reference: '80000-MD',
        quote_thread_id: 'thread-1',
        sent_at: '2026-03-24T09:00:00.000Z',
        customer_sent_at: '2026-03-24T09:00:00.000Z',
        attention_email: 'alex@example.com',
        po_number: null,
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
      invoiceRequests: [],
      versions: [],
      timeline: [],
      selectedSecondaryContacts: [{ email: 'chris@example.com' }],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 100,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'request_po',
        po_request_recipient_emails: ['alex@example.com', 'chris@example.com'],
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(200);
    expect(mockSendQuotePoRequestEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmails: ['alex@example.com', 'chris@example.com'],
      cc: ['ops-copy@example.test'],
      senderEmail: 'sender@example.test',
      senderName: 'Sender User',
    }));
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'po_request_sent',
      description: 'PO request emailed to alex@example.com, chris@example.com.',
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

  it('marks a quote as posted to Sage for Accounts/admin users', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockCanManageQuoteSage.mockResolvedValue(true);
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: true,
        quote_thread_id: 'thread-1',
        quote_reference: 'Q-001',
        subject_line: 'Fence repairs',
        site_address: 'Depot Yard',
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
        remainingBalance: 1200,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'toggle_sage', on_sage: true }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockQuoteUpdate).toHaveBeenCalledWith({
      sage_posted_at: expect.any(String),
      sage_posted_by: 'user-1',
      updated_by: 'user-1',
    });
    expect(mockQuoteUpdateEq).toHaveBeenCalledWith('quote_thread_id', 'thread-1');
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'quote_marked_on_sage',
      title: 'Quote marked on Sage',
      description: 'Q-001 - Acme Ltd - Depot Yard - Fence repairs',
    }));
    expect(payload.quote.can_manage_sage).toBe(true);
  });

  it('rejects quote Sage updates for users outside Accounts/admin', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockCanManageQuoteSage.mockResolvedValue(false);
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'draft',
        is_latest_version: true,
        quote_thread_id: 'thread-1',
        quote_reference: 'Q-001',
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 1200,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'toggle_sage', on_sage: true }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Only Accounts or admin users can update Sage status.');
    expect(mockQuoteUpdate).not.toHaveBeenCalled();
    expect(mockAppendQuoteTimelineEvent).not.toHaveBeenCalled();
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
        cc: ['ops-copy@example.test'],
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
        manager_email: 'admin@mpdee.co.uk',
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
