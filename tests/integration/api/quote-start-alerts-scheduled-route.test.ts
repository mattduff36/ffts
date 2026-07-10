import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateAdminClient,
  mockCreateQuoteNotification,
  mockGetQuoteEmailCcEmails,
  mockGetQuoteInvoiceNotificationRecipientIds,
  mockSendQuoteStartAlertEmail,
  mockRenderConfiguredQuoteEmailTemplate,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockCreateQuoteNotification: vi.fn(),
  mockGetQuoteEmailCcEmails: vi.fn(),
  mockGetQuoteInvoiceNotificationRecipientIds: vi.fn(),
  mockSendQuoteStartAlertEmail: vi.fn(),
  mockRenderConfiguredQuoteEmailTemplate: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  createQuoteNotification: mockCreateQuoteNotification,
  getQuoteEmailCcEmails: mockGetQuoteEmailCcEmails,
  getQuoteInvoiceNotificationRecipientIds: mockGetQuoteInvoiceNotificationRecipientIds,
  sendQuoteStartAlertEmail: mockSendQuoteStartAlertEmail,
}));

vi.mock('@/lib/server/quote-email-templates', () => ({
  renderConfiguredQuoteEmailTemplate: mockRenderConfiguredQuoteEmailTemplate,
}));

describe('/api/quotes/start-alerts-scheduled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret';
    mockSendQuoteStartAlertEmail.mockResolvedValue({ success: true });
    mockGetQuoteEmailCcEmails.mockResolvedValue([]);
    mockGetQuoteInvoiceNotificationRecipientIds.mockResolvedValue(['copy-1']);
    mockCreateQuoteNotification.mockResolvedValue(undefined);
    mockRenderConfiguredQuoteEmailTemplate.mockResolvedValue({
      subject: 'Job start reminder: Q-001',
      bodyText: 'Quote Q-001 is due to start today.',
      bodyHtml: 'Quote Q-001 is due to start today.',
    });
  });

  it('notifies configured copy recipients when a start alert is sent', async () => {
    const { GET } = await import('@/app/api/quotes/start-alerts-scheduled/route');
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: updateEq }));
    const quotes = [
      {
        id: 'quote-1',
        quote_reference: 'Q-001',
        requester_id: 'manager-1',
        created_by: 'creator-1',
        updated_by: 'updater-1',
        start_date: new Date().toISOString().slice(0, 10),
        start_alert_days: 7,
        start_alert_sent_at: null,
        commercial_status: 'open',
        subject_line: 'Fence repairs',
        customer: { company_name: 'Acme Ltd' },
        manager: { full_name: 'Manager One' },
      },
    ];

    mockCreateAdminClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: 'manager@example.com' } },
          }),
        },
      },
      from: vi.fn((table: string) => {
        if (table !== 'quotes') throw new Error(`Unexpected table ${table}`);
        return {
          select: vi.fn(() => ({
            not: vi.fn(() => ({
              is: vi.fn(() => ({
                neq: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({ data: quotes, error: null }),
                    })),
                  })),
                })),
              })),
            })),
          })),
          update,
        };
      }),
    });

    const response = await GET(new NextRequest('http://localhost/api/quotes/start-alerts-scheduled', {
      headers: { authorization: 'Bearer secret' },
    }));

    expect(response.status).toBe(200);
    expect(mockGetQuoteInvoiceNotificationRecipientIds).toHaveBeenCalledWith(expect.anything(), 'start_alert_copy', ['manager-1']);
    expect(mockRenderConfiguredQuoteEmailTemplate).toHaveBeenCalledWith(expect.anything(), 'start_alert_copy', expect.objectContaining({
      quote_reference: 'Q-001',
      customer_name: 'Acme Ltd',
      subject_line: 'Fence repairs',
    }));
    expect(mockCreateQuoteNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientIds: ['copy-1'],
      subject: 'Job start reminder: Q-001',
      body: 'Quote Q-001 is due to start today.',
      sendEmail: true,
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      start_alert_sent_at: expect.any(String),
    }));
  });
});
