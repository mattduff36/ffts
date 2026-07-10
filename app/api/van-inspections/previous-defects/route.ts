import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { buildUnresolvedPreviousDefects } from '@/lib/utils/inspectionPreviousDefects';

export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await getInspectionRouteActorAccess('inspections');
    if (errorResponse) {
      return errorResponse;
    }

    const { searchParams } = new URL(request.url);
    const vehicleId = searchParams.get('vehicleId');

    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
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

    const { data: lastInspection, error: inspectionError } = await supabaseAdmin
      .from('van_inspections')
      .select('id, inspection_date')
      .eq('van_id', vehicleId)
      .eq('status', 'submitted')
      .order('inspection_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inspectionError) {
      console.error('Error fetching previous van inspection:', inspectionError);
      return NextResponse.json({ error: 'Failed to fetch previous inspection' }, { status: 500 });
    }

    if (!lastInspection) {
      return NextResponse.json({ previousDefects: [] });
    }

    const [{ data: items, error: itemsError }, { data: completedActions, error: actionsError }] =
      await Promise.all([
        supabaseAdmin
          .from('inspection_items')
          .select('item_number, item_description, status, day_of_week')
          .eq('inspection_id', lastInspection.id),
        supabaseAdmin
          .from('actions')
          .select('description, actioned_at, updated_at')
          .eq('van_id', vehicleId)
          .eq('action_type', 'inspection_defect')
          .eq('status', 'completed')
          .or(`actioned_at.gte.${lastInspection.inspection_date},updated_at.gte.${lastInspection.inspection_date}`)
          .order('actioned_at', { ascending: false, nullsFirst: false })
          .limit(100),
      ]);

    if (itemsError) {
      console.error('Error fetching previous van inspection items:', itemsError);
      return NextResponse.json({ error: 'Failed to fetch previous inspection items' }, { status: 500 });
    }

    if (actionsError) {
      console.error('Error fetching completed van defect tasks:', actionsError);
      return NextResponse.json({ error: 'Failed to fetch completed defect tasks' }, { status: 500 });
    }

    const previousDefects = buildUnresolvedPreviousDefects(
      items || [],
      completedActions || [],
      { inspectionStartDate: lastInspection.inspection_date }
    );

    return NextResponse.json({
      previousDefects: Array.from(previousDefects.entries()).map(([signature, summary]) => ({
        signature,
        ...summary,
      })),
    });
  } catch (error) {
    console.error('Error in previous-defects endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
