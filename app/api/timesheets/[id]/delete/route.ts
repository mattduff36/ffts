import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import {
  deleteTimesheetWithOptionalLeaveBookings,
  listTimesheetAssociatedLeaveBookings,
  TimesheetDeleteError,
} from '@/lib/server/timesheet-delete';

interface DeleteTimesheetRequestBody {
  deleteAssociatedLeaveBookings?: boolean;
  associatedLeaveBookingIdsToDelete?: string[];
}

async function requireTimesheetDeleteAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const canManageTimesheets = await canEffectiveRoleAccessModule('approvals');
  if (!canManageTimesheets) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Forbidden: Approvals access required' },
        { status: 403 }
      ),
    };
  }

  return { user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireTimesheetDeleteAccess();
    if ('errorResponse' in access) return access.errorResponse;

    const timesheetId = (await params).id;
    const admin = createAdminClient();
    const associatedLeaveBookings = await listTimesheetAssociatedLeaveBookings(admin, timesheetId);

    return NextResponse.json({
      associatedLeaveBookings,
    });
  } catch (error) {
    const status = error instanceof TimesheetDeleteError ? error.status : 500;
    const message = error instanceof TimesheetDeleteError ? error.message : 'Internal server error';

    if (status >= 500) {
      console.error('Error checking timesheet leave bookings:', error);
      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/timesheets/[id]/delete',
        additionalData: {
          endpoint: '/api/timesheets/[id]/delete',
          method: 'GET',
        },
      });
    }

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireTimesheetDeleteAccess();
    if ('errorResponse' in access) return access.errorResponse;

    const timesheetId = (await params).id;
    const body = await request.json().catch(() => ({})) as DeleteTimesheetRequestBody;
    const admin = createAdminClient();

    const result = await deleteTimesheetWithOptionalLeaveBookings(admin, {
      timesheetId,
      associatedLeaveBookingIdsToDelete: Array.isArray(body.associatedLeaveBookingIdsToDelete)
        ? body.associatedLeaveBookingIdsToDelete.filter((id): id is string => typeof id === 'string')
        : [],
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error deleting timesheet:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/delete',
      additionalData: {
        endpoint: '/api/timesheets/[id]/delete',
        method: 'DELETE',
      },
    });

    if (error instanceof TimesheetDeleteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

