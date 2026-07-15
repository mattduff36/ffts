import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';

const jobSchema = z
  .object({
    job_reference: z.string().trim().min(1).max(60),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullish(),
    site_address: z.string().trim().max(2000).nullish(),
    status: z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']).default('draft'),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
  })
  .refine((value) => value.end_date >= value.start_date, {
    message: 'End date must be on or after the start date.',
    path: ['end_date'],
  });

export async function GET() {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data, error } = await createAdminClient()
      .from('schedule_jobs')
      .select('*')
      .order('start_date', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ jobs: data || [] });
  } catch (error) {
    console.error('Error loading schedule jobs:', error);
    return NextResponse.json({ error: 'Unable to load schedule jobs.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = jobSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid job details.' },
        { status: 400 }
      );
    }

    const { data, error } = await createAdminClient()
      .from('schedule_jobs')
      .insert({
        ...parsed.data,
        description: parsed.data.description || null,
        site_address: parsed.data.site_address || null,
        source_type: 'manual',
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That job reference already exists.' }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ job: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule job:', error);
    return NextResponse.json({ error: 'Unable to create this job.' }, { status: 500 });
  }
}
