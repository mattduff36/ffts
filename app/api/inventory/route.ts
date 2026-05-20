import { NextRequest, NextResponse } from 'next/server';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeInventoryItemNumber, requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import type { InventoryCategory, InventoryStatus } from '@/app/(dashboard)/inventory/types';

const completeListPath = 'data/COMPLETE LIST 2023.xlsx';

interface InventoryItemRequestBody {
  item_number?: string;
  name?: string;
  category?: InventoryCategory;
  location_id?: string;
  last_checked_at?: string | null;
  check_interval_days?: number | null;
  status?: InventoryStatus;
}

interface SourceLocationHint {
  locations: string[];
  rows: number[];
}

interface InventoryLocationRow {
  linked_van_id?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

interface InventoryItemRow {
  id: string;
  item_number_normalized: string;
  location?: InventoryLocationRow | null;
  [key: string]: unknown;
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

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    return JSON.stringify(value);
  }

  return String(value).trim();
}

function compactLocation(value: string): string {
  return value.trim() || '(blank)';
}

async function readCompleteListLocationHints(): Promise<Map<string, SourceLocationHint>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(process.cwd(), completeListPath));
  const worksheet = workbook.getWorksheet('COMPLETE');
  if (!worksheet) return new Map();

  const hints = new Map<string, SourceLocationHint>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const itemNumber = cellText(row.getCell(1).value);
    const name = cellText(row.getCell(2).value);
    const location = compactLocation(cellText(row.getCell(3).value));
    const rawDate = cellText(row.getCell(4).value);
    if (![itemNumber, name, location, rawDate].some(Boolean)) continue;

    const normalizedItemNumber = normalizeInventoryItemNumber(itemNumber);
    if (!normalizedItemNumber || normalizedItemNumber === 'NONUMBER') continue;

    const existing = hints.get(normalizedItemNumber) || { locations: [], rows: [] };
    if (!existing.locations.includes(location)) existing.locations.push(location);
    existing.rows.push(rowNumber);
    hints.set(normalizedItemNumber, existing);
  }

  return hints;
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

async function loadItemGroups(
  admin: ReturnType<typeof createAdminClient>,
  itemIds: string[]
): Promise<Map<string, InventoryItemGroupSummary>> {
  if (itemIds.length === 0) return new Map();

  const { data, error } = await admin
    .from('inventory_item_group_members')
    .select(`
      item_id,
      group:inventory_item_groups(id, name, description)
    `)
    .in('item_id', itemIds);

  if (error) throw error;

  function pickGroup(group: InventoryItemGroupMemberRow['group']): InventoryItemGroupSummary | null {
    if (!group) return null;
    return Array.isArray(group) ? group[0] ?? null : group;
  }

  return new Map(
    ((data || []) as unknown as InventoryItemGroupMemberRow[])
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

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('inventory_items')
      .select(`
        *,
        location:inventory_locations(*)
      `)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    const items = (data || []) as InventoryItemRow[];
    const vanById = await loadLinkedVans(admin, getLinkedVanIds(items));
    const groupByItemId = await loadItemGroups(admin, items.map((item) => item.id));

    let sourceLocationHints = new Map<string, SourceLocationHint>();
    try {
      sourceLocationHints = await readCompleteListLocationHints();
    } catch (hintError) {
      console.warn('Unable to read inventory spreadsheet location hints:', hintError);
    }

    const inventory = items.map((item) => {
      const itemWithLinkedVan = {
        ...addLinkedVanDisplay(item, vanById),
        group: groupByItemId.get(item.id) || null,
      };
      if (itemWithLinkedVan.location) return itemWithLinkedVan;

      const hint = sourceLocationHints.get(itemWithLinkedVan.item_number_normalized);
      if (!hint) return itemWithLinkedVan;

      return {
        ...itemWithLinkedVan,
        source_location_hint: hint.locations.join(' | '),
        source_location_rows: hint.rows.join(', '),
      };
    });

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
    const locationId = body.location_id?.trim() || null;

    if (!itemNumber) {
      return NextResponse.json({ error: 'Item number is required' }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    const { data, error } = await createAdminClient()
      .from('inventory_items')
      .insert({
        item_number: itemNumber,
        item_number_normalized: normalizeInventoryItemNumber(itemNumber),
        name,
        category: body.category || 'minor_plant',
        location_id: locationId,
        last_checked_at: cleanOptionalDate(body.last_checked_at),
        check_interval_days: body.check_interval_days || null,
        status: body.status || 'active',
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select(`
        *,
        location:inventory_locations(*)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An inventory item with this ID number already exists' }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory item:', error);
    return NextResponse.json({ error: 'Failed to create inventory item' }, { status: 500 });
  }
}
