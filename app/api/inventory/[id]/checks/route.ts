import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { CHECK_INTERVAL_DAYS } from '@/app/(dashboard)/inventory/utils';
import {
  INVENTORY_SERVICE_CHECKLIST_VERSION,
  getInventoryChecklistDefinition,
  getInventoryCheckOverallStatus,
  isInventoryChecklistStatus,
  type InventoryChecklistDefinition,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CreateInventoryCheckBody {
  checked_at?: string;
  note?: string | null;
  checklist_version?: string | null;
  checklist_items?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function validateChecklistItems(
  value: unknown,
  definition: InventoryChecklistDefinition,
): { items: InventoryChecklistItemResult[]; error: null } | { items: null; error: string } {
  if (!Array.isArray(value)) {
    return { items: null, error: 'Checklist items must be an array' };
  }

  if (value.length !== definition.items.length) {
    return { items: null, error: 'Checklist is incomplete' };
  }

  const itemsByNumber = new Map<number, Record<string, unknown>>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      return { items: null, error: 'Checklist items must be objects' };
    }

    const itemNumber = entry.item_number;
    if (typeof itemNumber !== 'number' || !Number.isInteger(itemNumber)) {
      return { items: null, error: 'Checklist item numbers are invalid' };
    }

    if (itemsByNumber.has(itemNumber)) {
      return { items: null, error: `Checklist item ${itemNumber} is duplicated` };
    }

    itemsByNumber.set(itemNumber, entry);
  }

  const normalizedItems: InventoryChecklistItemResult[] = [];
  for (const checklistItem of definition.items) {
    const entry = itemsByNumber.get(checklistItem.item_number);
    if (!entry) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} is missing` };
    }

    if (getStringValue(entry.label) !== checklistItem.label) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} has an invalid label` };
    }

    if (!isInventoryChecklistStatus(entry.status)) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} has an invalid status` };
    }

    const comment = getStringValue(entry.comment);
    if (entry.status === 'attention' && !comment) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} requires a fail comment` };
    }

    normalizedItems.push({
      ...checklistItem,
      status: entry.status,
      comment,
    });
  }

  if (itemsByNumber.size !== definition.items.length) {
    return { items: null, error: 'Checklist contains unknown items' };
  }

  return { items: normalizedItems, error: null };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as CreateInventoryCheckBody;
    const checkedAt = body.checked_at?.trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) {
      return NextResponse.json({ error: 'Check date must be in YYYY-MM-DD format' }, { status: 400 });
    }

    const hasStructuredChecklist = body.checklist_items !== undefined && body.checklist_items !== null;
    let checklistDefinition: InventoryChecklistDefinition | null = null;
    let checklistItems: InventoryChecklistItemResult[] | null = null;

    if (hasStructuredChecklist) {
      const checklistVersion = getStringValue(body.checklist_version) || INVENTORY_SERVICE_CHECKLIST_VERSION;
      checklistDefinition = getInventoryChecklistDefinition(checklistVersion);
      if (!checklistDefinition) {
        return NextResponse.json({ error: 'Unsupported checklist version' }, { status: 400 });
      }

      const checklistValidation = validateChecklistItems(body.checklist_items, checklistDefinition);
      if (checklistValidation.error) {
        return NextResponse.json({ error: checklistValidation.error }, { status: 400 });
      }
      checklistItems = checklistValidation.items;
    }

    const overallStatus =
      checklistItems && checklistDefinition ? getInventoryCheckOverallStatus(checklistItems, checklistDefinition) : null;

    const admin = createAdminClient();
    const { data: item, error: itemError } = await admin
      .from('inventory_items')
      .select('id, check_interval_days, last_checked_at, status')
      .eq('id', id)
      .single();

    if (itemError) {
      if (itemError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw itemError;
    }

    if (item.status !== 'active') {
      return NextResponse.json({ error: 'Retired inventory items cannot be checked' }, { status: 400 });
    }

    const intervalDays = item.check_interval_days || CHECK_INTERVAL_DAYS;
    const { data: check, error: checkError } = await admin
      .from('inventory_check_history')
      .insert({
        item_id: id,
        checked_at: checkedAt,
        interval_days: intervalDays,
        note: body.note?.trim() || null,
        checklist_version: checklistItems && checklistDefinition ? checklistDefinition.version : null,
        checklist_items: checklistItems,
        overall_status: overallStatus,
        checked_by: access.userId,
      })
      .select('*')
      .single();

    if (checkError) throw checkError;

    const shouldPromoteLastCheckedAt = !item.last_checked_at || checkedAt >= item.last_checked_at;
    if (shouldPromoteLastCheckedAt) {
      const { error: updateError } = await admin
        .from('inventory_items')
        .update({
          last_checked_at: checkedAt,
          updated_by: access.userId,
        })
        .eq('id', id);

      if (updateError) throw updateError;
    }

    return NextResponse.json({ check }, { status: 201 });
  } catch (error) {
    console.error('Error recording inventory check:', error);
    return NextResponse.json({ error: 'Failed to record inventory check' }, { status: 500 });
  }
}
