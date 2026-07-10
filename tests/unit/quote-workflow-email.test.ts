import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteBundle } from '@/lib/server/quote-workflow';

vi.mock('server-only', () => ({}));

const {
  mockCreateAdminClient,
  mockLoadTemplateLogoDataUrl,
  mockQuotePDF,
  mockRenderToStream,
  mockGetUsersWithModuleAccess,
  mockGetHiddenSystemTestAccountIds,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockLoadTemplateLogoDataUrl: vi.fn(),
  mockQuotePDF: vi.fn(),
  mockRenderToStream: vi.fn(),
  mockGetUsersWithModuleAccess: vi.fn(),
  mockGetHiddenSystemTestAccountIds: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/pdf/template-logo', () => ({
  loadTemplateLogoDataUrl: mockLoadTemplateLogoDataUrl,
}));

vi.mock('@/lib/pdf/quote-pdf', () => ({
  QuotePDF: mockQuotePDF,
}));

vi.mock('@/lib/server/team-permissions', () => ({
  getUsersWithModuleAccess: mockGetUsersWithModuleAccess,
}));

vi.mock('@/lib/server/system-test-accounts', () => ({
  getHiddenSystemTestAccountIds: mockGetHiddenSystemTestAccountIds,
}));

vi.mock('@react-pdf/renderer', () => ({
  renderToStream: mockRenderToStream,
}));

const originalFetch = global.fetch;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const originalResendApiKey2 = process.env.RESEND_API_KEY_2;
const originalResendFromEmail2 = process.env.RESEND_FROM_EMAIL_2;
const VAT_NOTICE = 'All prices are subject to the current V.A.T. rates applicable at the time of invoice.';

