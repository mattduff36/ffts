import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const updateSchema = z.object({
  plant_id: z.uuid().optional(),
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().optional(),
  reason: z.string().trim().min(1).max(255).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid unavailability details.' },
        { status: 400 }
      );
    }
    const { id } = await params;
    const admin = createAdminClient();
    const existing = await admin
      .from('schedule_plant_unavailability')
      .select('start_date, end_date')
      .eq('id', id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: 'Unavailability block not found.' }, { status: 404 });

    const startDate = parsed.data.start_date || existing.data.start_date;
    const endDate = parsed.data.end_date || existing.data.end_date;
    if (endDate < startDate) {
      return NextResponse.json(
        { error: 'End date must be on or after the start date.' },
        { status: 400 }
      );
    }

    const result = await admin
      .from('schedule_plant_unavailability')
      .update({ ...parsed.data, updated_by: access.userId })
      .eq('id', id)
      .select()
      .single();
    if (result.error) throw result.error;
    return NextResponse.json({ block: result.data });
  } catch (error) {
    console.error('Error updating plant unavailability:', error);
    return NextResponse.json({ error: 'Unable to update plant unavailability.' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { id } = await params;
    const { error } = await createAdminClient()
      .from('schedule_plant_unavailability')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting plant unavailability:', error);
    return NextResponse.json({ error: 'Unable to remove plant unavailability.' }, { status: 500 });
  }
}
