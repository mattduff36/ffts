import { describe, expect, it } from 'vitest';
import {
  canEmployeeSelfBookAbsenceOnDate,
  canEmployeeSelfBookAbsenceRange,
  getAbsenceWeekEndingSunday,
  getEmployeeAbsenceSelfServiceDeadline,
  getEmployeeAbsenceSelfServiceDeadlineForRange,
} from '@/lib/utils/absence-self-service-deadline';

describe('employee absence self-service deadline', () => {
  it('allows the client example through the Monday after week ending', () => {
    expect(getAbsenceWeekEndingSunday('2026-04-29')).toBe('2026-05-03');
    expect(getEmployeeAbsenceSelfServiceDeadline('2026-04-29')).toBe('2026-05-04');
    expect(canEmployeeSelfBookAbsenceOnDate('2026-04-29', '2026-05-04')).toBe(true);
    expect(canEmployeeSelfBookAbsenceOnDate('2026-04-29', '2026-05-05')).toBe(false);
  });

  it('uses the earliest deadline when a range spans weeks', () => {
    expect(getEmployeeAbsenceSelfServiceDeadlineForRange('2026-05-01', '2026-05-04')).toBe('2026-05-04');
    expect(canEmployeeSelfBookAbsenceRange('2026-05-01', '2026-05-04', '2026-05-04')).toBe(true);
    expect(canEmployeeSelfBookAbsenceRange('2026-05-01', '2026-05-04', '2026-05-05')).toBe(false);
  });
});
