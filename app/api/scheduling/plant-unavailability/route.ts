import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';

const blockSchema = z
  .object({
    plant_id: z.uuid(),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    reason: z.string().trim().min(1).max(255),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((value) => value.end_date >= value.start_date, {
    message: 'End date must be on or after the start date.',
    path: ['end_date'],
  });

export async function GET(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const params = new URL(request.url).searchParams;
    const from = params.get('from');
    const to = params.get('to');
    let query = createAdminClient()
      .from('schedule_plant_unavailability')
      .select('*, plant:plant(id, plant_id, nickname, make, model, status)')
      .order('start_date');
    if (from) query = query.gte('end_date', from);
    if (to) query = query.lte('start_date', to);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ blocks: data || [] });
  } catch (error) {
    console.error('Error loading plant unavailability:', error);
    return NextResponse.json({ error: 'Unable to load plant unavailability.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const parsed = blockSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid unavailability details.' },
        { status: 400 }
      );
    }
    const { data, error } = await createAdminClient()
      .from('schedule_plant_unavailability')
      .insert({
        ...parsed.data,
        notes: parsed.data.notes || null,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ block: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating plant unavailability:', error);
    return NextResponse.json({ error: 'Unable to add plant unavailability.' }, { status: 500 });
  }
}
