import { NextResponse } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { loadTemplateLogoDataUrl } from '@/lib/pdf/template-logo';
import { InventoryChecklistPDF } from '@/lib/pdf/inventory-checklist-pdf';
import { formatInventoryCategoryLabel } from '@/app/(dashboard)/inventory/types';
import {
  getInventoryChecklistDefinition,
  getInventoryChecklistLabel,
  getInventoryCheckOverallStatus,
  isInventoryChecklistStatus,
  type InventoryCheckOverallStatus,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';

interface RouteParams {
  params: Promise<{ id: string; checkId: string }>;
}

interface InventoryCheckRow {
  id: string;
  item_id: string;
  checked_at: string;
  interval_days: number;
  note: string | null;
  checklist_version: string | null;
  checklist_items: unknown;
  overall_status: InventoryCheckOverallStatus | null;
  checked_by_profile: { full_name: string | null } | null;
}

interface InventoryItemRow {
  id: string;
  item_number: string;
  name: string;
  category: string;
  source_reference: string | null;
  location: { name: string | null } | null;
}

function parseChecklistItems(value: unknown): InventoryChecklistItemResult[] | null {
  if (!Array.isArray(value)) return null;

  const parsedItems: InventoryChecklistItemResult[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.item_number !== 'number' || !Number.isInteger(candidate.item_number)) return null;
    if (typeof candidate.label !== 'string' || !candidate.label.trim()) return null;
    if (!isInventoryChecklistStatus(candidate.status)) return null;

    parsedItems.push({
      item_number: candidate.item_number,
      label: candidate.label.trim(),
      status: candidate.status,
      comment: typeof candidate.comment === 'string' && candidate.comment.trim() ? candidate.comment.trim() : null,
    });
  }

  return parsedItems.length > 0 ? parsedItems : null;
}

function normalizeProfileRelation(value: unknown): { full_name: string | null } | null {
  if (Array.isArray(value)) return normalizeProfileRelation(value[0] ?? null);
  if (!value || typeof value !== 'object') return null;
  const profile = value as { full_name?: unknown };
  return { full_name: typeof profile.full_name === 'string' ? profile.full_name : null };
}

function normalizeItemRelation(item: unknown): InventoryItemRow {
  const row = item as InventoryItemRow;
  return {
    ...row,
    location: Array.isArray(row.location) ? row.location[0] ?? null : row.location ?? null,
  };
}

function buildSafeFilename(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'inventory_check';
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id, checkId } = await params;
    const admin = createAdminClient();

    const [itemResult, checkResult, groupResult] = await Promise.all([
      admin
        .from('inventory_items')
        .select(`
          id,
          item_number,
          name,
          category,
          source_reference,
          location:inventory_locations(id, name)
        `)
        .eq('id', id)
        .single(),
      admin
        .from('inventory_check_history')
        .select(`
          id,
          item_id,
          checked_at,
          interval_days,
          note,
          checklist_version,
          checklist_items,
          overall_status,
          checked_by_profile:profiles!inventory_check_history_checked_by_fkey(id, full_name)
        `)
        .eq('id', checkId)
        .eq('item_id', id)
        .single(),
      admin
        .from('inventory_item_group_members')
        .select('group:inventory_item_groups(id, name)')
        .eq('item_id', id)
        .maybeSingle(),
    ]);

    if (itemResult.error) {
      if (itemResult.error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw itemResult.error;
    }

    if (checkResult.error) {
      if (checkResult.error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory check not found' }, { status: 404 });
      }
      throw checkResult.error;
    }

    if (groupResult.error) throw groupResult.error;

    const item = normalizeItemRelation(itemResult.data);
    const rawCheck = checkResult.data as unknown as InventoryCheckRow;
    const checklistItems = parseChecklistItems(rawCheck.checklist_items);
    if (!checklistItems) {
      return NextResponse.json(
        { error: 'Checklist PDF is only available for structured inventory checks' },
        { status: 400 },
      );
    }

    const groupRelation = groupResult.data?.group;
    const group = Array.isArray(groupRelation) ? groupRelation[0] ?? null : groupRelation ?? null;
    const checkedByProfile = normalizeProfileRelation(rawCheck.checked_by_profile);
    const logoSrc = await loadTemplateLogoDataUrl();
    const checklistDefinition = getInventoryChecklistDefinition(rawCheck.checklist_version);
    const checklistLabel = getInventoryChecklistLabel(rawCheck.checklist_version);
    const overallStatus =
      rawCheck.overall_status ||
      (checklistDefinition
        ? getInventoryCheckOverallStatus(checklistItems, checklistDefinition)
        : checklistItems.some((checklistItem) => checklistItem.status === 'attention') ? 'fail' : 'pass');

    const pdfDocument = InventoryChecklistPDF({
      item: {
        itemNumber: item.item_number,
        name: item.name,
        category: formatInventoryCategoryLabel(item.category),
        locationName: item.location?.name || null,
        groupName: typeof group?.name === 'string' ? group.name : null,
        sourceReference: item.source_reference,
      },
      check: {
        checklistLabel,
        pdfTitle: checklistDefinition?.pdfTitle || 'Inventory Checklist',
        pdfSubtitle: checklistDefinition?.pdfSubtitle || 'Inventory Check Record',
        checkedAt: rawCheck.checked_at,
        checkedByName: checkedByProfile?.full_name || null,
        intervalDays: rawCheck.interval_days,
        note: rawCheck.note,
        overallStatus,
        checklistItems,
      },
      logoSrc,
    });

    const stream = await renderToStream(pdfDocument);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const pdfBytes = new Uint8Array(Buffer.concat(chunks));
    const filename = `${buildSafeFilename(`${item.item_number}_${rawCheck.checked_at}`)}_inventory_check.pdf`;

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating inventory checklist PDF:', error);
    return NextResponse.json({ error: 'Failed to generate inventory checklist PDF' }, { status: 500 });
  }
}
