import { describe, expect, it } from 'vitest';
import {
  countAssignedStaffForJobDate,
  formatStaffingBadge,
  normalizeRequiredStaffCount,
  scheduleEmployeeKindFromRole,
} from '@/lib/utils/scheduling-staffing';

describe('scheduling staffing helpers', () => {
  it('sched-staff-required-persist normalizes quote, job, and quick-add staff counts', () => {
    expect(normalizeRequiredStaffCount('')).toBeNull();
    expect(normalizeRequiredStaffCount(null)).toBeNull();
    expect(normalizeRequiredStaffCount(3)).toBe(3);
    expect(normalizeRequiredStaffCount('4')).toBe(4);
    expect(Number.isNaN(normalizeRequiredStaffCount(0))).toBe(true);
    expect(Number.isNaN(normalizeRequiredStaffCount(21))).toBe(true);
  });

  it('sched-staff-badge-ratio shows assigned/required and short tint', () => {
    expect(formatStaffingBadge(0, null)).toBeNull();
    expect(formatStaffingBadge(2, null)).toEqual({ label: '2', short: false });
    expect(formatStaffingBadge(2, 3)).toEqual({ label: '2/3', short: true });
    expect(formatStaffingBadge(3, 3)).toEqual({ label: '3/3', short: false });
  });

  it('counts unique employees on that job and date only', () => {
    expect(countAssignedStaffForJobDate({
      jobId: 'job-1',
      workDate: '2026-09-01',
      assignments: [
        { job_id: 'job-1', work_date: '2026-09-01', resource_type: 'employee', profile_id: 'e1' },
        { job_id: 'job-1', work_date: '2026-09-01', resource_type: 'employee', profile_id: 'e1' },
        { job_id: 'job-1', work_date: '2026-09-01', resource_type: 'plant', profile_id: 'p1' },
        { job_id: 'job-1', work_date: '2026-09-02', resource_type: 'employee', profile_id: 'e2' },
        { job_id: 'job-2', work_date: '2026-09-01', resource_type: 'employee', profile_id: 'e3' },
      ],
    })).toBe(1);
  });

  it('sched-subcontractor-filter maps contractor roles to subcontractors', () => {
    expect(scheduleEmployeeKindFromRole({ name: 'contractor' })).toBe('subcontractor');
    expect(scheduleEmployeeKindFromRole({ display_name: 'Contractor' })).toBe('subcontractor');
    expect(scheduleEmployeeKindFromRole({ name: 'employee' })).toBe('employee');
  });
});
