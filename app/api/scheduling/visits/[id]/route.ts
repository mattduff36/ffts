import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { getScheduleVisitDate } from '@/lib/utils/scheduling';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const updateSchema = z.object({
  title: z.string().trim().max(255).nullable().optional(),
  starts_at: z.iso.datetime({ offset: true }).optional(),
  ends_at: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['planned', 'completed', 'cancelled']).optional(),
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
        { error: parsed.error.issues[0]?.message || 'Invalid scheduling visit.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const admin = createAdminClient();
    const existingResult = await admin
      .from('schedule_visits')
      .select('*, job:schedule_jobs(start_date, end_date)')
      .eq('id', id)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (!existingResult.data) {
      return NextResponse.json({ error: 'Scheduling visit not found.' }, { status: 404 });
    }

    const startsAt = parsed.data.starts_at || existingResult.data.starts_at;
    const endsAt = parsed.data.ends_at || existingResult.data.ends_at;
    if (new Date(endsAt) <= new Date(startsAt)) {
      return NextResponse.json(
        { error: 'Visit end time must be after its start time.' },
        { status: 400 }
      );
    }
    const visitDate = getScheduleVisitDate(startsAt);
    if (visitDate !== getScheduleVisitDate(endsAt)) {
      return NextResponse.json(
        { error: 'A visit must start and finish on the same day.' },
        { status: 400 }
      );
    }

    const jobRelation = Array.isArray(existingResult.data.job)
      ? existingResult.data.job[0]
      : existingResult.data.job;
    if (
      !jobRelation
      || visitDate < jobRelation.start_date
      || visitDate > jobRelation.end_date
    ) {
      return NextResponse.json(
        { error: 'The visit must fall within the Quote planning dates.' },
        { status: 400 }
      );
    }

    const result = await admin
      .from('schedule_visits')
      .update({ ...parsed.data, updated_by: access.userId })
      .eq('id', id)
      .select()
      .single();
    if (result.error) throw result.error;
    return NextResponse.json({ visit: result.data });
  } catch (error) {
    console.error('Error updating scheduling visit:', error);
    return NextResponse.json({ error: 'Unable to update this visit.' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { id } = await params;
    const { error } = await createAdminClient().from('schedule_visits').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting scheduling visit:', error);
    return NextResponse.json({ error: 'Unable to delete this visit.' }, { status: 500 });
  }
}
