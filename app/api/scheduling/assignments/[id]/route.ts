import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEmployeeCapacityForDates } from '@/lib/server/scheduling-assignment-capacity';
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
        .select(`id, ${resourceColumn}, work_date`)
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
    const previousWorkDate = String(
      (assignmentResult.data as { work_date: string }).work_date
    );
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

    const { data: rows, error } = await admin.rpc('move_schedule_assignment_v1', {
      p_assignment_id: id,
      p_resource_type: input.resource_type,
      p_visit_id: visit.id,
      p_override_conflicts: input.override_conflicts,
      p_conflict_codes: conflictCodes(conflicts),
      p_actor_user_id: access.userId,
    });
    if (error) {
      if (error.code === '23505' || error.message.includes('RESOURCE_OVERLAP')) {
        return NextResponse.json(
          {
            error: 'This resource is already assigned to the target visit.',
            conflicts_by_date: {
              [workDate]: [{
                code: input.resource_type === 'employee'
                  ? 'employee_double_booked'
                  : 'plant_double_booked',
                severity: 'warning',
                message: 'This resource is already assigned during an overlapping visit.',
              }],
            },
          },
          { status: 409 }
        );
      }
      if (error.code === 'P0001') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const moved = rows?.[0];
    if (!moved) throw new Error('Assignment move returned no result.');
    const capacity = await loadEmployeeCapacityForDates(
      admin,
      Array.from(new Set([previousWorkDate, workDate]))
    );
    return NextResponse.json({
      assignment: {
        id: moved.assignment_id,
        job_id: moved.job_id,
        work_date: moved.work_date,
        visit_id: moved.visit_id,
        notes: moved.notes,
        conflict_override: moved.conflict_override,
        conflict_codes: moved.conflict_codes,
        conflict_override_by: moved.conflict_override_by,
        conflict_override_at: moved.conflict_override_at,
        assigned_by: moved.assigned_by,
        created_at: moved.created_at,
        updated_at: moved.updated_at,
        ...(input.resource_type === 'employee'
          ? { profile_id: moved.profile_id }
          : { plant_id: moved.plant_id }),
      },
      employee_capacity: capacity,
    });
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
    const admin = createAdminClient();
    const table =
      resourceType === 'employee' ? 'schedule_employee_assignments' : 'schedule_plant_assignments';
    const existing = await admin
      .from(table)
      .select('id, work_date')
      .eq('id', id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    const { error } = await admin.from(table).delete().eq('id', id);
    if (error) throw error;
    const capacity = await loadEmployeeCapacityForDates(admin, [String(existing.data.work_date)]);
    return NextResponse.json({ success: true, employee_capacity: capacity });
  } catch (error) {
    console.error('Error deleting scheduling assignment:', error);
    return NextResponse.json({ error: 'Unable to remove this assignment.' }, { status: 500 });
  }
}
