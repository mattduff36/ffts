import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import {
  InventoryMoveError,
  moveInventoryItems,
  toInventoryMoveErrorResponse,
  type InventoryMoveScope,
} from '@/lib/server/inventory-move';

interface MoveInventoryItemsBody {
  item_ids?: string[];
  location_id?: string;
  note?: string;
  scope?: InventoryMoveScope;
  group_id?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as MoveInventoryItemsBody;
    const destinationLocationId = body.location_id?.trim();
    const result = await moveInventoryItems(createAdminClient(), {
      itemIds: body.item_ids,
      destinationLocationId: destinationLocationId || '',
      note: body.note,
      scope: body.scope,
      groupId: body.group_id,
      movedBy: access.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InventoryMoveError) {
      const response = toInventoryMoveErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    console.error('Error moving inventory items:', error);
    return NextResponse.json({ error: 'Failed to move inventory items' }, { status: 500 });
  }
}
