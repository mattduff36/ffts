import type { ApprovedAbsenceForTimesheet, TimesheetLeaveLabel, TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';

export type DidNotWorkBookingKind = 'sickness' | 'training';
export type DidNotWorkTrainingSession = 'FULL' | 'AM' | 'PM';

export interface TimesheetDidNotWorkBookingInput {
  dayOfWeek: number;
  date: string;
  kind: DidNotWorkBookingKind;
  trainingSession?: DidNotWorkTrainingSession;
}

export interface PendingDidNotWorkBooking extends TimesheetDidNotWorkBookingInput {
  dayName: string;
}

export type PendingDidNotWorkBookingMap = Record<number, PendingDidNotWorkBooking>;

const TRAINING_REASON_COLOR = '#22c55e';

function formatTrainingLabel(session: DidNotWorkTrainingSession | undefined): string {
  if (!session || session === 'FULL') return 'Training';
  return `Training (${session})`;
}

export function isHalfDayTrainingSession(
  session: DidNotWorkTrainingSession | null | undefined
): session is 'AM' | 'PM' {
  return session === 'AM' || session === 'PM';
}

export function formatHalfDayTrainingRemark(session: 'AM' | 'PM'): string {
  return `TRAINING - Half day training (${session})`;
}

export function getHalfDayTrainingRemarkForOffDayState(
  state: TimesheetOffDayState | undefined
): string | null {
  const halfDayTrainingLabel = state?.trainingLabels.find((label) => (
    label.isTraining && isHalfDayTrainingSession(label.session)
  ));

  return isHalfDayTrainingSession(halfDayTrainingLabel?.session)
    ? formatHalfDayTrainingRemark(halfDayTrainingLabel.session)
    : null;
}

function toPendingTrainingLabel(booking: PendingDidNotWorkBooking): TimesheetLeaveLabel {
  const session = booking.trainingSession || 'FULL';
  return {
    absenceId: null,
    reasonName: 'Training',
    label: formatTrainingLabel(session),
    session,
    color: TRAINING_REASON_COLOR,
    isPaid: true,
    isTraining: true,
    isPending: false,
    blocksWorkingEntry: true,
  };
}

export function getPendingDidNotWorkBookingsPayload(
  bookings: PendingDidNotWorkBookingMap
): TimesheetDidNotWorkBookingInput[] {
  return Object.values(bookings)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map(({ dayOfWeek, date, kind, trainingSession }) => ({
      dayOfWeek,
      date,
      kind,
      ...(trainingSession ? { trainingSession } : {}),
    }));
}

export function getPendingDidNotWorkTrainingBooking(
  bookings: PendingDidNotWorkBookingMap,
  dayIndex: number
): PendingDidNotWorkBooking | null {
  const booking = bookings[dayIndex];
  return booking?.kind === 'training' ? booking : null;
}

export function applyPendingTrainingBookingsToOffDayStates(
  states: TimesheetOffDayState[],
  bookings: PendingDidNotWorkBookingMap
): TimesheetOffDayState[] {
  const pendingTrainingByDay = new Map(
    Object.values(bookings)
      .filter((booking) => booking.kind === 'training')
      .map((booking) => [booking.dayOfWeek, booking] as const)
  );

  if (pendingTrainingByDay.size === 0) return states;

  return states.map((state) => {
    const booking = pendingTrainingByDay.get(state.day_of_week);
    if (!booking) return state;

    const existingLabels = state.trainingLabels.filter((label) => label.reasonName !== 'Training');
    const trainingLabels = [...existingLabels, toPendingTrainingLabel(booking)];
    const trainingDisplayRemarks = trainingLabels.map((label) => label.label).join('\n');

    return {
      ...state,
      trainingLabels,
      hasTrainingBooking: true,
      trainingDisplayRemarks,
      trainingReasonColor: state.trainingReasonColor || TRAINING_REASON_COLOR,
    };
  });
}

export function toApprovedAbsenceForPendingBooking(
  booking: PendingDidNotWorkBooking
): ApprovedAbsenceForTimesheet {
  const isTraining = booking.kind === 'training';
  const isHalfDay = isTraining && booking.trainingSession !== undefined && booking.trainingSession !== 'FULL';

  return {
    date: booking.date,
    end_date: null,
    status: 'approved',
    is_half_day: isHalfDay,
    half_day_session: isHalfDay ? booking.trainingSession as 'AM' | 'PM' : null,
    allow_timesheet_work_on_leave: false,
    absence_reasons: {
      name: isTraining ? 'Training' : 'Sickness',
      color: isTraining ? TRAINING_REASON_COLOR : null,
      is_paid: true,
    },
  };
}
