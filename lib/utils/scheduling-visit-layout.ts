import { formatScheduleVisitTime } from '@/lib/utils/scheduling';

export const VISIT_ASSIGNMENT_WIDE_CARD_MIN = 260;
export const VISIT_ASSIGNMENT_MEDIUM_CARD_MIN = 140;
export const DAILY_VISIT_MIN_WIDTH = 48;
export const DAILY_VISIT_LANE_MIN_HEIGHT = 82;
export const VISIT_CARD_CHROME_HEIGHT = 60;
export const VISIT_ASSIGNMENT_ROW_HEIGHT = 20;
export const VISIT_ASSIGNMENT_ROW_GAP = 4;

function getVisitClockMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = formatScheduleVisitTime(value).split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function getVisitAssignmentColumns(cardWidth?: number): number {
  if (cardWidth === undefined || cardWidth >= VISIT_ASSIGNMENT_WIDE_CARD_MIN) return 3;
  if (cardWidth >= VISIT_ASSIGNMENT_MEDIUM_CARD_MIN) return 2;
  return 1;
}

export function getVisitAssignmentRowCount(
  assignmentCount: number,
  cardWidth?: number
): number {
  if (assignmentCount <= 0) return 0;
  return Math.ceil(assignmentCount / getVisitAssignmentColumns(cardWidth));
}

export function getDailyVisitLaneHeight(
  assignmentCount: number,
  cardWidth?: number
): number {
  const rows = getVisitAssignmentRowCount(assignmentCount, cardWidth);
  const assignmentBlock = rows === 0
    ? 0
    : rows * VISIT_ASSIGNMENT_ROW_HEIGHT + (rows - 1) * VISIT_ASSIGNMENT_ROW_GAP;
  return Math.max(DAILY_VISIT_LANE_MIN_HEIGHT, VISIT_CARD_CHROME_HEIGHT + assignmentBlock);
}

export function getDailyVisitPlacementWidth(input: {
  startsAt: string;
  endsAt: string;
  startHour: number;
  endHour: number;
  hourWidth: number;
  rangeWidth: number;
}): number {
  const rangeStartMinutes = input.startHour * 60;
  const startsAt = Math.max(rangeStartMinutes, getVisitClockMinutes(input.startsAt));
  const endsAt = Math.min(input.endHour * 60, getVisitClockMinutes(input.endsAt));
  const left = ((startsAt - rangeStartMinutes) / 60) * input.hourWidth + 4;
  const availableWidth = input.rangeWidth - left - 4;
  return Math.min(
    availableWidth,
    Math.max(
      DAILY_VISIT_MIN_WIDTH,
      ((Math.max(endsAt, startsAt + 30) - startsAt) / 60) * input.hourWidth - 8
    )
  );
}
