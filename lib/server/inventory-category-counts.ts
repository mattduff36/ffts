import { createAdminClient } from '@/lib/supabase/admin';

interface InventoryCategoryForCount {
  slug: string;
}

export async function loadCategoryItemCounts(
  admin: ReturnType<typeof createAdminClient>,
  categories: InventoryCategoryForCount[]
) {
  const entries = await Promise.all(
    categories.map(async (category) => {
      const { count, error } = await admin
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('category', category.slug);

      if (error) throw error;
      return [category.slug, count || 0] as const;
    })
  );

  return Object.fromEntries(entries);
}
