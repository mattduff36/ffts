import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { loadCategoryItemCounts } from '@/lib/server/inventory-category-counts';

interface CreateInventoryCategoryBody {
  name?: string;
  slug?: string;
  description?: string | null;
  sort_order?: number | null;
  is_active?: boolean;
}

function cleanSlug(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(value);
}

export async function GET() {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const { data: categories, error: categoriesError } = await admin
      .from('inventory_item_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (categoriesError) throw categoriesError;
    const itemCounts = await loadCategoryItemCounts(admin, categories || []);

    return NextResponse.json({
      categories: (categories || []).map((category) => ({
        ...category,
        item_count: itemCounts[category.slug] || 0,
      })),
    });
  } catch (error) {
    console.error('Error fetching inventory categories:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory categories' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as CreateInventoryCategoryBody;
    const name = body.name?.trim();
    const slug = cleanSlug(body.slug || body.name);

    if (!name) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json({ error: 'Category slug must use lowercase letters, numbers, and underscores' }, { status: 400 });
    }

    const { data, error } = await createAdminClient()
      .from('inventory_item_categories')
      .insert({
        name,
        slug,
        description: body.description?.trim() || null,
        sort_order: Number.isFinite(body.sort_order) ? body.sort_order : 0,
        is_active: body.is_active !== false,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An inventory category with this slug already exists' }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ category: { ...data, item_count: 0 } }, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory category:', error);
    return NextResponse.json({ error: 'Failed to create inventory category' }, { status: 500 });
  }
}
