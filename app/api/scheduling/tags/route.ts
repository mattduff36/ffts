import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSchedulingAccess, requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { loadScheduleJobTags } from '@/lib/server/scheduling-tags';
import { createAdminClient } from '@/lib/supabase/admin';

const createTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(30).default('slate'),
  description: z.string().trim().max(1000).nullish(),
});

export async function GET() {
  try {
    const access = await requireSchedulingAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const tags = await loadScheduleJobTags(createAdminClient());
    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Error loading scheduling job tags:', error);
    return NextResponse.json({ error: 'Unable to load job tags.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const parsed = createTagSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid job tag.' },
        { status: 400 }
      );
    }

    const { data, error } = await createAdminClient()
      .from('schedule_job_tags')
      .insert({
        ...parsed.data,
        description: parsed.data.description || null,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select('id, name, color, description, is_active')
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A job tag with that name already exists.' }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ tag: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating scheduling job tag:', error);
    return NextResponse.json({ error: 'Unable to create this job tag.' }, { status: 500 });
  }
}
