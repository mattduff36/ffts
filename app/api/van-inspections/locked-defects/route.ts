import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { LOCKED_INSPECTION_DEFECT_STATUSES } from '@/lib/utils/inspectionDefectTaskStatuses';

function extractOriginalInspectionComment(description: string | null | undefined): string {
  if (!description) {
    return '';
  }

  const commentMatch = description.match(/(?:^|\n)Comment:\s*(.+?)(?:\n|$)/);
  return commentMatch?.[1]?.trim() || '';
}

/**
 * GET /api/van-inspections/locked-defects?vehicleId=xxx
 * 
 * Returns locked checklist items for a vehicle where existing defect tasks are active.
 * Uses service role to bypass RLS (inspectors can't read actions table).
 * 
 * Locked items are those with workshop tasks in active lock statuses.
 * 
 * Returns: { lockedItems: Array<{ item_number, item_description, status, actionId, comment }> }
 */
export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await getInspectionRouteActorAccess('inspections');
    if (errorResponse) {
      return errorResponse;
    }

    // Get vehicleId from query params
    const { searchParams } = new URL(request.url);
    const vehicleId = searchParams.get('vehicleId');

    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
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

    // Find active inspection defect tasks for this vehicle.
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
      .eq('van_id', vehicleId)
      .eq('action_type', 'inspection_defect')
      .in('status', LOCKED_INSPECTION_DEFECT_STATUSES);

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError);
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
      // No locked items
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

    // Fetch inspection items if we have any item IDs
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

    // Process ALL tasks (even those with NULL inspection_item_id)
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

      // Try 2: Parse from description if item not found or inspection_item_id is NULL
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

      // Fallback 3: If all parsing fails, log error and skip task
      // DON'T add with item_number: 0 as it will never match real checklist items (1-5+)
      // This would break the locking mechanism
      if (!lockedItem) {
        console.error(`[locked-defects] CRITICAL: Unable to parse task ${task.id} for vehicle ${vehicleId}`, {
          inspection_item_id: task.inspection_item_id,
          description: task.description,
          status: task.status,
          inspection_id: task.inspection_id
        });
        // Skip this task rather than adding invalid item_number
        // Admin should investigate and fix malformed tasks
        continue;
      }

      lockedItems.push(lockedItem);
    }

    return NextResponse.json({ lockedItems });
  } catch (error) {
    console.error('Error in locked-defects endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
