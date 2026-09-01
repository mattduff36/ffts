import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { mapScheduleVisitTransitionError } from '@/lib/server/scheduling-visit-backlog';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  EnqueueScheduleVisitResult,
  ScheduleVisitBacklogPreview,
} from '@/types/scheduling';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const enqueueSchema = z.object({
  request_id: z.uuid(),
  expected_fingerprint: z.string().trim().min(1).max(128),
});

function firstRow<T>(data: T | T[] | null): T | null {
  if (!data) return null;
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const admin = createAdminClient();
    const result = await admin.rpc('preview_schedule_visit_backlog_v1', {
      p_visit_id: id,
    });
    if (result.error) throw result.error;
    const preview = firstRow(
      result.data as ScheduleVisitBacklogPreview | ScheduleVisitBacklogPreview[] | null
    );
    if (!preview) {
      return NextResponse.json({ error: 'Scheduling visit not found.' }, { status: 404 });
    }
    return NextResponse.json({ preview });
  } catch (error) {
    const mapped = mapScheduleVisitTransitionError(error as { code?: string; message?: string });
    if (mapped) {
      return NextResponse.json(
        { error: mapped.message, code: mapped.code },
        { status: mapped.status }
      );
    }
    console.error('Error previewing scheduling visit return:', error);
    return NextResponse.json(
      { error: 'Unable to review this visit before returning it to Jobs.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = enqueueSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid visit return request.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const admin = createAdminClient();
    const result = await admin.rpc('enqueue_schedule_visit_v1', {
      p_request_id: parsed.data.request_id,
      p_visit_id: id,
      p_expected_fingerprint: parsed.data.expected_fingerprint,
      p_actor_user_id: access.userId,
    });
    if (result.error) {
      const mapped = mapScheduleVisitTransitionError(result.error);
      if (mapped) {
        return NextResponse.json(
          { error: mapped.message, code: mapped.code },
          { status: mapped.status }
        );
      }
      throw result.error;
    }

    const transition = firstRow(
      result.data as EnqueueScheduleVisitResult | EnqueueScheduleVisitResult[] | null
    );
    if (!transition) {
      throw new Error('Visit return did not produce a transition result.');
    }
    return NextResponse.json({
      transition,
    });
  } catch (error) {
    const mapped = mapScheduleVisitTransitionError(error as { code?: string; message?: string });
    if (mapped) {
      return NextResponse.json(
        { error: mapped.message, code: mapped.code },
        { status: mapped.status }
      );
    }
    console.error('Error returning scheduling visit to Jobs:', error);
    return NextResponse.json(
      { error: 'Unable to return this visit to Jobs.' },
      { status: 500 }
    );
  }
}
