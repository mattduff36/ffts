import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingAccess, requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const updateSchema = z
  .object({
    job_reference: z.string().trim().min(1).max(60).optional(),
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    site_address: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
  })
  .refine(
    (value) => !value.start_date || !value.end_date || value.end_date >= value.start_date,
    { message: 'End date must be on or after the start date.', path: ['end_date'] }
  );

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { id } = await params;
    const admin = createAdminClient();
    if (!access.isManagerOrAdmin && access.userId) {
      const assignment = await admin
        .from('schedule_employee_assignments')
        .select('id')
        .eq('job_id', id)
        .eq('profile_id', access.userId)
        .limit(1);
      if (assignment.error) throw assignment.error;
      if ((assignment.data || []).length === 0) {
        return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
      }
    }
    const { data, error } = await admin
      .from('schedule_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error loading schedule job:', error);
    return NextResponse.json({ error: 'Unable to load this job.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid job details.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const admin = createAdminClient();
    const existingResult = await admin
      .from('schedule_jobs')
      .select('start_date, end_date')
      .eq('id', id)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (!existingResult.data) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    const startDate = parsed.data.start_date || existingResult.data.start_date;
    const endDate = parsed.data.end_date || existingResult.data.end_date;
    if (endDate < startDate) {
      return NextResponse.json(
        { error: 'End date must be on or after the start date.' },
        { status: 400 }
      );
    }

    if (parsed.data.start_date || parsed.data.end_date) {
      const [employeeAssignments, plantAssignments] = await Promise.all([
        admin.from('schedule_employee_assignments').select('work_date').eq('job_id', id),
        admin.from('schedule_plant_assignments').select('work_date').eq('job_id', id),
      ]);
      if (employeeAssignments.error) throw employeeAssignments.error;
      if (plantAssignments.error) throw plantAssignments.error;
      const outsideRange = [...(employeeAssignments.data || []), ...(plantAssignments.data || [])]
        .some((assignment) => assignment.work_date < startDate || assignment.work_date > endDate);
      if (outsideRange) {
        return NextResponse.json(
          { error: 'Remove assignments outside the new job date range before changing these dates.' },
          { status: 409 }
        );
      }
    }

    const { data, error } = await admin
      .from('schedule_jobs')
      .update({ ...parsed.data, updated_by: access.userId })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That job reference already exists.' }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error updating schedule job:', error);
    return NextResponse.json({ error: 'Unable to update this job.' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { id } = await params;
    const { error } = await createAdminClient().from('schedule_jobs').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule job:', error);
    return NextResponse.json({ error: 'Unable to delete this job.' }, { status: 500 });
  }
}
