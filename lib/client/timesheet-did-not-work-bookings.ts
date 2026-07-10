import type { TimesheetDidNotWorkBookingInput } from '@/lib/utils/timesheet-did-not-work-bookings';

interface CommitTimesheetDidNotWorkBookingsResponse {
  success: boolean;
  insertedAbsenceIds: string[];
  existingAbsenceIds: string[];
  notifiedProfileIds: string[];
}

export async function commitTimesheetDidNotWorkBookings(
  timesheetId: string,
  bookings: TimesheetDidNotWorkBookingInput[]
): Promise<CommitTimesheetDidNotWorkBookingsResponse> {
  if (bookings.length === 0) {
    return {
      success: true,
      insertedAbsenceIds: [],
      existingAbsenceIds: [],
      notifiedProfileIds: [],
    };
  }

  const response = await fetch(`/api/timesheets/${timesheetId}/did-not-work-bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bookings }),
  });

  const payload = await response.json().catch(() => null) as Partial<CommitTimesheetDidNotWorkBookingsResponse> & {
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to create Did Not Work absence bookings');
  }

  return {
    success: Boolean(payload?.success),
    insertedAbsenceIds: payload?.insertedAbsenceIds || [],
    existingAbsenceIds: payload?.existingAbsenceIds || [],
    notifiedProfileIds: payload?.notifiedProfileIds || [],
  };
}
