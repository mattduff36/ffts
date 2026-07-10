import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeInventoryItemNumber, requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { isUnknownInventoryLocationName } from '@/app/(dashboard)/inventory/utils';
import type { InventoryCategory, InventoryStatus } from '@/app/(dashboard)/inventory/types';

interface InventoryItemRequestBody {
  item_number?: string;
  name?: string;
  category?: InventoryCategory;
  location_id?: string;
  last_checked_at?: string | null;
  check_interval_days?: number | null;
  status?: InventoryStatus;
}

interface InventoryLocationRow {
  linked_van_id?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

interface InventoryItemRow {
  id: string;
  item_number_normalized: string;
  created_at?: string | null;
  location?: InventoryLocationRow | null;
  minor_plant_detail?: unknown;
  [key: string]: unknown;
}

interface InventoryMovementLocationRow {
  name: string | null;
}

interface InventoryUnknownMovementRow {
  item_id: string;
  moved_at: string;
  to_location?: InventoryMovementLocationRow | InventoryMovementLocationRow[] | null;
}

interface InventoryItemGroupSummary {
  id: string;
  name: string;
  description: string | null;
}

interface InventoryItemGroupMemberRow {
  item_id: string;
  group?: InventoryItemGroupSummary | InventoryItemGroupSummary[] | null;
}

interface LinkedVanSummary {
  id: string;
  reg_number: string;
  nickname: string | null;
}

function cleanOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function getLinkedVanIds(items: InventoryItemRow[]): string[] {
  return Array.from(new Set(items
    .map((item) => item.location?.linked_van_id)
    .filter((linkedVanId): linkedVanId is string => Boolean(linkedVanId))
  ));
}

async function loadLinkedVans(
  admin: ReturnType<typeof createAdminClient>,
  linkedVanIds: string[]
): Promise<Map<string, LinkedVanSummary>> {
  if (linkedVanIds.length === 0) return new Map();

  const { data, error } = await admin
    .from('vans')
    .select('id, reg_number, nickname')
    .in('id', linkedVanIds);

  if (error) throw error;

  return new Map((data || []).map((van) => [van.id, van]));
}

function addLinkedVanDisplay(item: InventoryItemRow, vanById: Map<string, LinkedVanSummary>): InventoryItemRow {
  const linkedVanId = item.location?.linked_van_id;
  if (!linkedVanId) return item;

  const van = vanById.get(linkedVanId);
  return {
    ...item,
    location: {
      ...item.location,
      linked_asset_type: 'van',
      linked_asset_label: van?.reg_number || null,
      linked_asset_nickname: van?.nickname || null,
    },
  };
}

function normalizeMinorPlantDetailRelation(item: InventoryItemRow): InventoryItemRow {
  const relation = item.minor_plant_detail;
  return {
    ...item,
    minor_plant_detail: Array.isArray(relation) ? relation[0] ?? null : relation ?? null,
  };
}

function pickMovementLocation(
  location: InventoryUnknownMovementRow['to_location']
): InventoryMovementLocationRow | null {
  if (!location) return null;
  return Array.isArray(location) ? location[0] ?? null : location;
}

async function loadUnknownLocationEnteredAt(
  admin: ReturnType<typeof createAdminClient>,
  items: InventoryItemRow[]
): Promise<Map<string, string>> {
  const unknownLocationItemIds = items
    .filter((item) => isUnknownInventoryLocationName(item.location?.name))
    .map((item) => item.id);

  if (unknownLocationItemIds.length === 0) return new Map();

  const { data, error } = await admin
    .from('inventory_item_movements')
    .select(`
      item_id,
      moved_at,
      to_location:inventory_locations!inventory_item_movements_to_location_id_fkey(name)
    `)
    .in('item_id', unknownLocationItemIds)
    .order('moved_at', { ascending: false });

  if (error) throw error;

  const enteredAtByItemId = new Map<string, string>();
  ((data || []) as unknown as InventoryUnknownMovementRow[]).forEach((movement) => {
    if (enteredAtByItemId.has(movement.item_id)) return;
    if (!isUnknownInventoryLocationName(pickMovementLocation(movement.to_location)?.name)) return;
    enteredAtByItemId.set(movement.item_id, movement.moved_at);
  });

  return enteredAtByItemId;
}

async function loadItemGroups(
  admin: ReturnType<typeof createAdminClient>,
  itemIds: string[]
): Promise<Map<string, InventoryItemGroupSummary>> {
  if (itemIds.length === 0) return new Map();

  const rows: InventoryItemGroupMemberRow[] = [];
  const chunkSize = 100;
  for (let index = 0; index < itemIds.length; index += chunkSize) {
    const chunk = itemIds.slice(index, index + chunkSize);
    const { data, error } = await admin
      .from('inventory_item_group_members')
      .select(`
        item_id,
        group:inventory_item_groups(id, name, description)
      `)
      .in('item_id', chunk);

    if (error) throw error;
    rows.push(...((data || []) as unknown as InventoryItemGroupMemberRow[]));
  }

  function pickGroup(group: InventoryItemGroupMemberRow['group']): InventoryItemGroupSummary | null {
    if (!group) return null;
    return Array.isArray(group) ? group[0] ?? null : group;
  }

  return new Map(
    rows
      .map((member) => [member.item_id, pickGroup(member.group)] as const)
      .filter((entry): entry is readonly [string, InventoryItemGroupSummary] => Boolean(entry[1]))
  );
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 1000);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const requestedStatus = searchParams.get('status') === 'retired' ? 'retired' : 'active';

