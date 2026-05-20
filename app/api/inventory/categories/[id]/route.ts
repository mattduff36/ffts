import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UpdateInventoryCategoryBody {
  name?: string;
  description?: string | null;
  sort_order?: number | null;
  is_active?: boolean;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateInventoryCategoryBody;
    const update: Record<string, unknown> = {
      updated_by: access.userId,
    };

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
      }
      update.name = name;
    }
    if (body.description !== undefined) update.description = body.description?.trim() || null;
    if (body.sort_order !== undefined) update.sort_order = Number.isFinite(body.sort_order) ? body.sort_order : 0;
    if (body.is_active !== undefined) update.is_active = body.is_active;

    const { data, error } = await createAdminClient()
      .from('inventory_item_categories')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory category not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ category: data });
  } catch (error) {
    console.error('Error updating inventory category:', error);
    return NextResponse.json({ error: 'Failed to update inventory category' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const admin = createAdminClient();
    const { data: category, error: categoryError } = await admin
      .from('inventory_item_categories')
      .select('id, slug')
      .eq('id', id)
      .single();

    if (categoryError) {
      if (categoryError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory category not found' }, { status: 404 });
      }
      throw categoryError;
    }

    const { count, error: countError } = await admin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('category', category.slug);

    if (countError) throw countError;
    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: 'This category is used by one or more inventory items and cannot be deleted' },
        { status: 400 }
      );
    }

    const { error } = await admin
      .from('inventory_item_categories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting inventory category:', error);
    return NextResponse.json({ error: 'Failed to delete inventory category' }, { status: 500 });
  }
}
