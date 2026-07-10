import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { loadCategoryItemCounts } from '@/lib/server/inventory-category-counts';

function createCountAdmin(counts: Record<string, number>, errorSlug?: string) {
  const queries: Array<{
    table: string;
    columns: string;
    options: { count?: string; head?: boolean } | undefined;
    eqColumn: string;
    eqValue: string;
  }> = [];

  const admin = {
    from(table: string) {
      return {
        select(columns: string, options?: { count?: string; head?: boolean }) {
          return {
            async eq(eqColumn: string, eqValue: string) {
              queries.push({ table, columns, options, eqColumn, eqValue });
              if (eqValue === errorSlug) return { count: null, error: new Error('count failed') };
              return { count: counts[eqValue] ?? 0, error: null };
            },
          };
        },
      };
    },
  };

  return {
    admin: admin as unknown as Parameters<typeof loadCategoryItemCounts>[0],
    queries,
  };
}

describe('inventory category route helpers', () => {
  it('counts category items with exact head queries so counts can exceed row return caps', async () => {
    const { admin, queries } = createCountAdmin({ cones: 1001, signs: 42 });

    const counts = await loadCategoryItemCounts(admin, [
      { slug: 'cones' },
      { slug: 'signs' },
    ]);

    expect(counts).toEqual({ cones: 1001, signs: 42 });
    expect(queries).toEqual([
      {
        table: 'inventory_items',
        columns: 'id',
        options: { count: 'exact', head: true },
        eqColumn: 'category',
        eqValue: 'cones',
      },
      {
        table: 'inventory_items',
        columns: 'id',
        options: { count: 'exact', head: true },
        eqColumn: 'category',
        eqValue: 'signs',
      },
    ]);
  });

  it('throws when a category count query fails', async () => {
    const { admin } = createCountAdmin({}, 'cones');

    await expect(loadCategoryItemCounts(admin, [{ slug: 'cones' }])).rejects.toThrow('count failed');
  });
});
