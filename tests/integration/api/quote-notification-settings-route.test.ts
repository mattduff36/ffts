import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockIsEffectiveRoleAdminOrSuper,
  mockListQuoteAccountsNotificationRecipientOptions,
  mockListQuoteAdditionalNotificationRecipientOptions,
  mockGetSelectedQuoteInvoiceNotificationRecipientIds,
  mockReplaceQuoteNotificationRecipients,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockIsEffectiveRoleAdminOrSuper: vi.fn(),
  mockListQuoteAccountsNotificationRecipientOptions: vi.fn(),
  mockListQuoteAdditionalNotificationRecipientOptions: vi.fn(),
  mockGetSelectedQuoteInvoiceNotificationRecipientIds: vi.fn(),
  mockReplaceQuoteNotificationRecipients: vi.fn(),
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

vi.mock('@/lib/utils/rbac', () => ({
  isEffectiveRoleAdminOrSuper: mockIsEffectiveRoleAdminOrSuper,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  QUOTE_INVOICE_NOTIFICATION_TYPES: ['invoice_request', 'invoice_added'],
  getSelectedQuoteInvoiceNotificationRecipientIds: mockGetSelectedQuoteInvoiceNotificationRecipientIds,
  listQuoteAdditionalNotificationRecipientOptions: mockListQuoteAdditionalNotificationRecipientOptions,
  listQuoteAccountsNotificationRecipientOptions: mockListQuoteAccountsNotificationRecipientOptions,
  replaceQuoteNotificationRecipients: mockReplaceQuoteNotificationRecipients,
}));

describe('/api/quotes/notification-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({});
    mockIsEffectiveRoleAdminOrSuper.mockResolvedValue(true);
    mockListQuoteAccountsNotificationRecipientOptions.mockResolvedValue([
      { id: 'accounts-1', full_name: 'Accounts One', employee_id: 'A1', team_id: 'accounts' },
    ]);
    mockListQuoteAdditionalNotificationRecipientOptions.mockResolvedValue([
      { id: 'manager-1', full_name: 'Manager One', employee_id: 'M1', team_id: 'operations' },
    ]);
    mockGetSelectedQuoteInvoiceNotificationRecipientIds.mockResolvedValue({
      invoice_request: ['accounts-1'],
      invoice_added: [],
    });
    mockReplaceQuoteNotificationRecipients.mockResolvedValue(undefined);
  });

  it('returns eligible recipients and filters stale saved selections by notification type', async () => {
    const { GET } = await import('@/app/api/quotes/notification-settings/route');
    mockGetSelectedQuoteInvoiceNotificationRecipientIds.mockResolvedValue({
      invoice_request: ['accounts-1', 'manager-1', 'stale-user'],
      invoice_added: ['manager-1', 'accounts-1', 'stale-user'],
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      can_manage: true,
      accounts_recipients: [
        { id: 'accounts-1', full_name: 'Accounts One', employee_id: 'A1', team_id: 'accounts' },
      ],
      additional_recipients: [
        { id: 'manager-1', full_name: 'Manager One', employee_id: 'M1', team_id: 'operations' },
      ],
      eligible_recipients: [
        { id: 'accounts-1', full_name: 'Accounts One', employee_id: 'A1', team_id: 'accounts' },
      ],
      selected_recipient_ids: ['accounts-1'],
      selected_notifications: {
        invoice_request: ['accounts-1', 'manager-1'],
        invoice_added: ['manager-1'],
      },
    });
  });

  it('rejects saving recipients outside the eligible quotes users list', async () => {
    const { PUT } = await import('@/app/api/quotes/notification-settings/route');

    const response = await PUT(new NextRequest('http://localhost/api/quotes/notification-settings', {
      method: 'PUT',
      body: JSON.stringify({ selected_notifications: { invoice_request: ['accounts-1', 'other-user'] } }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Selected recipients must be users with Quotes access in the correct notification section.');
  });

  it('saves the selected notification recipients by type', async () => {
    const { PUT } = await import('@/app/api/quotes/notification-settings/route');
    const admin = { client: 'admin' };
    mockCreateAdminClient.mockReturnValue(admin);

    const response = await PUT(new NextRequest('http://localhost/api/quotes/notification-settings', {
      method: 'PUT',
      body: JSON.stringify({
        selected_notifications: {
          invoice_request: ['accounts-1', 'manager-1'],
          invoice_added: ['manager-1'],
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockReplaceQuoteNotificationRecipients).toHaveBeenCalledWith(admin, {
      invoice_request: ['accounts-1', 'manager-1'],
      invoice_added: ['manager-1'],
    }, 'admin-1');
    expect(payload.selected_recipient_ids).toEqual(['accounts-1']);
    expect(payload.selected_notifications).toEqual({
      invoice_request: ['accounts-1', 'manager-1'],
      invoice_added: ['manager-1'],
    });
  });
});
