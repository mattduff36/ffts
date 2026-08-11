import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { mapScheduleVisitTransitionError } from '@/lib/server/scheduling-visit-backlog';
import { loadTagsForScheduleJob } from '@/lib/server/scheduling-tags';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ScheduleJob, ScheduleQueuedVisitResult, ScheduleVisit } from '@/types/scheduling';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const scheduleSchema = z
  .object({
    request_id: z.uuid(),
    starts_at: z.iso.datetime({ offset: true }),
  });

function firstRow<T>(data: T | T[] | null): T | null {
  if (!data) return null;
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = scheduleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid visit schedule request.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const admin = createAdminClient();
    const transitionResult = await admin.rpc('schedule_queued_visit_v1', {
      p_request_id: parsed.data.request_id,
      p_visit_id: id,
      p_starts_at: parsed.data.starts_at,
      p_actor_user_id: access.userId,
    });
    if (transitionResult.error) {
      const mapped = mapScheduleVisitTransitionError(transitionResult.error);
      if (mapped) {
        return NextResponse.json(
          { error: mapped.message, code: mapped.code },
          { status: mapped.status }
        );
      }
      throw transitionResult.error;
    }

    const transition = firstRow(
      transitionResult.data as Array<{ visit_id: string; job_id: string }> | null
    );
    if (!transition) {
      throw new Error('Visit scheduling did not produce a transition result.');
    }

    const [visitResult, jobResult, tags] = await Promise.all([
      admin.from('schedule_visits').select('*').eq('id', transition.visit_id).single(),
      admin
        .from('schedule_jobs')
        .select('*, customer:customers(company_name)')
        .eq('id', transition.job_id)
        .single(),
      loadTagsForScheduleJob(admin, transition.job_id),
    ]);
    if (visitResult.error) throw visitResult.error;
    if (jobResult.error) throw jobResult.error;

    const customer = Array.isArray(jobResult.data.customer)
      ? jobResult.data.customer[0]
      : jobResult.data.customer;
    const payload: ScheduleQueuedVisitResult = {
      visit: visitResult.data as ScheduleVisit,
      job: {
        ...jobResult.data,
        customer_name: customer?.company_name || null,
        tags,
      } as ScheduleJob,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const mapped = mapScheduleVisitTransitionError(error as { code?: string; message?: string });
    if (mapped) {
      return NextResponse.json(
        { error: mapped.message, code: mapped.code },
        { status: mapped.status }
      );
    }
    console.error('Error scheduling returned visit:', error);
    return NextResponse.json(
      { error: 'Unable to schedule this returned visit.' },
      { status: 500 }
    );
  }
}
