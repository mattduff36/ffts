import { NextResponse } from 'next/server';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import { loadScheduleVisitBacklog } from '@/lib/server/scheduling-visit-backlog';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const items = await loadScheduleVisitBacklog(createAdminClient());
    return NextResponse.json({ items });
  } catch (error) {
    console.error('Error loading returned scheduling visits:', error);
    return NextResponse.json(
      { error: 'Unable to load returned visits.' },
      { status: 500 }
    );
  }
}
