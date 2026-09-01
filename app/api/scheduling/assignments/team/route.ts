import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { assignDayTeamToVisit } from '@/lib/server/scheduling-day-teams';
import { isScheduleDayTeamSlotIndex } from '@/lib/utils/scheduling-day-teams';

const teamAssignSchema = z.object({
  visit_id: z.uuid(),
  slot_index: z.number().int(),
  member_ids: z.array(z.uuid()).optional(),
  member_request_ids: z.record(z.string(), z.uuid()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = teamAssignSchema.safeParse(await request.json());
    if (!parsed.success || !isScheduleDayTeamSlotIndex(parsed.data.slot_index)) {
      return NextResponse.json(
        { error: parsed.error?.issues[0]?.message || 'Drop a team onto a timed visit.' },
        { status: 400 }
      );
    }

    const result = await assignDayTeamToVisit(createAdminClient(), {
      visitId: parsed.data.visit_id,
      slotIndex: parsed.data.slot_index,
      actorUserId: access.userId,
      memberIds: parsed.data.member_ids,
      memberRequestIds: parsed.data.member_request_ids,
    });
    if ('error' in result && 'status' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const status = result.partial_error ? 207 : 200;
    return NextResponse.json({
      assignments: result.assignments,
      skipped: result.skipped,
      already_assigned_count: result.already_assigned_count,
      employee_capacity: result.employee_capacity,
      ...(result.partial_error ? { error: result.partial_error, partial: true } : {}),
    }, { status });
  } catch (error) {
    console.error('Error assigning day team to visit:', error);
    return NextResponse.json(
      {
        error: 'Unable to assign this team. Some members may already be on the visit.',
      },
      { status: 500 }
    );
  }
}
