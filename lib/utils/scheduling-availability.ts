import { getScheduleVisitDate, scheduleVisitIntervalsOverlap } from '@/lib/utils/scheduling';
import type {
  ScheduleAssignment,
  ScheduleResourceType,
  ScheduleVisit,
} from '@/types/scheduling';

export interface ScheduleResourceIdentity {
  type: ScheduleResourceType;
  id: string;
}

function getAssignmentResourceId(assignment: ScheduleAssignment): string {
  return assignment.resource_type === 'employee'
    ? assignment.profile_id
    : assignment.plant_id;
}

export function doesAssignmentOverlapVisit(
  assignment: ScheduleAssignment,
  visit: ScheduleVisit
): boolean {
  if (assignment.visit?.status === 'cancelled') return false;
  if (assignment.visit) {
    return scheduleVisitIntervalsOverlap(assignment.visit, visit);
  }

  return assignment.work_date === getScheduleVisitDate(visit.starts_at);
}

export function isResourceUnavailableForVisit(
  resource: ScheduleResourceIdentity,
  assignments: ScheduleAssignment[],
  visit: ScheduleVisit
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.resource_type === resource.type
      && getAssignmentResourceId(assignment) === resource.id
      && doesAssignmentOverlapVisit(assignment, visit)
  );
}
