import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadSchedulingSelf } from '@/lib/server/scheduling-board';
import { requireSchedulingAccess } from '@/lib/server/scheduling-auth';
import { getSchedulingWeek } from '@/lib/utils/scheduling';

export async function GET(request: NextRequest) {
  try {
    const access = await requireSchedulingAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const week = getSchedulingWeek(new URL(request.url).searchParams.get('week_start'));
    const payload = await loadSchedulingSelf(createAdminClient(), access.userId, week.start, week.end);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error loading employee schedule:', error);
    return NextResponse.json({ error: 'Unable to load your schedule.' }, { status: 500 });
  }
}
