import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadSchedulingBoard } from '@/lib/server/scheduling-board';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { getSchedulingWeek } from '@/lib/utils/scheduling';

export async function GET(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const week = getSchedulingWeek(new URL(request.url).searchParams.get('week_start'));
    const payload = await loadSchedulingBoard(createAdminClient(), week.start, week.end);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error loading scheduling board:', error);
    return NextResponse.json({ error: 'Unable to load the scheduling board.' }, { status: 500 });
  }
}
