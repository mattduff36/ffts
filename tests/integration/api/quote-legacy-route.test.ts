import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockRequireSensitiveModuleAccess,
  mockGetEffectiveRole,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockRequireSensitiveModuleAccess: vi.fn(),
  mockGetEffectiveRole: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockRequireSensitiveModuleAccess,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockGetEffectiveRole,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/quotes/legacy', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/quotes/legacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'admin@example.com' } },
          error: null,
        }),
      },
    });
    mockRequireSensitiveModuleAccess.mockResolvedValue(null);
    mockGetEffectiveRole.mockResolvedValue({
      role_name: 'admin',
      role_class: 'admin',
      is_super_admin: false,
      is_actual_super_admin: false,
    });
  });

  it('rejects non-admin legacy quote edits', async () => {
    mockGetEffectiveRole.mockResolvedValue({
      role_name: 'employee',
      role_class: 'employee',
      is_super_admin: false,
      is_actual_super_admin: false,
    });

    const { PATCH } = await import('@/app/api/quotes/legacy/route');
    const response = await PATCH(buildRequest({ id: 'legacy-1', customer_name: 'Blocked' }));

    expect(response.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('updates editable legacy quote fields for admins', async () => {
    const updatedLegacyQuote = {
      id: 'legacy-1',
      source_row: 10,
      quote_reference: '4323-GH',
      customer_name: 'Updated Customer',
      title: 'Updated details',
      quote_date: '2026-01-31',
      quote_manager_name: 'George Healey',
      quote_manager_initials: 'GH',
      quote_value_text: '£1,250.00',
      quote_value_amount: 1250,
      comments: 'Updated comment',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: updatedLegacyQuote, error: null });
    const select = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    mockCreateAdminClient.mockReturnValue({ from });

    const { PATCH } = await import('@/app/api/quotes/legacy/route');
    const response = await PATCH(buildRequest({
      id: 'legacy-1',
      quote_reference: ' 4323-gh ',
      customer_name: ' Updated Customer ',
      title: ' Updated details ',
      quote_date: '2026-01-31',
      quote_manager_name: 'George Healey',
      quote_value_text: '£1,250.00',
      comments: ' Updated comment ',
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith('legacy_quotes');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      quote_reference: '4323-GH',
      quote_number: 4323,
      quote_suffix: 'GH',
      customer_name: 'Updated Customer',
      title: 'Updated details',
      quote_date: '2026-01-31',
      quote_manager_name: 'George Healey',
      quote_manager_initials: 'GH',
      quote_value_text: '£1,250.00',
      quote_value_amount: 1250,
      comments: 'Updated comment',
    }));
    expect(eq).toHaveBeenCalledWith('id', 'legacy-1');
    expect(payload.legacy_quote).toEqual(updatedLegacyQuote);
  });
});