    if (requestedStatus === 'retired' && access.isManagerOrAdmin !== true) {
      return NextResponse.json({ error: 'Manager or admin access required' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('inventory_items')
      .select(`
        *,
        location:inventory_locations(*),
        minor_plant_detail:inventory_minor_plant_details(*)
      `)
      .eq('status', requestedStatus)
      .order(requestedStatus === 'retired' ? 'retired_at' : 'name', { ascending: requestedStatus !== 'retired' })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    const items = (data || []) as InventoryItemRow[];
    const [vanById, groupByItemId, unknownLocationEnteredAtByItemId] = await Promise.all([
      loadLinkedVans(admin, getLinkedVanIds(items)),
      loadItemGroups(admin, items.map((item) => item.id)),
      loadUnknownLocationEnteredAt(admin, items),
    ]);

    const inventory = items.map((item) => ({
        ...normalizeMinorPlantDetailRelation(addLinkedVanDisplay(item, vanById)),
        group: groupByItemId.get(item.id) || null,
        unknown_location_entered_at: unknownLocationEnteredAtByItemId.get(item.id) || null,
      }));

    return NextResponse.json({
      inventory,
      pagination: {
        offset,
        limit,
        has_more: inventory.length === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as InventoryItemRequestBody;
    const itemNumber = body.item_number?.trim();
    const name = body.name?.trim();
    const locationId = body.location_id?.trim();

    if (!itemNumber) {
      return NextResponse.json({ error: 'Item number is required' }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!locationId) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: location, error: locationError } = await admin
      .from('inventory_locations')
      .select('id, is_active')
      .eq('id', locationId)
      .single();

    if (locationError || !location?.is_active) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    const { data, error } = await admin
      .from('inventory_items')
      .insert({
        item_number: itemNumber,
        item_number_normalized: normalizeInventoryItemNumber(itemNumber),
        name,
        category: body.category || 'minor_plant',
        location_id: locationId,
        last_checked_at: cleanOptionalDate(body.last_checked_at),
        check_interval_days: body.check_interval_days || null,
        status: 'active',
        created_by: access.userId,
        updated_by: access.userId,
      })
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
      throw error;
    }

    return NextResponse.json({ item: normalizeMinorPlantDetailRelation(data as InventoryItemRow) }, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory item:', error);
    return NextResponse.json({ error: 'Failed to create inventory item' }, { status: 500 });
  }
}
