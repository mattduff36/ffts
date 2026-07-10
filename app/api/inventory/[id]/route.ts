import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeInventoryItemNumber, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { InventoryMoveError, moveInventoryItems, toInventoryMoveErrorResponse } from '@/lib/server/inventory-move';
import { isInventoryRetireReason, type InventoryCategory, type InventoryRetireReason, type InventoryStatus } from '@/app/(dashboard)/inventory/types';

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
  retire_reason?: InventoryRetireReason | null;
}

interface InventoryItemRow {
  minor_plant_detail?: unknown;
  [key: string]: unknown;
}

function cleanOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function normalizeMinorPlantDetailRelation(item: InventoryItemRow): InventoryItemRow {
  const relation = item.minor_plant_detail;
  return {
    ...item,
    minor_plant_detail: Array.isArray(relation) ? relation[0] ?? null : relation ?? null,
  };
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as InventoryItemUpdateBody;
    const admin = createAdminClient();
    let requestedLocationId: string | null = null;
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
    if (body.category !== undefined) {
      const category = body.category.trim();
      if (!category) {
        return NextResponse.json({ error: 'Category is required' }, { status: 400 });
      }
      update.category = category;
    }
    if (body.location_id !== undefined) {
      const locationId = body.location_id?.trim() || '';
      if (!locationId) {
        return NextResponse.json({ error: 'Location is required' }, { status: 400 });
      }

      requestedLocationId = locationId;
    }
    if (body.last_checked_at !== undefined) update.last_checked_at = cleanOptionalDate(body.last_checked_at);
    if (body.check_interval_days !== undefined) {
      update.check_interval_days = body.check_interval_days || null;
    }
    if (body.status !== undefined) {
      if (body.status === 'active') {
        update.status = 'active';
        update.retired_at = null;
        update.retire_reason = null;
        update.retired_by = null;
      } else if (body.status === 'retired') {
        if (!isInventoryRetireReason(body.retire_reason)) {
          return NextResponse.json({ error: 'Valid retirement reason is required' }, { status: 400 });
        }
        update.status = 'retired';
        update.retired_at = new Date().toISOString();
        update.retire_reason = body.retire_reason;
        update.retired_by = access.userId;
      }
    }

    const { data: updatedData, error } = await admin
      .from('inventory_items')
      .update(update)
      .eq('id', id)
      .select(`
        *,
        location:inventory_locations(*),
        minor_plant_detail:inventory_minor_plant_details(*)
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

    let responseItem = updatedData;
    if (requestedLocationId && updatedData.location_id !== requestedLocationId) {
      await moveInventoryItems(admin, {
        itemIds: [id],
        destinationLocationId: requestedLocationId,
        note: 'Moved from inventory item edit',
        scope: 'single',
        movedBy: access.userId,
      });

      const { data: movedData, error: movedLoadError } = await admin
        .from('inventory_items')
        .select(`
          *,
          location:inventory_locations(*),
          minor_plant_detail:inventory_minor_plant_details(*)
        `)
        .eq('id', id)
        .single();

      if (movedLoadError) throw movedLoadError;
      responseItem = movedData;
    }

    return NextResponse.json({ item: normalizeMinorPlantDetailRelation(responseItem as InventoryItemRow) });
  } catch (error) {
    if (error instanceof InventoryMoveError) {
      const response = toInventoryMoveErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    console.error('Error updating inventory item:', error);
    return NextResponse.json({ error: 'Failed to update inventory item' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { retire_reason?: unknown };
    if (!isInventoryRetireReason(body.retire_reason)) {
      return NextResponse.json({ error: 'Valid retirement reason is required' }, { status: 400 });
    }

    const { error } = await createAdminClient()
      .from('inventory_items')
      .update({
        status: 'retired',
        retired_at: new Date().toISOString(),
        retire_reason: body.retire_reason,
        retired_by: access.userId,
        updated_by: access.userId,
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error retiring inventory item:', error);
    return NextResponse.json({ error: 'Failed to retire inventory item' }, { status: 500 });
  }
}
