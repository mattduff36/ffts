import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  commitTimesheetDidNotWorkBookings,
  TimesheetDidNotWorkBookingError,
} from '@/lib/server/timesheet-did-not-work-bookings';
import type { TimesheetDidNotWorkBookingInput } from '@/lib/utils/timesheet-did-not-work-bookings';

function canManageTimesheetsForOtherUsers(role: Awaited<ReturnType<typeof getEffectiveRole>>): boolean {
  const roleClass = (role?.role_class || '').toLowerCase();
  const roleName = (role?.role_name || '').toLowerCase();
  return Boolean(
    role?.is_super_admin ||
      role?.is_manager_admin ||
      roleClass === 'admin' ||
      roleClass === 'manager' ||
      roleName.includes('admin') ||
      roleName.includes('manager')
  );
}

function isBookingInput(value: unknown): value is TimesheetDidNotWorkBookingInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TimesheetDidNotWorkBookingInput>;
  return (
    typeof candidate.dayOfWeek === 'number' &&
    typeof candidate.date === 'string' &&
    (candidate.kind === 'sickness' || candidate.kind === 'training') &&
    (
      candidate.trainingSession === undefined ||
      candidate.trainingSession === 'FULL' ||
      candidate.trainingSession === 'AM' ||
      candidate.trainingSession === 'PM'
    )
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as { bookings?: unknown } | null;
    const bookings = Array.isArray(body?.bookings) ? body.bookings : [];
    if (!bookings.every(isBookingInput)) {
      return NextResponse.json({ error: 'Invalid Did Not Work booking payload' }, { status: 400 });
    }

    const { id: timesheetId } = await params;
    const role = await getEffectiveRole();
    const result = await commitTimesheetDidNotWorkBookings(createAdminClient(), {
      actorUserId: user.id,
      timesheetId,
      canManageOtherUsers: canManageTimesheetsForOtherUsers(role),
      bookings,
    });

    return NextResponse.json({
      success: true,
      insertedAbsenceIds: result.insertedAbsenceIds,
      existingAbsenceIds: result.existingAbsenceIds,
      notifiedProfileIds: result.notifiedProfileIds,
    });
  } catch (error) {
    if (error instanceof TimesheetDidNotWorkBookingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error('Error creating Did Not Work bookings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create Did Not Work bookings' },
      { status: 500 }
    );
  }
}
