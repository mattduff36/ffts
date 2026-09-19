import { describe, expect, it } from 'vitest';
import {
  DAILY_VISIT_LANE_MIN_HEIGHT,
  getDailyVisitLaneHeight,
  getDailyVisitPlacementWidth,
  getVisitAssignmentColumns,
  getVisitAssignmentRowCount,
} from '@/lib/utils/scheduling-visit-layout';

describe('daily visit assignment layout', () => {
  it('uses two columns for typical daily visit widths', () => {
    expect(getVisitAssignmentColumns(184)).toBe(2);
    expect(getVisitAssignmentColumns(260)).toBe(3);
    expect(getVisitAssignmentColumns(120)).toBe(1);
    expect(getVisitAssignmentColumns()).toBe(3);
  });

  it('sizes empty and sparsely assigned lanes to the current minimum', () => {
    expect(getDailyVisitLaneHeight(0, 184)).toBe(DAILY_VISIT_LANE_MIN_HEIGHT);
    expect(getDailyVisitLaneHeight(2, 184)).toBe(DAILY_VISIT_LANE_MIN_HEIGHT);
    expect(getDailyVisitLaneHeight(3, 184)).toBe(104);
  });

  it('grows the lane so every assignment row stays visible', () => {
    expect(getVisitAssignmentRowCount(8, 184)).toBe(4);
    expect(getDailyVisitLaneHeight(8, 184)).toBeGreaterThan(104);
    expect(getVisitAssignmentRowCount(8, 120)).toBe(8);
    expect(getDailyVisitLaneHeight(8, 120)).toBeGreaterThan(getDailyVisitLaneHeight(8, 184));
  });

  it('keeps a two-hour daily visit at the expected compact width', () => {
    expect(getDailyVisitPlacementWidth({
      startsAt: '2026-01-12T10:00:00.000Z',
      endsAt: '2026-01-12T12:00:00.000Z',
      startHour: 5,
      endHour: 20,
      hourWidth: 96,
      rangeWidth: 1440,
    })).toBe(184);
  });
});
