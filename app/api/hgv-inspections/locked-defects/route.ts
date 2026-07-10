import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { LOCKED_INSPECTION_DEFECT_STATUSES } from '@/lib/utils/inspectionDefectTaskStatuses';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';

function extractOriginalInspectionComment(description: string | null | undefined): string {
  if (!description) {
    return '';
  }

  const commentMatch = description.match(/(?:^|\n)Comment:\s*(.+?)(?:\n|$)/);
  return commentMatch?.[1]?.trim() || '';
}

export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
    if (errorResponse) {
      return errorResponse;
    }

    const { searchParams } = new URL(request.url);
    const hgvId = searchParams.get('hgvId');

    if (!hgvId) {
      return NextResponse.json({ error: 'hgvId is required' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        logged_comment,
        workshop_comments,
        description,
        inspection_item_id
      `)
      .eq('hgv_id', hgvId)
      .eq('action_type', 'inspection_defect')
      .in('status', LOCKED_INSPECTION_DEFECT_STATUSES as unknown as string[]);

    if (tasksError) {
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ lockedItems: [] });
    }

    const itemIds = tasks.map(t => t.inspection_item_id).filter(Boolean);
    let items: Array<{ id: string; item_number: number; item_description: string; comments: string | null }> = [];

    if (itemIds.length > 0) {
      const { data: fetchedItems } = await supabaseAdmin
        .from('inspection_items')
        .select('id, item_number, item_description, comments')
        .in('id', itemIds);

      if (fetchedItems) {
        items = fetchedItems;
      }
    }

    const lockedItems: Array<{
      item_number: number;
      item_description: string;
      status: string;
      actionId: string;
      comment: string;
    }> = [];

    for (const task of tasks) {
      let itemNumber: number | null = null;
      let itemDescription = '';

      if (task.inspection_item_id) {
        const item = items.find(i => i.id === task.inspection_item_id);
        if (item) {
          itemNumber = item.item_number;
          itemDescription = item.item_description;
        }
      }

      if (itemNumber === null && task.description) {
        const descMatch = task.description.match(/Item (\d+) - ([^(]+)/);
        if (descMatch) {
          itemNumber = parseInt(descMatch[1], 10);
          itemDescription = descMatch[2].trim();
        }
      }

      if (itemNumber === null) {
        continue;
      }

      lockedItems.push({
        item_number: itemNumber,
        item_description: itemDescription,
        status: task.status,
        actionId: task.id,
        comment: items.find(i => i.id === task.inspection_item_id)?.comments?.trim()
          || extractOriginalInspectionComment(task.description),
      });
    }

    return NextResponse.json({ lockedItems });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
