import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { getVanInspectionsMaintenanceResponse } from '@/lib/server/van-inspections-maintenance';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function DELETE(
  request: NextRequest,
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

    if (!access.canDeleteInspections) {
      return NextResponse.json(
        { error: 'Forbidden: inspection management access required' },
        { status: 403 }
      );
    }

    const inspectionId = (await params).id;
    const admin = createAdminClient();

    // Delete inspection (cascade will delete items)
    const { error: deleteError } = await admin
      .from('van_inspections')
      .delete()
      .eq('id', inspectionId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete inspection' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting inspection:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/van-inspections/[id]/delete',
      additionalData: {
        endpoint: '/api/van-inspections/[id]/delete',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

