import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryAccess: vi.fn(),
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET } from '@/app/api/inventory/locations/route';

function buildLocation(id: string, name: string, locationType = 'site', sourceType = 'legacy_quote') {
  return {
    id,
    name,
    description: null,
    is_active: true,
    linked_van_id: null,
    linked_hgv_id: null,
    linked_plant_id: null,
    location_type: locationType,
    source_type: sourceType,
    source_id: null,
    external_reference: null,
    sync_status: sourceType === 'manual' ? 'manual' : 'synced',
    source_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

function buildRangeQuery<T>(pages: T[][]) {
  return {
    select() {
      return {
        eq() {
          return {
            order() {
              return {
                async range(offset: number) {
                  const pageIndex = Math.floor(offset / 1000);
                  return { data: pages[pageIndex] || [], error: null };
                },
              };
            },
            async range(offset: number) {
              const pageIndex = Math.floor(offset / 1000);
              return { data: pages[pageIndex] || [], error: null };
            },
          };
        },
      };
    },
  };
}

describe('inventory locations route', () => {
  it('paginates inventory locations beyond the Supabase 1000 row default', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-user',
      isManagerOrAdmin: true,
    });

    const legacyLocations = Array.from({ length: 1000 }, (_, index) => (
      buildLocation(`legacy-${index}`, `Legacy ${index}`)
    ));
    const normalLocations = [
      buildLocation('yard-location', 'Yard', 'yard', 'system'),
      buildLocation('van-location', 'Van - NU75 VGT', 'van', 'fleet'),
    ];
    const activeItemLocations = [
      { location_id: 'yard-location' },
      { location_id: 'van-location' },
    ];

    const admin = {
      from(table: string) {
        if (table === 'inventory_locations') {
          return buildRangeQuery([legacyLocations, normalLocations]);
        }
        if (table === 'inventory_items') {
          return buildRangeQuery([activeItemLocations]);
        }
        if (table === 'vans' || table === 'hgvs' || table === 'plant') {
          return { select: () => ({ data: [], error: null }) };
        }
        if (table === 'inventory_user_locations' || table === 'inventory_user_site_locations') {
          return { select: () => ({ data: [], error: null }) };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.locations).toHaveLength(1002);
    expect(payload.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'yard-location', item_count: 1 }),
      expect.objectContaining({ id: 'van-location', item_count: 1 }),
    ]));
  });
});
