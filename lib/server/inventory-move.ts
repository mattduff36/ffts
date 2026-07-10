import { getInventoryCheckStatus, isInventoryMoveCheckBlocked } from '@/app/(dashboard)/inventory/utils';
import type { InventoryCheckStatus, InventoryLocation } from '@/app/(dashboard)/inventory/types';
import type { InventoryAdminClient } from './inventory-locations';

export type InventoryMoveScope = 'single' | 'bulk' | 'group' | 'claim';

export interface MoveInventoryItemsInput {
  itemIds?: string[];
  destinationLocationId: string;
  note?: string | null;
  scope?: InventoryMoveScope;
  groupId?: string | null;
  movedBy: string;
}

export interface MoveInventoryItemsResult {
  moved_count: number;
  movement_batch_id: string | null;
}

export interface CheckBlockedMoveItem {
  id: string;
  item_number: string;
  name: string;
  check_status: InventoryCheckStatus;
}

export class InventoryMoveError extends Error {
  status: number;
  code?: string;
  blockedItems?: CheckBlockedMoveItem[];

  constructor(message: string, status = 400, options?: { code?: string; blockedItems?: CheckBlockedMoveItem[] }) {
    super(message);
    this.name = 'InventoryMoveError';
    this.status = status;
    this.code = options?.code;
    this.blockedItems = options?.blockedItems;
  }
}

interface GroupMemberRow {
  item_id: string;
}

interface MovedItemRow {
  movement_batch_id: string;
}

interface MoveLocationRow {
  id: string;
  name: string;
  location_type: InventoryLocation['location_type'];
  is_active: boolean;
}

interface MoveItemRow {
  id: string;
  item_number: string;
  name: string;
  last_checked_at: string | null;
  check_interval_days: number | null;
  location: Pick<InventoryLocation, 'id' | 'name' | 'location_type'> | Array<Pick<InventoryLocation, 'id' | 'name' | 'location_type'>> | null;
}

function uniqueIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids || []).map((id) => id.trim()).filter(Boolean)));
}

function normalizeMoveItemLocation(
  location: MoveItemRow['location']
): Pick<InventoryLocation, 'id' | 'name' | 'location_type'> | null {
  if (Array.isArray(location)) return location[0] || null;
  return location || null;
}

export function toInventoryMoveErrorResponse(error: InventoryMoveError) {
  return {
    body: {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.blockedItems ? { blocked_items: error.blockedItems } : {}),
    },
    status: error.status,
  };
}

export async function moveInventoryItems(
  admin: InventoryAdminClient,
  input: MoveInventoryItemsInput
): Promise<MoveInventoryItemsResult> {
  const destinationLocationId = input.destinationLocationId.trim();
  const scope = input.scope || 'single';
  const groupId = input.groupId?.trim() || null;

  if (!destinationLocationId) {
    throw new InventoryMoveError('Destination location is required', 400);
  }

  let itemIds = uniqueIds(input.itemIds);

  if (scope === 'group') {
    if (!groupId) throw new InventoryMoveError('Group is required for a group move', 400);

    const { data: members, error: membersError } = await admin
      .from('inventory_item_group_members')
      .select('item_id')
      .eq('group_id', groupId);

    if (membersError) throw membersError;
    itemIds = ((members || []) as GroupMemberRow[]).map((member) => member.item_id);
  }

  if (itemIds.length === 0) {
    throw new InventoryMoveError('At least one inventory item is required', 400);
  }

  const [destinationResult, itemsResult] = await Promise.all([
    admin
      .from('inventory_locations')
      .select('id, name, location_type, is_active')
      .eq('id', destinationLocationId)
      .single(),
    admin
      .from('inventory_items')
      .select('id, item_number, name, last_checked_at, check_interval_days, location:inventory_locations(id, name, location_type)')
      .in('id', itemIds)
      .eq('status', 'active'),
  ]);

  if (destinationResult.error || !destinationResult.data?.is_active) {
    throw new InventoryMoveError('Destination location not found', 404);
  }
  if (itemsResult.error) throw itemsResult.error;

  const destinationLocation = destinationResult.data as MoveLocationRow;
  const moveItems = (itemsResult.data || []) as MoveItemRow[];

  if (moveItems.length !== itemIds.length) {
    throw new InventoryMoveError('One or more inventory items could not be found', 404);
  }

  const sameLocationCount = moveItems.filter((item) => normalizeMoveItemLocation(item.location)?.id === destinationLocationId).length;
  if (sameLocationCount === moveItems.length) {
    throw new InventoryMoveError(
      moveItems.length === 1 ? 'Item is already in this location' : 'All selected items are already in this location',
      400
    );
  }

  const blockedItems = moveItems.reduce<CheckBlockedMoveItem[]>((acc, item) => {
    const moveItem = {
      ...item,
      location: normalizeMoveItemLocation(item.location),
    };
    if (!isInventoryMoveCheckBlocked(moveItem, destinationLocation)) return acc;
    acc.push({
      id: item.id,
      item_number: item.item_number,
      name: item.name,
      check_status: getInventoryCheckStatus(moveItem),
    });
    return acc;
  }, []);

  if (blockedItems.length > 0) {
    throw new InventoryMoveError(
      blockedItems.length === 1
        ? 'Record an inventory check before moving this item.'
        : 'Record inventory checks before moving these items.',
      400,
      {
        code: 'INVENTORY_CHECK_REQUIRED',
        blockedItems,
      }
    );
  }

  const { data: movedItems, error: moveError } = await admin.rpc('inventory_move_items_with_batch', {
    p_item_ids: itemIds,
    p_destination_location_id: destinationLocationId,
    p_note: input.note?.trim() || null,
    p_moved_by: input.movedBy,
    p_move_scope: scope,
    p_group_id: scope === 'group' ? groupId : null,
  });

  if (moveError) {
    if (moveError.code === 'P0001' && moveError.message?.includes('No items were moved')) {
      throw new InventoryMoveError('No items were moved', 400);
    }
    throw moveError;
  }

  const movedCount = Array.isArray(movedItems) ? movedItems.length : 0;
  const movementBatchId = Array.isArray(movedItems)
    ? ((movedItems[0] as MovedItemRow | undefined)?.movement_batch_id || null)
    : null;

  if (movedCount === 0) throw new InventoryMoveError('No items were moved', 400);

  return {
    moved_count: movedCount,
    movement_batch_id: movementBatchId,
  };
}
