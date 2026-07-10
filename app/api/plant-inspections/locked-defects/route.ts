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

/**
 * GET /api/plant-inspections/locked-defects?plantId=xxx
 * 
 * Returns locked checklist items for a plant where existing defect tasks are active.
 * Uses service role to bypass RLS (inspectors can't read actions table).
 * 
 * Locked items are those with workshop tasks in statuses: pending, logged, on_hold, in_progress
 * 
 * Returns: { lockedItems: Array<{ item_number, item_description, status, actionId, comment }> }
 */
export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await getInspectionRouteActorAccess('plant-inspections');
    if (errorResponse) {
      return errorResponse;
    }

    // Get plantId from query params
    const { searchParams } = new URL(request.url);
    const plantId = searchParams.get('plantId');

    if (!plantId) {
      return NextResponse.json({ error: 'plantId is required' }, { status: 400 });
    }

    // Use service role client to bypass RLS
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

    // Find active inspection defect tasks for this plant
    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        logged_comment,
        workshop_comments,
        description,
        inspection_item_id,
        inspection_id
      `)
      .eq('plant_id', plantId)
      .eq('action_type', 'inspection_defect')
      .in('status', LOCKED_INSPECTION_DEFECT_STATUSES as unknown as string[]);

    if (tasksError) {
      console.error('Error fetching plant tasks:', tasksError);
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ lockedItems: [] });
    }

    // Get inspection_items to extract item_number and item_description
    const itemIds = tasks.map(t => t.inspection_item_id).filter(Boolean);
    
    const lockedItems: Array<{
      item_number: number;
      item_description: string;
      status: string;
      actionId: string;
      comment: string;
    }> = [];

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

    // Process ALL tasks
    for (const task of tasks) {
      let lockedItem: {
        item_number: number;
        item_description: string;
        status: string;
        actionId: string;
        comment: string;
      } | null = null;

      // Try 1: Find by inspection_item_id in database
      if (task.inspection_item_id) {
        const item = items.find(i => i.id === task.inspection_item_id);
        if (item) {
          lockedItem = {
            item_number: item.item_number,
            item_description: item.item_description,
            status: task.status,
            actionId: task.id,
            comment: item.comments?.trim() || extractOriginalInspectionComment(task.description)
          };
        }
      }

      // Try 2: Parse from description
      if (!lockedItem && task.description) {
        const descMatch = task.description.match(/Item (\d+) - ([^(]+)/);
        if (descMatch) {
          const itemNumber = parseInt(descMatch[1]);
          const itemDesc = descMatch[2].trim();
          
          lockedItem = {
            item_number: itemNumber,
            item_description: itemDesc,
            status: task.status,
            actionId: task.id,
            comment: extractOriginalInspectionComment(task.description)
          };
        }
      }

      if (!lockedItem) {
        console.error(`[plant-locked-defects] Unable to parse task ${task.id} for plant ${plantId}`, {
          inspection_item_id: task.inspection_item_id,
          description: task.description,
          status: task.status,
          inspection_id: task.inspection_id
        });
        continue;
      }

      lockedItems.push(lockedItem);
    }

    return NextResponse.json({ lockedItems });
  } catch (error) {
    console.error('Error in plant locked-defects endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
