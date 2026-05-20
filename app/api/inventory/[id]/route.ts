import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeInventoryItemNumber, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import type { InventoryCategory, InventoryStatus } from '@/app/(dashboard)/inventory/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface InventoryItemUpdateBody {
  item_number?: string;
  name?: string;
  category?: InventoryCategory;
  location_id?: string;
  last_checked_at?: string | null;
  check_interval_days?: number | null;
  status?: InventoryStatus;
}

function cleanOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as InventoryItemUpdateBody;
    const update: Record<string, unknown> = {
      updated_by: access.userId,
    };

    if (body.item_number !== undefined) {
      const itemNumber = body.item_number.trim();
      if (!itemNumber) {
        return NextResponse.json({ error: 'Item number is required' }, { status: 400 });
      }
      update.item_number = itemNumber;
      update.item_number_normalized = normalizeInventoryItemNumber(itemNumber);
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: 'Name is required' }, { status: 400 });
      }
      update.name = name;
    }
    if (body.category !== undefined) update.category = body.category;
    if (body.location_id !== undefined) update.location_id = body.location_id?.trim() || null;
    if (body.last_checked_at !== undefined) update.last_checked_at = cleanOptionalDate(body.last_checked_at);
    if (body.check_interval_days !== undefined) {
      update.check_interval_days = body.check_interval_days || null;
    }
    if (body.status !== undefined) update.status = body.status;

    const { data, error } = await createAdminClient()
      .from('inventory_items')
      .update(update)
      .eq('id', id)
      .select(`
        *,
        location:inventory_locations(*)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An inventory item with this ID number already exists' }, { status: 400 });
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error('Error updating inventory item:', error);
    return NextResponse.json({ error: 'Failed to update inventory item' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const { error } = await createAdminClient()
      .from('inventory_items')
      .update({
        status: 'inactive',
        updated_by: access.userId,
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deactivating inventory item:', error);
    return NextResponse.json({ error: 'Failed to deactivate inventory item' }, { status: 500 });
  }
}
