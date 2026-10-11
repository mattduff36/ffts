import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadSchedulingSelf } from '@/lib/server/scheduling-board';
import { requireSchedulingSelfAccess } from '@/lib/server/scheduling-auth';
import { getSchedulingWeek } from '@/lib/utils/scheduling';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const access = await requireSchedulingSelfAccess();
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status, headers: PRIVATE_NO_STORE }
      );
    }
    if (!access.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: PRIVATE_NO_STORE }
      );
    }

    const week = getSchedulingWeek(new URL(request.url).searchParams.get('week_start'));
    const payload = await loadSchedulingSelf(
      createAdminClient(),
      access.userId,
      week.start,
      week.end
    );
    return NextResponse.json(payload, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    console.error('Error loading employee schedule:', error);
    return NextResponse.json(
      { error: 'Unable to load your schedule.' },
      { status: 500, headers: PRIVATE_NO_STORE }
    );
  }
}
