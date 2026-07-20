import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { getScheduleVisitDate } from '@/lib/utils/scheduling';

const visitSchema = z
  .object({
    job_id: z.uuid(),
    title: z.string().trim().max(255).nullish(),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    status: z.enum(['planned', 'completed', 'cancelled']).default('planned'),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((value) => new Date(value.ends_at) > new Date(value.starts_at), {
    message: 'Visit end time must be after its start time.',
    path: ['ends_at'],
  })
  .refine((value) => getScheduleVisitDate(value.starts_at) === getScheduleVisitDate(value.ends_at), {
    message: 'A visit must start and finish on the same day.',
    path: ['ends_at'],
  });

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = visitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid scheduling visit.' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const jobResult = await admin
      .from('schedule_jobs')
      .select('id, start_date, end_date')
      .eq('id', parsed.data.job_id)
      .maybeSingle();
    if (jobResult.error) throw jobResult.error;
    if (!jobResult.data) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    const visitDate = getScheduleVisitDate(parsed.data.starts_at);
    if (visitDate < jobResult.data.start_date || visitDate > jobResult.data.end_date) {
      return NextResponse.json(
        { error: 'The visit must fall within the Quote planning dates.' },
        { status: 400 }
      );
    }

    const sequenceResult = await admin
      .from('schedule_visits')
      .select('sequence_number')
      .eq('job_id', parsed.data.job_id)
      .order('sequence_number', { ascending: false })
      .limit(1);
    if (sequenceResult.error) throw sequenceResult.error;
    const sequenceNumber = Number(sequenceResult.data?.[0]?.sequence_number || 0) + 1;

    const result = await admin
      .from('schedule_visits')
      .insert({
        ...parsed.data,
        title: parsed.data.title || null,
        notes: parsed.data.notes || null,
        sequence_number: sequenceNumber,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select()
      .single();
    if (result.error) throw result.error;

    return NextResponse.json({ visit: result.data }, { status: 201 });
  } catch (error) {
    console.error('Error creating scheduling visit:', error);
    return NextResponse.json({ error: 'Unable to create this visit.' }, { status: 500 });
  }
}
