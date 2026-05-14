import { NextRequest, NextResponse } from 'next/server';
import { resolve } from 'path';
import { existsSync } from 'fs';
import ExcelJS from 'exceljs';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeInventoryItemNumber, requireInventoryAccess } from '@/lib/server/inventory-auth';
import type { InventoryCategory, InventoryStatus } from '@/app/(dashboard)/inventory/types';

const completeListPath = 'data/COMPLETE LIST 2023.xlsx';

interface InventoryItemRequestBody {
  item_number?: string;
  name?: string;
  category?: InventoryCategory;
  location_id?: string;
  last_checked_at?: string | null;
  status?: InventoryStatus;
}

interface SourceLocationHint {
  locations: string[];
  rows: number[];
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
  const filePath = resolve(process.cwd(), completeListPath);
  if (!existsSync(filePath)) return new Map();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
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

export async function GET(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 1000);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const { data, error } = await createAdminClient()
      .from('inventory_items')
      .select(`
        *,
        location:inventory_locations(*)
      `)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    let sourceLocationHints = new Map<string, SourceLocationHint>();
    try {
      sourceLocationHints = await readCompleteListLocationHints();
    } catch (hintError) {
      console.warn('Unable to read inventory spreadsheet location hints:', hintError);
    }

    const inventory = (data || []).map((item) => {
      if (item.location?.name?.toLowerCase() !== 'nolocation') return item;

      const hint = sourceLocationHints.get(item.item_number_normalized);
      if (!hint) return item;

      return {
        ...item,
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
    const access = await requireInventoryAccess();
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

    const { data, error } = await createAdminClient()
      .from('inventory_items')
      .insert({
        item_number: itemNumber,
        item_number_normalized: normalizeInventoryItemNumber(itemNumber),
        name,
        category: body.category || 'minor_plant',
        location_id: locationId,
        last_checked_at: cleanOptionalDate(body.last_checked_at),
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
