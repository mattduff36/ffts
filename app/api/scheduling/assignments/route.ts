import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
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

    const now = new Date().toISOString();
    const rows = input.work_dates.map((workDate) => {
      const conflicts = conflictsByDate[workDate] || [];
      const isOverridden = input.override_conflicts && conflicts.length > 0;
      return {
        job_id: input.job_id,
        work_date: workDate,
        notes: input.notes || null,
        conflict_override: isOverridden,
        conflict_codes: conflictCodes(conflicts),
        conflict_override_by: isOverridden ? access.userId : null,
        conflict_override_at: isOverridden ? now : null,
        assigned_by: access.userId,
        visit_id: visit?.id || null,
        ...(input.resource_type === 'employee'
          ? { profile_id: input.resource_id }
          : { plant_id: input.resource_id }),
      };
    });

    const table =
      input.resource_type === 'employee'
        ? 'schedule_employee_assignments'
        : 'schedule_plant_assignments';
    const { data, error } = await admin.from(table).insert(rows).select();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This resource is already assigned to the job on one of those dates.' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ assignments: data || [] }, { status: 201 });
  } catch (error) {
    console.error('Error creating scheduling assignment:', error);
    return NextResponse.json({ error: 'Unable to create this assignment.' }, { status: 500 });
  }
}
