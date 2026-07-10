import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];

export async function POST(request: NextRequest) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { hgvId, inspectionId, createdBy, comments } = body;

    if (!hgvId || !inspectionId || !createdBy || !comments) {
      return NextResponse.json(
        { error: 'Missing required fields: hgvId, inspectionId, createdBy, comments' },
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
      .from('hgv_inspections')
      .select('user_id, hgv_id')
      .eq('id', inspectionId)
      .maybeSingle();

    if (inspectionLookupError || !inspectionOwner) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    if (inspectionOwner.hgv_id !== hgvId) {
      return NextResponse.json(
        { error: 'hgvId does not match inspection vehicle' },
        { status: 400 }
      );
    }

    if (inspectionOwner.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: cannot modify another user inspection tasks' },
        { status: 403 }
      );
    }

    const { data: hgv } = await supabaseAdmin
      .from('hgvs')
      .select('reg_number')
      .eq('id', hgvId)
      .single();

    const hgvReg = hgv?.reg_number || 'Unknown HGV';

    const { data: category } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .or('name.eq.Repair,name.eq.Other')
      .eq('applies_to', 'hgv')
      .eq('is_active', true)
      .limit(1)
      .single();

    const taskData: ActionInsert = {
      action_type: 'workshop_vehicle_task',
      hgv_id: hgvId,
      title: `HGV ${hgvReg}: Inspector Comments`,
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
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }

    return NextResponse.json({ success: true, taskId: newTask.id });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
