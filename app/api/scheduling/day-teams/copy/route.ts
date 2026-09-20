import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { copyScheduleDayTeamMembers } from '@/lib/server/scheduling-day-teams';

const copySchema = z.object({
  from_date: z.iso.date(),
  to_date: z.iso.date(),
});

export async function POST(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = copySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Choose a date to copy from.' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const result = await copyScheduleDayTeamMembers(admin, {
      fromDate: parsed.data.from_date,
      toDate: parsed.data.to_date,
      actorUserId: access.userId,
    });
    if ('status' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error copying schedule day teams:', error);
    return NextResponse.json({ error: 'Unable to copy these teams.' }, { status: 500 });
  }
}
