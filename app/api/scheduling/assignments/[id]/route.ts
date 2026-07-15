import { NextRequest, NextResponse } from 'next/server';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { createAdminClient } from '@/lib/supabase/admin';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const resourceType = new URL(request.url).searchParams.get('resource_type');
    if (resourceType !== 'employee' && resourceType !== 'plant') {
      return NextResponse.json({ error: 'A valid resource type is required.' }, { status: 400 });
    }
    const { id } = await params;
    const table =
      resourceType === 'employee' ? 'schedule_employee_assignments' : 'schedule_plant_assignments';
    const { error } = await createAdminClient().from(table).delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting scheduling assignment:', error);
    return NextResponse.json({ error: 'Unable to remove this assignment.' }, { status: 500 });
  }
}
