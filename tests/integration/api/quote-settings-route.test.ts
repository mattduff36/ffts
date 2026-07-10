import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockIsEffectiveRoleAdminOrSuper,
  mockGetSelectedQuoteInvoiceNotificationRecipientIds,
  mockListQuoteUserNotificationRecipientOptions,
  mockLoadQuoteModuleSettings,
  mockReplaceQuoteNotificationRecipients,
  mockUpsertQuoteModuleSettings,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockIsEffectiveRoleAdminOrSuper: vi.fn(),
  mockGetSelectedQuoteInvoiceNotificationRecipientIds: vi.fn(),
  mockListQuoteUserNotificationRecipientOptions: vi.fn(),
  mockLoadQuoteModuleSettings: vi.fn(),
  mockReplaceQuoteNotificationRecipients: vi.fn(),
  mockUpsertQuoteModuleSettings: vi.fn(),
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
  QUOTE_INVOICE_NOTIFICATION_TYPES: [
    'invoice_request',
    'invoice_added',
    'quote_sent_copy',
    'start_alert_copy',
    'quote_customer_email_copy',
    'quote_po_request_copy',
    'quote_rams_request_copy',
    'quote_start_alert_copy',
    'quote_invoice_request_copy',
    'quote_invoice_added_copy',
  ],
  getSelectedQuoteInvoiceNotificationRecipientIds: mockGetSelectedQuoteInvoiceNotificationRecipientIds,
  listQuoteUserNotificationRecipientOptions: mockListQuoteUserNotificationRecipientOptions,
  loadQuoteModuleSettings: mockLoadQuoteModuleSettings,
  replaceQuoteNotificationRecipients: mockReplaceQuoteNotificationRecipients,
  upsertQuoteModuleSettings: mockUpsertQuoteModuleSettings,
}));

describe('/api/quotes/settings', () => {
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
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({ error: null }),
            })),
          })),
        })),
      })),
    });
    mockIsEffectiveRoleAdminOrSuper.mockResolvedValue(true);
    mockLoadQuoteModuleSettings.mockResolvedValue({
      default_start_alert_days: 7,
      default_estimated_duration_days: 3,
    });
    mockListQuoteUserNotificationRecipientOptions.mockResolvedValue([
      { id: 'user-1', full_name: 'User One', employee_id: 'U1', team_id: 'ops' },
    ]);
    mockGetSelectedQuoteInvoiceNotificationRecipientIds.mockResolvedValue({
      invoice_request: [],
      invoice_added: [],
      quote_sent_copy: ['user-1'],
      start_alert_copy: [],
      quote_customer_email_copy: ['user-1'],
      quote_po_request_copy: [],
      quote_rams_request_copy: [],
      quote_start_alert_copy: [],
      quote_invoice_request_copy: [],
      quote_invoice_added_copy: [],
    });
    mockReplaceQuoteNotificationRecipients.mockResolvedValue(undefined);
    mockUpsertQuoteModuleSettings.mockResolvedValue({
      default_start_alert_days: 10,
      default_estimated_duration_days: 4,
    });
  });

  it('returns module defaults and selected quote notification recipients', async () => {
    const { GET } = await import('@/app/api/quotes/settings/route');

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toEqual({
      default_start_alert_days: 7,
      default_estimated_duration_days: 3,
    });
    expect(payload.selected_notifications.quote_customer_email_copy).toEqual(['user-1']);
  });

  it('saves defaults and configured copy recipients', async () => {
    const { PATCH } = await import('@/app/api/quotes/settings/route');
    const admin = { from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      })),
    })) };
    mockCreateAdminClient.mockReturnValue(admin);

    const response = await PATCH(new NextRequest('http://localhost/api/quotes/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        settings: {
          default_start_alert_days: 10,
          default_estimated_duration_days: 4,
        },
        selected_notifications: {
          quote_customer_email_copy: ['user-1'],
          quote_po_request_copy: ['user-1'],
        },
        apply_empty_defaults: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(mockReplaceQuoteNotificationRecipients).toHaveBeenCalledWith(admin, {
      quote_customer_email_copy: ['user-1'],
      quote_po_request_copy: ['user-1'],
    }, 'admin-1');
    expect(mockUpsertQuoteModuleSettings).toHaveBeenCalledWith(admin, {
      default_start_alert_days: 10,
      default_estimated_duration_days: 4,
    }, 'admin-1');
  });
});
