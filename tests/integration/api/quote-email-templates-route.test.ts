import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockIsEffectiveRoleAdminOrSuper,
  mockSelectTemplates,
  mockUpsertTemplate,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockIsEffectiveRoleAdminOrSuper: vi.fn(),
  mockSelectTemplates: vi.fn(),
  mockUpsertTemplate: vi.fn(),
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

describe('/api/quotes/settings/email-templates', () => {
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
      from: vi.fn((table: string) => {
        if (table !== 'quote_email_templates') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select: mockSelectTemplates,
          upsert: mockUpsertTemplate,
        };
      }),
    });
    mockIsEffectiveRoleAdminOrSuper.mockResolvedValue(true);
    mockSelectTemplates.mockResolvedValue({
      data: [{
        template_key: 'po_request',
        subject_template: 'PO please: {quote_reference}',
        body_template: 'Hello {contact_name}',
        updated_by: 'admin-1',
        updated_at: '2026-06-03T10:00:00.000Z',
        created_at: '2026-06-03T10:00:00.000Z',
      }],
      error: null,
    });
    mockUpsertTemplate.mockResolvedValue({ error: null });
  });

  it('returns template definitions merged with saved wording', async () => {
    const { GET } = await import('@/app/api/quotes/settings/email-templates/route');

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.can_manage).toBe(true);
    expect(payload.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        template_key: 'po_request',
        label: 'Purchase order request',
        subject_template: 'PO please: {quote_reference}',
        body_template: 'Hello {contact_name}',
      }),
      expect.objectContaining({
        template_key: 'customer_quote',
        subject_template: '{quote_name}',
      }),
    ]));
  });

  it('rejects unsupported placeholders before saving', async () => {
    const { PATCH } = await import('@/app/api/quotes/settings/email-templates/route');

    const response = await PATCH(new NextRequest('http://localhost/api/quotes/settings/email-templates', {
      method: 'PATCH',
      body: JSON.stringify({
        template_key: 'po_request',
        subject_template: 'PO {invoice_number}',
        body_template: 'Hello {contact_name}',
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('{invoice_number}');
    expect(mockUpsertTemplate).not.toHaveBeenCalled();
  });

  it('saves valid template wording', async () => {
    const { PATCH } = await import('@/app/api/quotes/settings/email-templates/route');

    const response = await PATCH(new NextRequest('http://localhost/api/quotes/settings/email-templates', {
      method: 'PATCH',
      body: JSON.stringify({
        template_key: 'po_request',
        subject_template: 'PO request: {quote_name}',
        body_template: 'Hello {contact_name}',
      }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(mockUpsertTemplate).toHaveBeenCalledWith({
      template_key: 'po_request',
      subject_template: 'PO request: {quote_name}',
      body_template: 'Hello {contact_name}',
      updated_by: 'admin-1',
    });
  });
});