function buildQuoteBundle(overrides: Partial<QuoteBundle['quote']> = {}): QuoteBundle {
  return {
    quote: {
      quote_reference: 'Q-001',
      base_quote_reference: 'Q-001',
      quote_date: '2026-05-26',
      attention_name: 'Alex Customer',
      attention_email: 'alex@example.com',
      salutation: 'Dear Alex,',
      project_description: 'Repair works',
      subject_line: 'Concrete repairs',
      scope: 'Repair the concrete.',
      site_address: '1 Road Lane',
      manager_email: 'stored-manager@example.test',
      pricing_mode: 'itemized',
      total: 0,
      validity_days: 30,
      signoff_name: 'Matt Duffill',
      signoff_title: 'Contracts Manager',
      version_label: 'Original',
      revision_type: 'original',
      revision_number: 0,
      custom_footer_text: null,
      customer: {
        id: 'customer-1',
        company_name: 'Acme Ltd',
        short_name: 'Acme',
        contact_name: 'Alex Customer',
        contact_email: 'alex@example.com',
      },
      ...overrides,
    } as QuoteBundle['quote'],
    lineItems: [],
    attachments: [],
    ramsDocuments: [],
    invoices: [],
    invoiceRequests: [],
    versions: [],
    timeline: [],
    selectedSecondaryContacts: [],
    invoiceSummary: {
      invoicedTotal: 0,
      pendingRequestedTotal: 0,
      remainingBalance: 0,
      availableToRequest: 0,
      lastInvoiceAt: null,
      status: 'not_invoiced',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM_EMAIL = 'Quotes <quotes@example.com>';
  delete process.env.RESEND_API_KEY_2;
  delete process.env.RESEND_FROM_EMAIL_2;
  mockGetUsersWithModuleAccess.mockResolvedValue(new Set(['copy-1']));
  mockGetHiddenSystemTestAccountIds.mockResolvedValue(new Set());

  global.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch;
  mockCreateAdminClient.mockReturnValue({
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(),
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'quote_email_templates') {
        return {
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  });
  mockLoadTemplateLogoDataUrl.mockResolvedValue(null);
  mockQuotePDF.mockReturnValue({ type: 'quote-pdf' });
  mockRenderToStream.mockResolvedValue((async function* streamPdf() {
    yield Buffer.from('pdf');
  })());
});

afterEach(() => {
  global.fetch = originalFetch;
  restoreEnv('RESEND_API_KEY', originalResendApiKey);
  restoreEnv('RESEND_FROM_EMAIL', originalResendFromEmail);
  restoreEnv('RESEND_API_KEY_2', originalResendApiKey2);
  restoreEnv('RESEND_FROM_EMAIL_2', originalResendFromEmail2);
});

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe('sendQuoteToCustomerEmail', () => {
  it('uses the sending account email for the PDF contact and Resend reply-to', async () => {
    const { sendQuoteToCustomerEmail } = await import('@/lib/server/quote-workflow');

    const result = await sendQuoteToCustomerEmail(
      buildQuoteBundle(),
      ['manager-copy@example.test'],
      'sender@example.test'
    );

    expect(result).toEqual({ success: true });
    expect(mockQuotePDF).toHaveBeenCalledWith(expect.objectContaining({
      managerEmail: 'sender@example.test',
    }));

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual(expect.objectContaining({
      from: 'Quotes <quotes@example.com>',
      to: ['alex@example.com'],
      cc: ['manager-copy@example.test', 'no-reply@example.test'],
      reply_to: ['sender@example.test', 'manager-copy@example.test'],
      subject: 'Q-001 - Acme Ltd - 1 Road Lane - Concrete repairs',
    }));
    expect(String(body.html)).toContain(VAT_NOTICE);
    expect(body.attachments).toEqual([
      expect.objectContaining({
        filename: 'Q-001 - Acme Ltd - 1 Road Lane - Concrete repairs.pdf',
      }),
    ]);
  });

  it('sends selected secondary customer contacts as To recipients', async () => {
    const { sendQuoteToCustomerEmail } = await import('@/lib/server/quote-workflow');

    const result = await sendQuoteToCustomerEmail(
      {
        ...buildQuoteBundle(),
        selectedSecondaryContacts: [
          {
            id: 'contact-1',
            customer_id: 'customer-1',
            name: 'Chris CC',
            job_title: null,
            email: 'chris@example.com',
            phone: null,
            created_at: '2026-06-02T10:00:00.000Z',
            updated_at: '2026-06-02T10:00:00.000Z',
            created_by: null,
            updated_by: null,
          },
          {
            id: 'contact-2',
            customer_id: 'customer-1',
            name: 'No Email',
            job_title: null,
            email: null,
            phone: null,
            created_at: '2026-06-02T10:00:00.000Z',
            updated_at: '2026-06-02T10:00:00.000Z',
            created_by: null,
            updated_by: null,
          },
        ],
      },
      ['manager-copy@example.test', 'chris@example.com'],
      'sender@example.test'
    );

    expect(result).toEqual({ success: true });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual(expect.objectContaining({
      to: ['alex@example.com', 'chris@example.com'],
      cc: ['manager-copy@example.test', 'no-reply@example.test'],
    }));
  });

  it('sends PO request emails with the quote-name subject and PDF attachment', async () => {
    const { sendQuotePoRequestEmail } = await import('@/lib/server/quote-workflow');

    const result = await sendQuotePoRequestEmail({
      bundle: buildQuoteBundle(),
      recipientEmails: ['alex@example.com', ' alex@example.com '],
      cc: ['charlotte@example.test', 'alex@example.com'],
      senderEmail: 'sender@example.test',
      senderName: 'Matt Duffill',
    });

    expect(result).toEqual({ success: true });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual(expect.objectContaining({
      from: 'Quotes <quotes@example.com>',
      to: ['alex@example.com'],
      cc: ['charlotte@example.test', 'no-reply@example.test'],
      reply_to: ['sender@example.test', 'charlotte@example.test'],
      subject: 'Q-001 - Acme Ltd - 1 Road Lane - Concrete repairs',
    }));
    expect(String(body.html)).toContain('Please can I have a purchase order for the attached quotation.');
    expect(String(body.html)).toContain(VAT_NOTICE);
    expect(String(body.html)).toContain('Kind Regards<br>Matt Duffill');
    expect(body.attachments).toEqual([
      expect.objectContaining({
        filename: 'Q-001 - Acme Ltd - 1 Road Lane - Concrete repairs.pdf',
      }),
    ]);
  });

  it('uses configured PO request wording while keeping recipients and attachments unchanged', async () => {
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          download: vi.fn(),
        })),
      },
      from: vi.fn((table: string) => {
        if (table === 'quote_email_templates') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{
                template_key: 'po_request',
                subject_template: 'PO needed for {quote_reference}',
                body_template: 'Hi {contact_name},\nPlease send a PO to {sender_name}.',
                updated_by: null,
                updated_at: null,
                created_at: '2026-06-03T10:00:00.000Z',
              }],
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { sendQuotePoRequestEmail } = await import('@/lib/server/quote-workflow');

    const result = await sendQuotePoRequestEmail({
      bundle: buildQuoteBundle(),
      recipientEmails: ['alex@example.com'],
      senderEmail: 'sender@example.test',
      senderName: 'Matt Duffill',
    });

    expect(result).toEqual({ success: true });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual(expect.objectContaining({
      to: ['alex@example.com'],
      cc: ['no-reply@example.test'],
      reply_to: 'sender@example.test',
      subject: 'PO needed for Q-001',
    }));
    expect(String(body.html)).toContain('Hi Alex Customer,<br>Please send a PO to Matt Duffill.');
    expect(body.attachments).toEqual([
      expect.objectContaining({
        filename: 'Q-001 - Acme Ltd - 1 Road Lane - Concrete repairs.pdf',
      }),
    ]);
  });
});

