import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { getVanInspectionsMaintenanceResponse } from '@/lib/server/van-inspections-maintenance';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const maintenanceResponse = getVanInspectionsMaintenanceResponse();
    if (maintenanceResponse) {
      return maintenanceResponse;
    }

    const inspectionId = (await params).id;
    const admin = createAdminClient();

    const { data: inspection, error: lookupError } = await admin
      .from('van_inspections')
      .select('id, user_id, status')
      .eq('id', inspectionId)
      .maybeSingle();

    if (lookupError || !inspection) {
      return NextResponse.json({ error: 'Van draft not found' }, { status: 404 });
    }

    if (inspection.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft inspections can be discarded' },
        { status: 409 }
      );
    }

    if (inspection.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: cannot discard another user draft' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await admin
      .from('van_inspections')
      .delete()
      .eq('id', inspectionId)
      .eq('status', 'draft');

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to discard draft' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to discard Van inspection draft', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
