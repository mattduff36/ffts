import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';

type InventoryMoveScope = 'single' | 'bulk' | 'group' | 'claim';

interface MoveInventoryItemsBody {
  item_ids?: string[];
  location_id?: string;
  note?: string;
  scope?: InventoryMoveScope;
  group_id?: string | null;
}

interface GroupMemberRow {
  item_id: string;
}

interface MovedItemRow {
  movement_batch_id: string;
}

function uniqueIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids || []).map((id) => id.trim()).filter(Boolean)));
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as MoveInventoryItemsBody;
    const destinationLocationId = body.location_id?.trim();
    const scope = body.scope || 'single';
    const groupId = body.group_id?.trim() || null;

    if (!destinationLocationId) {
      return NextResponse.json({ error: 'Destination location is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    let itemIds = uniqueIds(body.item_ids);

    if (scope === 'group') {
      if (!groupId) {
        return NextResponse.json({ error: 'Group is required for a group move' }, { status: 400 });
      }

      const { data: members, error: membersError } = await admin
        .from('inventory_item_group_members')
        .select('item_id')
        .eq('group_id', groupId);

      if (membersError) throw membersError;
      itemIds = ((members || []) as GroupMemberRow[]).map((member) => member.item_id);
    }

    if (itemIds.length === 0) {
      return NextResponse.json({ error: 'At least one inventory item is required' }, { status: 400 });
    }

    const { data: movedItems, error: moveError } = await admin.rpc('inventory_move_items_with_batch', {
      p_item_ids: itemIds,
      p_destination_location_id: destinationLocationId,
      p_note: body.note?.trim() || null,
      p_moved_by: access.userId,
      p_move_scope: scope,
      p_group_id: scope === 'group' ? groupId : null,
    });

    if (moveError) {
      if (moveError.code === 'P0001' && moveError.message?.includes('No items were moved')) {
        return NextResponse.json({ error: 'No items were moved' }, { status: 400 });
      }
      throw moveError;
    }

    const movedCount = Array.isArray(movedItems) ? movedItems.length : 0;
    const movementBatchId = Array.isArray(movedItems)
      ? ((movedItems[0] as MovedItemRow | undefined)?.movement_batch_id || null)
      : null;

    if (movedCount === 0) {
      return NextResponse.json({ error: 'No items were moved' }, { status: 400 });
    }

    return NextResponse.json({
      moved_count: movedCount,
      movement_batch_id: movementBatchId,
    });
  } catch (error) {
    console.error('Error moving inventory items:', error);
    return NextResponse.json({ error: 'Failed to move inventory items' }, { status: 500 });
  }
}
