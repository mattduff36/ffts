import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface MoveInventoryItemBody {
  location_id?: string;
  note?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as MoveInventoryItemBody;
    const destinationLocationId = body.location_id?.trim();

    if (!destinationLocationId) {
      return NextResponse.json({ error: 'Destination location is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const [{ data: item, error: itemError }, { data: location, error: locationError }] = await Promise.all([
      admin.from('inventory_items').select('id, location_id').eq('id', id).single(),
      admin.from('inventory_locations').select('id, is_active').eq('id', destinationLocationId).single(),
    ]);

    if (itemError) {
      if (itemError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw itemError;
    }
    if (locationError || !location?.is_active) {
      return NextResponse.json({ error: 'Destination location not found' }, { status: 404 });
    }

    if (item.location_id === destinationLocationId) {
      return NextResponse.json({ error: 'Item is already in this location' }, { status: 400 });
    }

    const { data: batch, error: batchError } = await admin
      .from('inventory_item_movement_batches')
      .insert({
        move_scope: 'single',
        destination_location_id: destinationLocationId,
        note: body.note?.trim() || null,
        moved_by: access.userId,
      })
      .select('id')
      .single();

    if (batchError || !batch?.id) {
      throw batchError || new Error('Failed to create inventory movement batch');
    }

    const { data: updatedItem, error: updateError } = await admin
      .from('inventory_items')
      .update({
        location_id: destinationLocationId,
        updated_by: access.userId,
      })
      .eq('id', id)
      .select(`
        *,
        location:inventory_locations(*)
      `)
      .single();

    if (updateError) throw updateError;

    const { error: movementError } = await admin
      .from('inventory_item_movements')
      .insert({
        item_id: id,
        from_location_id: item.location_id,
        to_location_id: destinationLocationId,
        note: body.note?.trim() || null,
        moved_by: access.userId,
        movement_batch_id: batch.id,
      });

    if (movementError) throw movementError;

    return NextResponse.json({ item: updatedItem });
  } catch (error) {
    console.error('Error moving inventory item:', error);
    return NextResponse.json({ error: 'Failed to move inventory item' }, { status: 500 });
  }
}
