import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockIsEffectiveRoleAdminOrSuper,
  mockListQuoteManagerOptions,
  mockListQuoteUserNotificationRecipientOptions,
  mockFilterHiddenSystemTestAccountProfiles,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockIsEffectiveRoleAdminOrSuper: vi.fn(),
  mockListQuoteManagerOptions: vi.fn(),
  mockListQuoteUserNotificationRecipientOptions: vi.fn(),
  mockFilterHiddenSystemTestAccountProfiles: vi.fn(),
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

vi.mock('@/lib/server/system-test-accounts', () => ({
  filterHiddenSystemTestAccountProfiles: mockFilterHiddenSystemTestAccountProfiles,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  listQuoteManagerOptions: mockListQuoteManagerOptions,
  listQuoteUserNotificationRecipientOptions: mockListQuoteUserNotificationRecipientOptions,
}));

describe('/api/quotes/settings/manager-series', () => {
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
    mockIsEffectiveRoleAdminOrSuper.mockResolvedValue(true);
    mockListQuoteManagerOptions.mockResolvedValue([]);
    mockListQuoteUserNotificationRecipientOptions.mockResolvedValue([
      { id: 'manager-1', full_name: 'Manager One', employee_id: 'M1', team_id: 'ops' },
    ]);
    mockFilterHiddenSystemTestAccountProfiles.mockResolvedValue([
      { id: 'approver-1', full_name: 'Approver One', employee_id: 'A1' },
    ]);
  });

  it('saves manager defaults and returns refreshed settings', async () => {
    const { POST } = await import('@/app/api/quotes/settings/manager-series/route');
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const quoteUpdate = vi.fn(() => {
      const query = {
        eq: vi.fn(() => query),
        is: vi.fn().mockResolvedValue({ error: null }),
        then: vi.fn((resolve: (value: { error: null }) => void) => resolve({ error: null })),
      };
      return query;
    });
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: 'manager-login@example.com' } },
            error: null,
          }),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'quote_manager_series') {
          return {
            upsert,
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'quotes') return { update: quoteUpdate };
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: [{ id: 'approver-1', full_name: 'Approver One', employee_id: 'A1' }],
                error: null,
              }),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    mockCreateAdminClient.mockReturnValue(admin);
    mockListQuoteManagerOptions.mockResolvedValue([
      {
        profile_id: 'manager-1',
        initials: 'MO',
        next_number: 20012,
        number_start: 20000,
        signoff_name: 'Manager One',
        signoff_title: 'Contracts Manager',
        manager_email: 'manager@example.com',
        approver_profile_id: 'approver-1',
        is_active: true,
      },
    ]);

    const response = await POST(new NextRequest('http://localhost/api/quotes/settings/manager-series', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: 'manager-1',
        initials: 'mo',
        next_number: 20012,
        number_start: 20000,
        signoff_name: 'Manager One',
        signoff_title: 'Contracts Manager',
        manager_email: 'manager@example.com',
        approver_profile_id: 'approver-1',
        is_active: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      profile_id: 'manager-1',
      initials: 'MO',
      next_number: 20012,
      manager_email: 'manager-login@example.com',
    }), { onConflict: 'profile_id' });
    expect(payload.manager_options).toHaveLength(1);
  });

  it('rejects short initials and numbers below the five-digit owner ranges', async () => {
    const { POST } = await import('@/app/api/quotes/settings/manager-series/route');
    mockCreateAdminClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn(),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'quote_manager_series') {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const response = await POST(new NextRequest('http://localhost/api/quotes/settings/manager-series', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: 'manager-1',
        initials: 'J',
        next_number: 27,
        number_start: 1,
        is_active: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.field_errors).toMatchObject({
      initials: expect.stringMatching(/two letters/i),
      number_start: expect.stringMatching(/10000/),
      next_number: expect.stringMatching(/10000/),
    });
  });

  it('rejects overflow numbers and overlapping 10000-blocks', async () => {
    const { POST } = await import('@/app/api/quotes/settings/manager-series/route');
    mockCreateAdminClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn(),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'quote_manager_series') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{
                profile_id: 'joe-1',
                initials: 'JC',
                number_start: 10000,
                next_number: 10027,
              }],
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const overflow = await POST(new NextRequest('http://localhost/api/quotes/settings/manager-series', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: 'manager-1',
        initials: 'MD',
        next_number: 100000,
        number_start: 100000,
        is_active: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(overflow.status).toBe(400);
    expect(await overflow.json()).toMatchObject({
      field_errors: {
        number_start: expect.stringMatching(/99999/),
        next_number: expect.stringMatching(/99999/),
      },
    });

    const overlap = await POST(new NextRequest('http://localhost/api/quotes/settings/manager-series', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: 'manager-1',
        initials: 'MD',
        next_number: 10001,
        number_start: 10000,
        is_active: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(overlap.status).toBe(400);
    expect(await overlap.json()).toMatchObject({
      field_errors: {
        number_start: expect.stringMatching(/already used by JC/),
      },
    });
  });
});
