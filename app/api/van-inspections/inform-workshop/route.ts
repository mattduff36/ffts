import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { 
  inferWorkshopSubcategoryFromComment, 
  FALLBACK_SUBCATEGORY 
} from '@/lib/utils/inspectionWorkshopRouting';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { getVanInspectionsMaintenanceResponse } from '@/lib/server/van-inspections-maintenance';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

/**
 * POST /api/van-inspections/inform-workshop
 * 
 * Creates or updates a workshop task from an inspection comment.
 * Idempotent: if a task already exists for this inspection with the same title prefix,
 * it will be updated instead of creating a duplicate.
 * 
 * Input: {
 *   inspectionId: string;
 *   vehicleId: string;
 *   comment: string;
 * }
 * 
 * Output: {
 *   success: boolean;
 *   taskId: string;
 *   action: 'created' | 'updated';
 *   subcategory: { name: string; inferred: boolean };
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const maintenanceResponse = getVanInspectionsMaintenanceResponse();
    if (maintenanceResponse) {
      return maintenanceResponse;
    }

    // Parse request body
    const body = await request.json();
    const { inspectionId, vehicleId, comment } = body;

    // Validate required fields
    if (!inspectionId || !vehicleId) {
      return NextResponse.json(
        { error: 'Missing required fields: inspectionId, vehicleId' },
        { status: 400 }
      );
    }

    // Validate comment length before creating a workshop task.
    if (!comment || typeof comment !== 'string' || comment.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      return NextResponse.json(
        { error: `Comment must be at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters` },
        { status: 400 }
      );
    }

    const trimmedComment = comment.trim();

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

    const { data: inspectionOwner, error: inspectionLookupError } = await supabaseAdmin
      .from('van_inspections')
      .select('user_id, van_id')
      .eq('id', inspectionId)
      .maybeSingle();

    if (inspectionLookupError || !inspectionOwner) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    if (inspectionOwner.van_id !== vehicleId) {
      return NextResponse.json(
        { error: 'vehicleId does not match inspection vehicle' },
        { status: 400 }
      );
    }

    if (inspectionOwner.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: cannot modify another user inspection tasks' },
        { status: 403 }
      );
    }

    // Get vehicle registration for task title
    const { data: vehicle } = await supabaseAdmin
      .from('vans')
      .select('reg_number')
      .eq('id', vehicleId)
      .single();

    const vehicleReg = vehicle?.reg_number || 'Unknown Van';

    // Infer subcategory from comment keywords
    const subcategoryMatch = inferWorkshopSubcategoryFromComment(trimmedComment);
    
    // Find the appropriate subcategory ID
    let subcategoryId: string | null = null;
    let subcategoryName: string;
    let wasInferred = false;

    if (subcategoryMatch) {
      // Try to find the matched subcategory under Repair category
      const { data: repairCategory } = await supabaseAdmin
        .from('workshop_task_categories')
        .select('id')
        .eq('name', 'Repair')
        .eq('applies_to', 'van')
        .eq('is_active', true)
        .single();

      if (repairCategory) {
        const { data: matchedSubcat } = await supabaseAdmin
          .from('workshop_task_subcategories')
          .select('id, name')
          .eq('category_id', repairCategory.id)
          .ilike('name', subcategoryMatch.subcategoryName)
          .eq('is_active', true)
          .single();

        if (matchedSubcat) {
          subcategoryId = matchedSubcat.id;
          subcategoryName = matchedSubcat.name;
          wasInferred = true;
        }
      }
    }

    // Fallback to "Repair → Inspection defects" or "Other → Other"
    if (!subcategoryId) {
      // Try primary fallback: Repair → Inspection defects
      const { data: repairCategory } = await supabaseAdmin
        .from('workshop_task_categories')
        .select('id')
        .eq('name', FALLBACK_SUBCATEGORY.primary.categoryName)
        .eq('applies_to', 'van')
        .eq('is_active', true)
        .single();

      if (repairCategory) {
        const { data: inspectionDefectsSubcat } = await supabaseAdmin
          .from('workshop_task_subcategories')
          .select('id, name')
          .eq('category_id', repairCategory.id)
          .ilike('name', `%${FALLBACK_SUBCATEGORY.primary.subcategoryName}%`)
          .eq('is_active', true)
          .single();

        if (inspectionDefectsSubcat) {
          subcategoryId = inspectionDefectsSubcat.id;
          subcategoryName = inspectionDefectsSubcat.name;
        }
      }

      // If still not found, try secondary fallback: Other → Other
      if (!subcategoryId) {
        const { data: otherCategory } = await supabaseAdmin
          .from('workshop_task_categories')
          .select('id')
          .eq('name', FALLBACK_SUBCATEGORY.secondary.categoryName)
          .eq('applies_to', 'van')
          .eq('is_active', true)
          .single();

        if (otherCategory) {
          const { data: otherSubcat } = await supabaseAdmin
            .from('workshop_task_subcategories')
            .select('id, name')
            .eq('category_id', otherCategory.id)
            .eq('name', FALLBACK_SUBCATEGORY.secondary.subcategoryName)
            .eq('is_active', true)
            .single();

          if (otherSubcat) {
            subcategoryId = otherSubcat.id;
            subcategoryName = otherSubcat.name;
          }
        }
      }
    }

    // If we still don't have a subcategory, log error but proceed without it
    if (!subcategoryId) {
      console.error('[inform-workshop] No suitable subcategory found, creating task without categorization');
      subcategoryName = 'Uncategorized';
    }

    // Build task title and description
    const titlePrefix = 'Inspection note - ';
    const title = `${titlePrefix}${vehicleReg}`;
    const description = `Inspector notes: ${trimmedComment}`;

    // Check for existing task (idempotency)
    const { data: existingTasks } = await supabaseAdmin
      .from('actions')
      .select('id, status')
      .eq('inspection_id', inspectionId)
      .eq('action_type', 'workshop_vehicle_task')
      .ilike('title', `${titlePrefix}%`)
      .neq('status', 'completed');

    let taskId: string;
    let action: 'created' | 'updated';

    if (existingTasks && existingTasks.length > 0) {
      // Update existing task
      const existingTask = existingTasks[0];
      
      const { error: updateError } = await supabaseAdmin
        .from('actions')
        .update({
          title,
          description,
          workshop_comments: trimmedComment,
          workshop_subcategory_id: subcategoryId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingTask.id);

      if (updateError) {
        console.error('[inform-workshop] Error updating task:', updateError);
        return NextResponse.json(
          { error: 'Failed to update workshop task' },
          { status: 500 }
        );
      }

      taskId = existingTask.id;
      action = 'updated';
    } else {
      // Create new task
      const { data: newTask, error: insertError } = await supabaseAdmin
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          inspection_id: inspectionId,
          van_id: vehicleId,
          workshop_subcategory_id: subcategoryId,
          title,
          description,
          workshop_comments: trimmedComment,
          priority: 'medium',
          status: 'pending',
          created_by: access.userId,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[inform-workshop] Error creating task:', insertError);
        return NextResponse.json(
          { error: 'Failed to create workshop task' },
          { status: 500 }
        );
      }

      taskId = newTask.id;
      action = 'created';
    }

    return NextResponse.json({
      success: true,
      taskId,
      action,
      subcategory: {
        name: subcategoryName!,
        inferred: wasInferred,
      },
    });
  } catch (error) {
    console.error('Error in inform-workshop endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
