import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  formatCustomerSiteAddress,
  normalizeAddressSnapshot,
  normalizeCustomerSitesPayload,
  replaceCustomerSites,
  resolveCustomerSiteSelection,
} from '@/lib/server/customer-sites';
import type { Database } from '@/types/database';

describe('customer site normalization', () => {
  it('normalizes structured addresses and prevents inactive defaults', () => {
    const result = normalizeCustomerSitesPayload({
      sites: [
        {
          id: 'site-1',
          site_name: '  Main site  ',
          address_line_1: '  1 Sample Lane ',
          city: ' Nottingham ',
          postcode: ' NG1 1AA ',
          is_active: false,
          is_default: true,
        },
      ],
    });

    expect(result.fieldErrors).toEqual({});
    expect(result.sites[0]).toEqual(expect.objectContaining({
      site_name: 'Main site',
      address_line_1: '1 Sample Lane',
      city: 'Nottingham',
      postcode: 'NG1 1AA',
      is_active: false,
      is_default: false,
    }));
  });

  it('formats and normalizes the same immutable address snapshot', () => {
    const address = formatCustomerSiteAddress({
      address_line_1: '1 Sample Lane',
      address_line_2: null,
      city: 'Nottingham',
      county: 'Nottinghamshire',
      postcode: 'NG1 1AA',
    });

    expect(address).toBe('1 Sample Lane\nNottingham, Nottinghamshire\nNG1 1AA');
    expect(normalizeAddressSnapshot(`  ${address.replaceAll('\n', '  ')} `))
      .toBe('1 sample lane nottingham, nottinghamshire ng1 1aa');
  });
});

describe('customer site persistence boundaries', () => {
  it('rejects an update using a site owned by another customer', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'site-owned-by-customer-1' }],
            error: null,
          }),
        })),
      })),
    } as unknown as SupabaseClient<Database>;

    await expect(replaceCustomerSites(
      supabase,
      'customer-1',
      [{
        id: 'site-owned-by-customer-2',
        site_name: 'Other site',
        address_line_1: '2 Other Road',
        address_line_2: null,
        city: null,
        county: null,
        postcode: null,
        is_active: true,
        is_default: false,
        notes: null,
      }],
      'user-1'
    )).rejects.toThrow('does not belong to this customer');
  });

  it('validates site ownership while preserving an edited snapshot', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'site-1',
        customer_id: 'customer-1',
        address_line_1: '1 Saved Lane',
        address_line_2: null,
        city: 'Nottingham',
        county: null,
        postcode: 'NG1 1AA',
        is_active: true,
      },
      error: null,
    });
    const secondEq = vi.fn(() => ({ maybeSingle }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: firstEq })),
      })),
    } as unknown as SupabaseClient<Database>;

    const result = await resolveCustomerSiteSelection(supabase, {
      customerId: 'customer-1',
      customerSiteId: 'site-1',
      siteAddress: 'Gate 2\n1 Saved Lane',
    });

    expect(firstEq).toHaveBeenCalledWith('id', 'site-1');
    expect(secondEq).toHaveBeenCalledWith('customer_id', 'customer-1');
    expect(result).toEqual({
      customerSiteId: 'site-1',
      siteAddress: 'Gate 2\n1 Saved Lane',
      fieldErrors: {},
    });
  });
});
