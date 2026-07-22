import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  conflictCodes,
  detectEmployeeConflicts,
  detectPlantConflicts,
  isDateWithinRange,
} from '@/lib/server/scheduling-conflicts';
import { getScheduleVisitDate } from '@/lib/utils/scheduling';
import type { ScheduleVisit } from '@/types/scheduling';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const moveAssignmentSchema = z.object({
  resource_type: z.enum(['employee', 'plant']),
  visit_id: z.uuid(),
  override_conflicts: z.boolean().default(false),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = moveAssignmentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid assignment move.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const input = parsed.data;
    const admin = createAdminClient();
    const table =
      input.resource_type === 'employee'
        ? 'schedule_employee_assignments'
        : 'schedule_plant_assignments';
    const resourceColumn = input.resource_type === 'employee' ? 'profile_id' : 'plant_id';

    const [assignmentResult, visitResult] = await Promise.all([
      admin
        .from(table)
        .select(`id, ${resourceColumn}`)
        .eq('id', id)
        .maybeSingle(),
      admin
        .from('schedule_visits')
        .select('*, job:schedule_jobs(id, start_date, end_date)')
        .eq('id', input.visit_id)
        .maybeSingle(),
    ]);
    if (assignmentResult.error) throw assignmentResult.error;
    if (visitResult.error) throw visitResult.error;
    if (!assignmentResult.data) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    const visit = visitResult.data as (ScheduleVisit & {
      job: { id: string; start_date: string; end_date: string }
        | Array<{ id: string; start_date: string; end_date: string }>
        | null;
    }) | null;
    if (!visit || visit.status === 'cancelled') {
      return NextResponse.json({ error: 'Scheduling visit not found.' }, { status: 404 });
    }

    const job = Array.isArray(visit.job) ? visit.job[0] : visit.job;
    const workDate = getScheduleVisitDate(visit.starts_at);
    if (!job || !isDateWithinRange(workDate, job.start_date, job.end_date)) {
      return NextResponse.json(
        { error: 'The target visit must fall within its job date range.' },
        { status: 400 }
      );
    }

    const resourceId =
      input.resource_type === 'employee'
        ? String((assignmentResult.data as { profile_id: string }).profile_id)
        : String((assignmentResult.data as { plant_id: string }).plant_id);
    const conflicts =
      input.resource_type === 'employee'
        ? await detectEmployeeConflicts(admin, {
            jobId: job.id,
            workDate,
            profileId: resourceId,
            visit,
            excludeAssignmentId: id,
          })
        : await detectPlantConflicts(admin, {
            jobId: job.id,
            workDate,
            plantId: resourceId,
            visit,
            excludeAssignmentId: id,
          });

    if (conflicts.length > 0 && !input.override_conflicts) {
      return NextResponse.json(
        {
          error: 'This assignment has scheduling conflicts.',
          conflicts_by_date: { [workDate]: conflicts },
        },
        { status: 409 }
      );
    }

    const isOverridden = input.override_conflicts && conflicts.length > 0;
    const { data, error } = await admin
      .from(table)
      .update({
        job_id: job.id,
        work_date: workDate,
        visit_id: visit.id,
        assigned_by: access.userId,
        conflict_override: isOverridden,
        conflict_codes: conflictCodes(conflicts),
        conflict_override_by: isOverridden ? access.userId : null,
        conflict_override_at: isOverridden ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This resource is already assigned to the target visit.' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ assignment: data });
  } catch (error) {
    console.error('Error moving scheduling assignment:', error);
    return NextResponse.json({ error: 'Unable to move this assignment.' }, { status: 500 });
  }
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
