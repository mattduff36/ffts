import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];

/**
 * POST /api/plant-inspections/inform-workshop
 * 
 * Creates a workshop task from inspector comments on plant inspection.
 * 
 * Input: {
 *   plantId: string;
 *   inspectionId: string;
 *   createdBy: string;
 *   comments: string;
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('plant-inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { plantId, inspectionId, createdBy, comments } = body;

    if (!plantId || !inspectionId || !createdBy || !comments) {
      return NextResponse.json(
        { error: 'Missing required fields: plantId, inspectionId, createdBy, comments' },
        { status: 400 }
      );
    }

    if (createdBy !== access.userId) {
      return NextResponse.json(
        { error: 'Forbidden: createdBy must match authenticated user' },
        { status: 403 }
      );
    }

    if (typeof comments !== 'string' || comments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      return NextResponse.json(
        { error: `Comment must be at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters` },
        { status: 400 }
      );
    }

    const trimmedComments = comments.trim();

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: inspectionOwner, error: inspectionLookupError } = await supabaseAdmin
      .from('plant_inspections')
      .select('user_id, plant_id, is_hired_plant')
      .eq('id', inspectionId)
      .maybeSingle();

    if (inspectionLookupError || !inspectionOwner) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    if (inspectionOwner.plant_id && inspectionOwner.plant_id !== plantId) {
      return NextResponse.json(
        { error: 'plantId does not match inspection plant' },
        { status: 400 }
      );
    }

    if (inspectionOwner.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: cannot modify another user inspection tasks' },
        { status: 403 }
      );
    }

    // Guard: no workshop tasks for hired plant inspections
    if (inspectionOwner.is_hired_plant) {
      return NextResponse.json({
        success: false,
        skipped: true,
        message: 'Hired plant: no workshop tasks created',
      });
    }

    // Get plant info
    const { data: plant } = await supabaseAdmin
      .from('plant')
      .select('plant_id')
      .eq('id', plantId)
      .single();

    const plantNumber = plant?.plant_id || 'Unknown Plant';

    // Get category/subcategory for plant tasks
    const { data: category } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .or('name.eq.Repair,name.eq.Other')
      .eq('applies_to', 'plant')
      .eq('is_active', true)
      .limit(1)
      .single();

    const taskData: ActionInsert = {
      action_type: 'workshop_vehicle_task',
      plant_id: plantId,
      title: `Plant ${plantNumber}: Inspector Comments`,
      description: trimmedComments,
      status: 'pending',
      created_by: createdBy,
      inspection_id: inspectionId,
      workshop_category_id: category?.id || null,
    };

    const { data: newTask, error: insertError } = await supabaseAdmin
      .from('actions')
      .insert([taskData])
      .select('id')
      .single();

    if (insertError) {
      console.error('Error creating plant workshop task:', insertError);
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }

    return NextResponse.json({ success: true, taskId: newTask.id });
  } catch (error) {
    console.error('Error in plant inform-workshop:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
