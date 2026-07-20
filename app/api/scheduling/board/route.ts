import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadSchedulingBoard } from '@/lib/server/scheduling-board';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { getSchedulingWeek } from '@/lib/utils/scheduling';

function isSchedulingSchemaMissing(error: unknown): boolean {
  const normalized = error as { code?: string; message?: string };
  const message = normalized?.message?.toLowerCase() || '';
  return (
    normalized?.code === '42P01' ||
    normalized?.code === 'PGRST205' ||
    (message.includes('schedule_') &&
      (message.includes('does not exist') || message.includes('schema cache')))
  );
}

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
    if (isSchedulingSchemaMissing(error)) {
      return NextResponse.json(
        {
          error: 'Scheduling setup is incomplete. Run the scheduling module migration and try again.',
          code: 'SCHEDULING_NOT_READY',
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Unable to load the scheduling board.' }, { status: 500 });
  }
}