describe('quote workflow direct emails', () => {
  it('sends RAMS request emails with configured CC recipients', async () => {
    const { sendQuoteRamsRequestEmail } = await import('@/lib/server/quote-workflow');

    const result = await sendQuoteRamsRequestEmail({
      quoteReference: 'Q-001',
      customerName: 'Acme Ltd',
      subjectLine: 'Concrete repairs',
      cc: ['charlotte@example.test'],
      poNumber: 'PO-123',
      managerName: 'Matt Duffill',
    });

    expect(result).toEqual({ success: true });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual(expect.objectContaining({
      to: ['conway@example.test'],
      cc: ['charlotte@example.test', 'no-reply@example.test'],
    }));
  });

  it('sends start alert emails with configured CC recipients', async () => {
    const { sendQuoteStartAlertEmail } = await import('@/lib/server/quote-workflow');

    const result = await sendQuoteStartAlertEmail({
      to: 'manager@example.test',
      cc: ['charlotte@example.test'],
      managerName: 'Matt Duffill',
      quoteReference: 'Q-001',
      customerName: 'Acme Ltd',
      subjectLine: 'Concrete repairs',
      startDate: '2026-06-30',
    });

    expect(result).toEqual({ success: true });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual(expect.objectContaining({
      to: ['manager@example.test'],
      cc: ['charlotte@example.test', 'no-reply@example.test'],
    }));
  });
});

describe('createQuoteNotification', () => {
  it('uses visible channel toggles even when the legacy enabled flag is false', async () => {
    const { createQuoteNotification } = await import('@/lib/server/quote-workflow');
    const messageInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'message-1' }, error: null }),
      })),
    }));
    const recipientInsert = vi.fn().mockResolvedValue({ error: null });

    mockCreateAdminClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn(async (userId: string) => ({
            data: {
              user: {
                email: userId === 'copy-1' ? 'copy@example.com' : 'recipient@example.com',
              },
            },
            error: null,
          })),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'quote_invoice_notification_recipients') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ profile_id: 'copy-1', notification_type: 'quote_invoice_request_copy' }],
                error: null,
              }),
            })),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({
                  data: [{ id: 'copy-1', full_name: 'Copy User', employee_id: null, team_id: 'accounts' }],
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'notification_preferences') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      user_id: 'recipient-1',
                      enabled: false,
                      notify_in_app: true,
                      notify_email: true,
                    },
                  ],
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'messages') {
          return { insert: messageInsert };
        }
        if (table === 'message_recipients') {
          return { insert: recipientInsert };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    await createQuoteNotification({
      senderId: 'sender-1',
      recipientIds: ['recipient-1'],
      subject: 'Quote update',
      body: 'A quote needs attention.',
      sendEmail: true,
      emailCcType: 'quote_invoice_request_copy',
    });

    expect(messageInsert).toHaveBeenCalled();
    expect(recipientInsert).toHaveBeenCalledWith([
      {
        message_id: 'message-1',
        user_id: 'recipient-1',
        status: 'PENDING',
      },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toEqual(expect.objectContaining({
      to: ['recipient@example.com'],
      cc: ['copy@example.com', 'no-reply@example.test'],
    }));
  });
});
