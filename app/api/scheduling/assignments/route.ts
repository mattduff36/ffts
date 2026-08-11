import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { loadEmployeeCapacityForDates } from '@/lib/server/scheduling-assignment-capacity';
import { mapScheduleVisitTransitionError } from '@/lib/server/scheduling-visit-backlog';
import {
  conflictCodes,
  detectEmployeeConflicts,
  detectPlantConflicts,
  isDateWithinRange,
} from '@/lib/server/scheduling-conflicts';
import { getScheduleVisitDate } from '@/lib/utils/scheduling';
import type { ScheduleVisit } from '@/types/scheduling';

const assignmentSchema = z
  .object({
    job_id: z.uuid(),
    visit_id: z.uuid().optional(),
    resource_type: z.enum(['employee', 'plant']),
    resource_id: z.uuid(),
    work_dates: z.array(z.iso.date()).max(31).default([]),
    notes: z.string().trim().max(2000).nullish(),
    override_conflicts: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.visit_id) || value.work_dates.length > 0, {
    message: 'Choose a visit or at least one work date.',
    path: ['work_dates'],
  });

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = assignmentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid assignment.' },
        { status: 400 }
      );
    }

    const input = { ...parsed.data, work_dates: Array.from(new Set(parsed.data.work_dates)).sort() };
    const admin = createAdminClient();
    const jobResult = await admin
      .from('schedule_jobs')
      .select('id, start_date, end_date')
      .eq('id', input.job_id)
      .maybeSingle();
    if (jobResult.error) throw jobResult.error;
    const job = jobResult.data;
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    let visit: ScheduleVisit | null = null;
    if (input.visit_id) {
      const visitResult = await admin
        .from('schedule_visits')
        .select('*')
        .eq('id', input.visit_id)
        .maybeSingle();
      if (visitResult.error) throw visitResult.error;
      visit = visitResult.data as ScheduleVisit | null;
      if (!visit || visit.job_id !== input.job_id || visit.status === 'cancelled') {
        return NextResponse.json({ error: 'Scheduling visit not found.' }, { status: 404 });
      }
      input.work_dates = [getScheduleVisitDate(visit.starts_at)];
    }

    if (
      input.work_dates.some(
        (workDate) => !isDateWithinRange(workDate, job.start_date, job.end_date)
      )
    ) {
      return NextResponse.json(
        { error: 'Assignments must fall within the job date range.' },
        { status: 400 }
      );
    }

    const conflictEntries = await Promise.all(
      input.work_dates.map(async (workDate) => {
        const conflicts =
          input.resource_type === 'employee'
            ? await detectEmployeeConflicts(admin, {
                jobId: input.job_id,
                workDate,
                profileId: input.resource_id,
                visit: visit || undefined,
              })
            : await detectPlantConflicts(admin, {
                jobId: input.job_id,
                workDate,
                plantId: input.resource_id,
                visit: visit || undefined,
              });
        return [workDate, conflicts] as const;
      })
    );
    const conflictsByDate = Object.fromEntries(
      conflictEntries.filter(([, conflicts]) => conflicts.length > 0)
    );

    if (Object.keys(conflictsByDate).length > 0 && !input.override_conflicts) {
      return NextResponse.json(
        {
          error: 'This assignment has scheduling conflicts.',
          conflicts_by_date: conflictsByDate,
        },
        { status: 409 }
      );
    }

    // All creates use a single transactional RPC so multi-date requests are all-or-nothing.
    const conflictCodesByDate = Object.fromEntries(
      input.work_dates.map((workDate) => [
        workDate,
        conflictCodes(conflictsByDate[workDate] || []),
      ])
    );
    const { data: rows, error } = await admin.rpc('create_schedule_assignments_bulk_v1', {
      p_job_id: input.job_id,
      p_visit_id: visit?.id || null,
      p_resource_type: input.resource_type,
      p_resource_id: input.resource_id,
      p_work_dates: input.work_dates,
      p_notes: input.notes || null,
      p_override_conflicts: input.override_conflicts,
      p_conflict_codes_by_date: conflictCodesByDate,
      p_actor_user_id: access.userId,
    });
    if (error) {
      if (error.code === '23505' || error.message.includes('RESOURCE_OVERLAP')) {
        return NextResponse.json(
          {
            error: visit
              ? 'This resource is already assigned during an overlapping visit.'
              : 'This resource is already assigned to the job on one of those dates.',
            conflicts_by_date: Object.fromEntries(
              input.work_dates.map((workDate) => [
                workDate,
                [{
                  code: input.resource_type === 'employee'
                    ? 'employee_double_booked'
                    : 'plant_double_booked',
                  severity: 'warning',
                  message: visit
                    ? 'This resource is already assigned during an overlapping visit.'
                    : 'This resource is already assigned on this date.',
                }],
              ])
            ),
          },
          { status: 409 }
        );
      }
      if (error.code === 'P0001') {
        const mapped = mapScheduleVisitTransitionError(error);
        if (mapped?.code === 'visit_queued') {
          return NextResponse.json(
            { error: mapped.message, code: mapped.code },
            { status: mapped.status }
          );
        }
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    type CreatedAssignmentRow = {
      assignment_id: string;
      job_id: string;
      work_date: string;
      visit_id: string | null;
      notes: string | null;
      conflict_override: boolean;
      conflict_codes: string[];
      conflict_override_by: string | null;
      conflict_override_at: string | null;
      assigned_by: string | null;
      created_at: string;
      updated_at: string;
      profile_id: string | null;
      plant_id: string | null;
    };
    const createdRows = (rows || []) as CreatedAssignmentRow[];
    const createdAssignments = createdRows.map((created) => ({
      id: created.assignment_id,
      job_id: created.job_id,
      work_date: created.work_date,
      visit_id: created.visit_id,
      notes: created.notes,
      conflict_override: created.conflict_override,
      conflict_codes: created.conflict_codes,
      conflict_override_by: created.conflict_override_by,
      conflict_override_at: created.conflict_override_at,
      assigned_by: created.assigned_by,
      created_at: created.created_at,
      updated_at: created.updated_at,
      resource_type: input.resource_type,
      ...(input.resource_type === 'employee'
        ? { profile_id: created.profile_id }
        : { plant_id: created.plant_id }),
    }));
    if (createdAssignments.length === 0) {
      throw new Error('Assignment creation returned no result.');
    }

    const capacity = await loadEmployeeCapacityForDates(admin, input.work_dates);
    return NextResponse.json(
      { assignments: createdAssignments, employee_capacity: capacity },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating scheduling assignment:', error);
    return NextResponse.json({ error: 'Unable to create this assignment.' }, { status: 500 });
  }
}
