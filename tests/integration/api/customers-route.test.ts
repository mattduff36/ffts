import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { GET, POST } from '@/app/api/customers/route';

const {
  mockCreateAdminClient,
  mockCreateClient,
  mockGetCurrentAuthenticatedProfile,
  mockGetPermissionMapForUser,
  mockGetEffectiveRole,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockCreateClient: vi.fn(),
  mockGetCurrentAuthenticatedProfile: vi.fn(),
  mockGetPermissionMapForUser: vi.fn(),
  mockGetEffectiveRole: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mockGetCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/server/team-permissions', () => ({
  getPermissionMapForUser: mockGetPermissionMapForUser,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockGetEffectiveRole,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

function createCustomerListQuery(rows: Array<Record<string, unknown>>) {
  const range = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order = vi.fn().mockReturnValue({ range });
  const select = vi.fn().mockReturnValue({ order });

  return { select, order, range };
}

describe('GET /api/customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the customer directory when the user has customers module access', async () => {
    mockGetCurrentAuthenticatedProfile.mockResolvedValue({
      profile: { id: 'user-1' },
    });
    mockGetEffectiveRole.mockResolvedValue({
      role_id: 'role-1',
      role_name: 'manager',
      role_class: 'manager',
      is_super_admin: false,
      is_actual_super_admin: false,
      is_viewing_as: false,
      team_id: 'team-1',
    });
    mockGetPermissionMapForUser.mockResolvedValue({
      customers: true,
    });

    const { select, range } = createCustomerListQuery([
      { id: 'customer-1', company_name: 'Acme Ltd' },
      { id: 'customer-2', company_name: 'Bravo Ltd' },
    ]);
    const contactsOrder = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'contact-1',
          customer_id: 'customer-1',
          name: 'Chris CC',
          email: 'chris@example.com',
          job_title: null,
          phone: null,
        },
      ],
      error: null,
    });
    const contactsIn = vi.fn().mockReturnValue({ order: contactsOrder });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select };
        }

        if (table === 'customer_contacts') {
          return {
            select: vi.fn(() => ({
              in: contactsIn,
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/customers?limit=10&offset=5'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetPermissionMapForUser).toHaveBeenCalledWith(
      'user-1',
      'role-1',
      expect.any(Object),
      'team-1',
      { includeUserOverrides: true }
    );
    expect(range).toHaveBeenCalledWith(5, 14);
    expect(payload.customers).toEqual([
      {
        id: 'customer-1',
        company_name: 'Acme Ltd',
        secondary_contacts: [
          {
            id: 'contact-1',
            customer_id: 'customer-1',
            name: 'Chris CC',
            email: 'chris@example.com',
            job_title: null,
            phone: null,
          },
        ],
      },
      { id: 'customer-2', company_name: 'Bravo Ltd', secondary_contacts: [] },
    ]);
  });

  it('returns 403 when the user does not have customers module access', async () => {
    mockGetCurrentAuthenticatedProfile.mockResolvedValue({
      profile: { id: 'user-2' },
    });
    mockGetEffectiveRole.mockResolvedValue({
      role_id: 'role-2',
      role_name: 'employee',
      role_class: 'employee',
      is_super_admin: false,
      is_actual_super_admin: false,
      is_viewing_as: false,
      team_id: 'team-2',
    });
    mockGetPermissionMapForUser.mockResolvedValue({
      customers: false,
    });
    mockCreateAdminClient.mockReturnValue({} as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/customers'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: 'Forbidden' });
  });
});

describe('POST /api/customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns field errors for invalid secondary contact email addresses', async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);

    const response = await POST(new NextRequest('http://localhost/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        company_name: 'Acme Ltd',
        secondary_contacts: [
          {
            name: 'Chris CC',
            email: 'not-an-email',
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.field_errors).toEqual({
      'secondary_contacts.0.email': 'Enter a valid secondary contact email.',
    });
  });
});
