import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { POST } from '@/app/api/customers/[id]/sites/route';

const { mockCreateClient, mockRequireSensitiveModuleAccess } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRequireSensitiveModuleAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockRequireSensitiveModuleAccess,
}));

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function createSupabase(options?: {
  user?: { id: string } | null;
  authError?: { message: string } | null;
  customer?: { id: string } | null;
  customerError?: { code?: string; message: string } | null;
  insertResult?: { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
}) {
  const insert = vi.fn((payload: Record<string, unknown>) => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue(options?.insertResult || {
        data: { id: 'site-new', ...payload, created_at: '2026-10-28T23:00:00.000Z' },
        error: null,
      }),
    })),
  }));
  const update = vi.fn();
  const deleteSite = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options && 'customer' in options ? options.customer : { id: CUSTOMER_ID },
    error: options?.customerError || null,
  });
  const from = vi.fn((table: string) => {
    if (table === 'customers') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      };
    }
    if (table === 'customer_sites') {
      return { insert, update, delete: deleteSite };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options && 'user' in options ? options.user : { id: USER_ID } },
        error: options?.authError || null,
      }),
    },
    from,
  });

  return { from, insert, update, deleteSite };
}

function postSite(body: unknown, id = CUSTOMER_ID) {
  return POST(
    new NextRequest(`http://localhost/api/customers/${id}/sites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe('POST /api/customers/[id]/sites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSensitiveModuleAccess.mockResolvedValue(null);
  });

  it('returns 401 before the customers PIN gate when the user is unauthenticated', async () => {
    const supabase = createSupabase({ user: null, authError: { message: 'missing session' } });

    const response = await postSite({ sites: [{ site_name: 'North depot', address_line_1: '10 North Road' }] });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(mockRequireSensitiveModuleAccess).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns the customers PIN response without writing a site', async () => {
    const supabase = createSupabase();
    mockRequireSensitiveModuleAccess.mockResolvedValue(
      NextResponse.json(
        { error: 'Sensitive access PIN required for protected modules.', code: 'SENSITIVE_PIN_REQUIRED' },
        { status: 428 }
      )
    );

    const response = await postSite({ sites: [{ site_name: 'North depot', address_line_1: '10 North Road' }] });
    const payload = await response.json();

    expect(response.status).toBe(428);
    expect(payload.code).toBe('SENSITIVE_PIN_REQUIRED');
    expect(mockRequireSensitiveModuleAccess).toHaveBeenCalledWith('customers');
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it('rejects an invalid customer id and incomplete or multi-site payloads', async () => {
    const invalidId = createSupabase();
    const invalidIdResponse = await postSite(
      { sites: [{ site_name: 'North depot', address_line_1: '10 North Road' }] },
      'not-a-uuid'
    );
    expect(invalidIdResponse.status).toBe(400);
    expect(invalidId.from).not.toHaveBeenCalled();

    const missingName = createSupabase();
    const missingNameResponse = await postSite({
      sites: [{ site_name: '   ', address_line_1: '10 North Road' }],
    });
    const missingNamePayload = await missingNameResponse.json();
    expect(missingNameResponse.status).toBe(400);
    expect(missingNamePayload.field_errors['sites.0.site_name']).toBe('Enter a site name.');
    expect(missingName.insert).not.toHaveBeenCalled();

    const missingAddress = createSupabase();
    const missingAddressResponse = await postSite({
      sites: [{ site_name: 'North depot' }],
    });
    const missingAddressPayload = await missingAddressResponse.json();
    expect(missingAddressResponse.status).toBe(400);
    expect(missingAddressPayload.field_errors['sites.0.address_line_1']).toBe('Enter at least one address field.');
    expect(missingAddress.insert).not.toHaveBeenCalled();

    const multipleSites = createSupabase();
    const multipleSitesResponse = await postSite({
      sites: [
        { site_name: 'North depot', address_line_1: '10 North Road' },
        { site_name: 'South depot', city: 'Leeds' },
      ],
    });
    expect(multipleSitesResponse.status).toBe(400);
    await expect(multipleSitesResponse.json()).resolves.toEqual(expect.objectContaining({
      error: 'Add one site at a time.',
    }));
    expect(multipleSites.insert).not.toHaveBeenCalled();
    expect(multipleSites.update).not.toHaveBeenCalled();
    expect(multipleSites.deleteSite).not.toHaveBeenCalled();
  });

  it('returns 404 when the customer is not visible and 403 when insert is denied', async () => {
    const missingCustomer = createSupabase({ customer: null });
    const missingResponse = await postSite({
      sites: [{ site_name: 'North depot', address_line_1: '10 North Road' }],
    });
    expect(missingResponse.status).toBe(404);
    expect(missingCustomer.insert).not.toHaveBeenCalled();

    const denied = createSupabase({
      insertResult: {
        data: null,
        error: { code: '42501', message: 'new row violates row-level security policy' },
      },
    });
    const deniedResponse = await postSite({
      sites: [{ site_name: 'North depot', address_line_1: '10 North Road' }],
    });
    const deniedPayload = await deniedResponse.json();
    expect(deniedResponse.status).toBe(403);
    expect(deniedPayload.error).toBe('You do not have permission to add a site for this customer.');
    expect(denied.insert).toHaveBeenCalledTimes(1);
    expect(denied.update).not.toHaveBeenCalled();
    expect(denied.deleteSite).not.toHaveBeenCalled();

    const permissionDenied = createSupabase({
      insertResult: {
        data: null,
        error: { message: 'permission denied for table customer_sites' },
      },
    });
    const permissionResponse = await postSite({
      sites: [{ site_name: 'North depot', address_line_1: '10 North Road' }],
    });
    expect(permissionResponse.status).toBe(403);
    expect(permissionDenied.insert).toHaveBeenCalledTimes(1);
    expect(permissionDenied.update).not.toHaveBeenCalled();
  });

  it('inserts one active non-default site and ignores caller identity fields', async () => {
    const supabase = createSupabase();

    const response = await postSite({
      id: 'ignored-customer-body-id',
      customer_id: '33333333-3333-4333-8333-333333333333',
      created_by: '44444444-4444-4444-8444-444444444444',
      sites: [{
        id: '55555555-5555-4555-8555-555555555555',
        customer_id: '66666666-6666-4666-8666-666666666666',
        created_by: '77777777-7777-4777-8777-777777777777',
        site_name: '  North depot  ',
        address_line_1: ' 10 North Road ',
        address_line_2: '',
        notes: '  Gate code ',
        is_active: false,
        is_default: true,
      }],
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(supabase.insert).toHaveBeenCalledTimes(1);
    expect(supabase.insert).toHaveBeenCalledWith({
      customer_id: CUSTOMER_ID,
      site_name: 'North depot',
      address_line_1: '10 North Road',
      address_line_2: null,
      city: null,
      county: null,
      postcode: null,
      is_active: true,
      is_default: false,
      notes: 'Gate code',
      created_by: USER_ID,
      updated_by: USER_ID,
    });
    expect(supabase.update).not.toHaveBeenCalled();
    expect(supabase.deleteSite).not.toHaveBeenCalled();
    expect(payload.site).toEqual(expect.objectContaining({
      id: 'site-new',
      customer_id: CUSTOMER_ID,
      site_name: 'North depot',
      is_active: true,
      is_default: false,
    }));
    expect(payload.site.id).not.toBe('55555555-5555-4555-8555-555555555555');
  });
});
