import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import {
  mapDayTeamRpcError,
} from '@/lib/server/scheduling-day-teams';
import { isScheduleDayTeamSlotIndex } from '@/lib/utils/scheduling-day-teams';

const membershipSchema = z.object({
  work_date: z.iso.date(),
  slot_index: z.number().int(),
  profile_id: z.uuid().optional(),
  plant_id: z.uuid().optional(),
}).superRefine((value, ctx) => {
  const hasEmployee = Boolean(value.profile_id);
  const hasPlant = Boolean(value.plant_id);
  if (hasEmployee === hasPlant) {
    ctx.addIssue({
      code: 'custom',
      message: hasEmployee
        ? 'Choose either an employee or a plant.'
        : 'Choose a valid team member.',
    });
  }
});

function membershipFromSearch(url: URL) {
  const profileId = url.searchParams.get('profile_id');
  const plantId = url.searchParams.get('plant_id');
  return {
    work_date: url.searchParams.get('work_date'),
    slot_index: Number(url.searchParams.get('slot_index')),
    ...(profileId ? { profile_id: profileId } : {}),
    ...(plantId ? { plant_id: plantId } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = membershipSchema.safeParse(await request.json());
    if (!parsed.success || !isScheduleDayTeamSlotIndex(parsed.data.slot_index)) {
      const looksLikePlant = Boolean(
        parsed.success ? parsed.data.plant_id : false
      );
      return NextResponse.json(
        {
          error: parsed.error?.issues[0]?.message
            || (looksLikePlant
              ? 'Choose a valid team and plant.'
              : 'Choose a valid team and employee.'),
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    if (parsed.data.plant_id) {
      const { data, error } = await admin.rpc('add_schedule_day_team_plant_v1', {
        p_work_date: parsed.data.work_date,
        p_slot_index: parsed.data.slot_index,
        p_plant_id: parsed.data.plant_id,
        p_actor_user_id: access.userId,
      });
      if (error) {
        const mapped = mapDayTeamRpcError(error);
        if (mapped) {
          return NextResponse.json({ error: mapped.error }, { status: mapped.status });
        }
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      return NextResponse.json({ plant: row }, { status: 201 });
    }

    const { data, error } = await admin.rpc('add_schedule_day_team_member_v1', {
      p_work_date: parsed.data.work_date,
      p_slot_index: parsed.data.slot_index,
      p_profile_id: parsed.data.profile_id,
      p_actor_user_id: access.userId,
    });
    if (error) {
      const mapped = mapDayTeamRpcError(error);
      if (mapped) {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ member: row }, { status: 201 });
  } catch (error) {
    console.error('Error adding schedule day team member:', error);
    return NextResponse.json({ error: 'Unable to update this team.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const url = new URL(request.url);
    const parsed = membershipSchema.safeParse(membershipFromSearch(url));
    if (!parsed.success || !isScheduleDayTeamSlotIndex(parsed.data.slot_index)) {
      return NextResponse.json(
        {
          error: parsed.error?.issues[0]?.message
            || 'Choose a valid team member to remove.',
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const confirmedAssignments = parsed.data.profile_id
      ? z.array(z.uuid()).max(1000).safeParse(
          (() => {
            try { return JSON.parse(url.searchParams.get('assignment_ids') || 'null'); }
            catch { return null; }
          })()
        )
      : null;
    if (parsed.data.profile_id && !confirmedAssignments?.success) {
      return NextResponse.json(
        { error: 'Review and confirm this employee’s day assignments before removing them.' },
        { status: 400 }
      );
    }
    const { data, error } = parsed.data.plant_id
      ? await admin.rpc('remove_schedule_day_team_plant_v1', {
          p_work_date: parsed.data.work_date,
          p_slot_index: parsed.data.slot_index,
          p_plant_id: parsed.data.plant_id,
          p_actor_user_id: access.userId,
        })
      : await admin.rpc('remove_schedule_day_team_member_with_assignments_v1', {
          p_work_date: parsed.data.work_date,
          p_slot_index: parsed.data.slot_index,
          p_profile_id: parsed.data.profile_id,
          p_actor_user_id: access.userId,
          p_assignment_ids: confirmedAssignments?.success ? confirmedAssignments.data : [],
        });
    if (error) {
      if (error.code === 'PGRST202' && parsed.data.profile_id) {
        console.error('Atomic day-team removal RPC is not installed:', error.code);
        return NextResponse.json(
          { error: 'Safe team removal is not available yet. The scheduling database update must be installed.' },
          { status: 409 }
        );
      }
      const mapped = mapDayTeamRpcError(error);
      if (mapped) {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      throw error;
    }
    if (parsed.data.profile_id) {
      const confirmation = z.array(z.object({
        success: z.literal(true),
        removed_assignment_ids: z.array(z.uuid()),
      })).length(1).safeParse(data);
      const expected = confirmedAssignments?.success
        ? [...new Set(confirmedAssignments.data.map((id) => id.toLowerCase()))].sort()
        : [];
      if (!confirmation.success
        || JSON.stringify(confirmation.data[0].removed_assignment_ids.map((id) => id.toLowerCase()).sort())
          !== JSON.stringify(expected)) {
        throw new Error('Atomic day-team removal returned an invalid assignment confirmation.');
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing schedule day team member:', error);
    return NextResponse.json({ error: 'Unable to update this team.' }, { status: 500 });
  }
}
