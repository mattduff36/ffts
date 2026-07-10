import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/quotes/metadata/route';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFilterHiddenSystemTestAccountProfiles,
  mockListQuoteManagerOptions,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFilterHiddenSystemTestAccountProfiles: vi.fn(),
  mockListQuoteManagerOptions: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/system-test-accounts', () => ({
  filterHiddenSystemTestAccountProfiles: mockFilterHiddenSystemTestAccountProfiles,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  listQuoteManagerOptions: mockListQuoteManagerOptions,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

function createOrderedQuery(rows: Array<Record<string, unknown>>) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ order });

  return { select, order };
}

describe('GET /api/quotes/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    mockListQuoteManagerOptions.mockResolvedValue([]);
    mockFilterHiddenSystemTestAccountProfiles.mockImplementation(async (_admin, profiles) => profiles);
  });

  it('omits customers from metadata unless explicitly requested', async () => {
    const profilesQuery = createOrderedQuery([]);
    const from = vi.fn((table: string) => {
      if (table === 'profiles') return { select: profilesQuery.select };
      throw new Error(`Unexpected table: ${table}`);
    });
    mockCreateAdminClient.mockReturnValue({ from } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/quotes/metadata'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect('customers' in payload).toBe(false);
    expect(from).not.toHaveBeenCalledWith('customers');
  });

  it('includes customers when requested by the quote form', async () => {
    const customer = {
      id: 'customer-1',
      company_name: 'Acme Ltd',
      secondary_contacts: [],
    };
    const profilesQuery = createOrderedQuery([]);
    const customersQuery = createOrderedQuery([customer]);
    const from = vi.fn((table: string) => {
      if (table === 'profiles') return { select: profilesQuery.select };
      if (table === 'customers') return { select: customersQuery.select };
      throw new Error(`Unexpected table: ${table}`);
    });
    mockCreateAdminClient.mockReturnValue({ from } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/quotes/metadata?include_customers=true'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(customersQuery.select).toHaveBeenCalledWith(expect.stringContaining('secondary_contacts:customer_contacts(*)'));
    expect(payload.customers).toEqual([customer]);
  });
});
