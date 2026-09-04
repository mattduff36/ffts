import { formatScheduleVisitTime, getScheduleVisitDate } from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleEmployeeDaySession,
  ScheduleOccupancySegment,
  ScheduleOccupancyState,
} from '@/types/scheduling';

export const OCCUPANCY_STRIP_START_MINUTES = 7 * 60;
export const OCCUPANCY_STRIP_END_MINUTES = 17 * 60 + 30;
export const OCCUPANCY_EARLY_BUFFER_END_MINUTES = 8 * 60;
export const OCCUPANCY_AM_END_MINUTES = 12 * 60;
export const OCCUPANCY_PM_END_MINUTES = 16 * 60 + 30;

const DEFAULT_SESSION: Pick<ScheduleEmployeeDaySession, 'am' | 'pm'> = {
  am: 'working',
  pm: 'working',
};

export function getOccupancyVisitMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = formatScheduleVisitTime(value).split(':');
  return Number(hours) * 60 + Number(minutes);
}

function clipToStrip(startMinutes: number, endMinutes: number): {
  startMinutes: number;
  endMinutes: number;
} | null {
  const start = Math.max(startMinutes, OCCUPANCY_STRIP_START_MINUTES);
  const end = Math.min(endMinutes, OCCUPANCY_STRIP_END_MINUTES);
  return end > start ? { startMinutes: start, endMinutes: end } : null;
}

function mergeAdjacentSegments(
  segments: ScheduleOccupancySegment[]
): ScheduleOccupancySegment[] {
  if (segments.length === 0) return [];
  const merged: ScheduleOccupancySegment[] = [{ ...segments[0] }];
  for (const segment of segments.slice(1)) {
    const last = merged[merged.length - 1];
    if (
      segment.state === last.state
      && segment.startMinutes <= last.endMinutes
    ) {
      last.endMinutes = Math.max(last.endMinutes, segment.endMinutes);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged.filter((segment) => segment.endMinutes > segment.startMinutes);
}

function overlayOccupancyState(
  segments: ScheduleOccupancySegment[],
  startMinutes: number,
  endMinutes: number,
  state: ScheduleOccupancyState
): ScheduleOccupancySegment[] {
  const clipped = clipToStrip(startMinutes, endMinutes);
  if (!clipped) return segments;

  const next: ScheduleOccupancySegment[] = [];
  for (const segment of segments) {
    if (
      segment.endMinutes <= clipped.startMinutes
      || segment.startMinutes >= clipped.endMinutes
    ) {
      next.push(segment);
      continue;
    }
    if (segment.startMinutes < clipped.startMinutes) {
      next.push({
        startMinutes: segment.startMinutes,
        endMinutes: clipped.startMinutes,
        state: segment.state,
      });
    }
    next.push({
      startMinutes: Math.max(segment.startMinutes, clipped.startMinutes),
      endMinutes: Math.min(segment.endMinutes, clipped.endMinutes),
      state,
    });
    if (segment.endMinutes > clipped.endMinutes) {
      next.push({
        startMinutes: clipped.endMinutes,
        endMinutes: segment.endMinutes,
        state: segment.state,
      });
    }
  }
  return mergeAdjacentSegments(next);
}

function sessionForEmployee(
  sessions: ScheduleEmployeeDaySession[] | undefined,
  profileId: string,
  workDate: string
): Pick<ScheduleEmployeeDaySession, 'am' | 'pm'> {
  return sessions?.find(
    (session) => session.profile_id === profileId && session.date === workDate
  ) || DEFAULT_SESSION;
}

function formatOccupancyClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function formatOccupancyRange(segment: ScheduleOccupancySegment): string {
  return `${formatOccupancyClock(segment.startMinutes)}–${formatOccupancyClock(segment.endMinutes)}`;
}

export function formatOccupancySummary(segments: ScheduleOccupancySegment[]): string {
  const booked = segments.filter((segment) => segment.state === 'booked');
  if (booked.length > 0) {
    return `Booked ${booked.map(formatOccupancyRange).join(', ')}`;
  }
  const unavailable = segments.filter((segment) => segment.state === 'unavailable');
  if (unavailable.length > 0) {
    return `Unavailable ${unavailable.map(formatOccupancyRange).join(', ')}`;
  }
  return `Available ${formatOccupancyClock(OCCUPANCY_STRIP_START_MINUTES)}–${formatOccupancyClock(OCCUPANCY_STRIP_END_MINUTES)}`;
}

export function mergeTeamOccupancySegments(
  memberSegments: ScheduleOccupancySegment[][]
): ScheduleOccupancySegment[] {
  let segments: ScheduleOccupancySegment[] = [{
    startMinutes: OCCUPANCY_STRIP_START_MINUTES,
    endMinutes: OCCUPANCY_STRIP_END_MINUTES,
    state: 'available',
  }];
  for (const member of memberSegments) {
    for (const segment of member) {
      if (segment.state === 'unavailable') {
        segments = overlayOccupancyState(
          segments,
          segment.startMinutes,
          segment.endMinutes,
          'unavailable'
        );
      }
    }
  }
  for (const member of memberSegments) {
    for (const segment of member) {
      if (segment.state === 'booked') {
        segments = overlayOccupancyState(
          segments,
          segment.startMinutes,
          segment.endMinutes,
          'booked'
        );
      }
    }
  }
  return segments;
}

export function buildEmployeeOccupancySegments(input: {
  profileId: string;
  workDate: string;
  assignments: ScheduleAssignment[];
  sessions?: ScheduleEmployeeDaySession[];
}): ScheduleOccupancySegment[] {
  const session = sessionForEmployee(input.sessions, input.profileId, input.workDate);
  let segments: ScheduleOccupancySegment[] = [{
    startMinutes: OCCUPANCY_STRIP_START_MINUTES,
    endMinutes: OCCUPANCY_STRIP_END_MINUTES,
    state: 'available',
  }];

  if (session.am === 'absent' && session.pm === 'absent') {
    segments = overlayOccupancyState(
      segments,
      OCCUPANCY_STRIP_START_MINUTES,
      OCCUPANCY_STRIP_END_MINUTES,
      'unavailable'
    );
  } else {
    if (session.am !== 'working') {
      segments = overlayOccupancyState(
        segments,
        OCCUPANCY_EARLY_BUFFER_END_MINUTES,
        OCCUPANCY_AM_END_MINUTES,
        'unavailable'
      );
    }
    if (session.pm !== 'working') {
      segments = overlayOccupancyState(
        segments,
        OCCUPANCY_AM_END_MINUTES,
        OCCUPANCY_PM_END_MINUTES,
        'unavailable'
      );
    }
  }

  const matching = input.assignments.filter(
    (assignment) =>
      assignment.resource_type === 'employee'
      && assignment.profile_id === input.profileId
      && assignment.work_date === input.workDate
  );
  if (matching.some((assignment) => !assignment.visit_id)) {
    return overlayOccupancyState(
      segments,
      OCCUPANCY_STRIP_START_MINUTES,
      OCCUPANCY_STRIP_END_MINUTES,
      'booked'
    );
  }

  for (const assignment of matching) {
    const visit = assignment.visit;
    if (
      !visit
      || visit.status === 'cancelled'
      || getScheduleVisitDate(visit.starts_at) !== input.workDate
    ) {
      continue;
    }
    segments = overlayOccupancyState(
      segments,
      getOccupancyVisitMinutes(visit.starts_at),
      getOccupancyVisitMinutes(visit.ends_at),
      'booked'
    );
  }

  return segments;
}
