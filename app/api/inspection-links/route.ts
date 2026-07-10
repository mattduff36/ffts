import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import type { ModuleName } from '@/types/roles';

type InspectionType = 'van' | 'hgv' | 'plant';

const INSPECTION_CONFIG: Record<
  InspectionType,
  { moduleName: ModuleName; tableName: 'van_inspections' | 'hgv_inspections' | 'plant_inspections' }
> = {
  van: { moduleName: 'inspections', tableName: 'van_inspections' },
  hgv: { moduleName: 'hgv-inspections', tableName: 'hgv_inspections' },
  plant: { moduleName: 'plant-inspections', tableName: 'plant_inspections' },
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const inspectionId = searchParams.get('inspectionId');
    const inspectionType = searchParams.get('inspectionType') as InspectionType | null;

    if (!inspectionId || !inspectionType || !(inspectionType in INSPECTION_CONFIG)) {
      return NextResponse.json(
        { error: 'inspectionId and valid inspectionType are required' },
        { status: 400 }
      );
    }

    const config = INSPECTION_CONFIG[inspectionType];
    const { access, errorResponse } = await getInspectionRouteActorAccess(config.moduleName);
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    const { data: inspection, error: inspectionError } = await supabaseAdmin
      .from(config.tableName)
      .select('id, user_id')
      .eq('id', inspectionId)
      .maybeSingle();

    if (inspectionError || !inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    if (inspection.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: inspectionItems, error: inspectionItemsError } = await supabaseAdmin
      .from('inspection_items')
      .select('id')
      .eq('inspection_id', inspectionId);

    if (inspectionItemsError) {
      console.error('Error fetching inspection items for linked tasks:', inspectionItemsError);
      return NextResponse.json({ error: 'Failed to fetch linked tasks' }, { status: 500 });
    }

    const itemIds = (inspectionItems || []).map((item) => item.id);
    const [directTasksResult, itemTasksResult] = await Promise.all([
      supabaseAdmin
        .from('actions')
        .select('id, action_type, status, created_at, logged_at, actioned_at, inspection_item_id, logged_comment, workshop_comments')
        .eq('inspection_id', inspectionId)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .order('created_at', { ascending: false }),
      itemIds.length > 0
        ? supabaseAdmin
            .from('actions')
            .select('id, action_type, status, created_at, logged_at, actioned_at, inspection_item_id, logged_comment, workshop_comments')
            .in('inspection_item_id', itemIds)
            .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (directTasksResult.error || itemTasksResult.error) {
      console.error('Error fetching linked inspection tasks:', directTasksResult.error || itemTasksResult.error);
      return NextResponse.json({ error: 'Failed to fetch linked tasks' }, { status: 500 });
    }

    const linkedTasksById = new Map(
      [...(directTasksResult.data || []), ...(itemTasksResult.data || [])].map((task) => [task.id, task])
    );
    const linkedTasks = Array.from(linkedTasksById.values()).sort((left, right) => {
      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightTime - leftTime;
    });

    return NextResponse.json({
      linkedTasks,
    });
  } catch (error) {
    console.error('Error in inspection-links endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
