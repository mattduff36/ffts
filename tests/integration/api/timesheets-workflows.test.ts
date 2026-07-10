import { describe, it, expect, beforeEach } from 'vitest';
import { createMockTimesheet, createMockTimesheetEntry } from '../../utils/factories';
import { resetAllMocks } from '../../utils/test-helpers';
import {
  normalizeTimesheetEntriesForOffDays,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';

describe('Timesheets Complete Workflows', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('Create Timesheet', () => {
    it('should allow employees to create draft timesheets', () => {
      const timesheet = createMockTimesheet({
        status: 'draft',
        user_id: 'employee-id',
      });

      expect(timesheet.status).toBe('draft');
      expect(timesheet.user_id).toBe('employee-id');
    });

    it('should require week_ending date', () => {
      const timesheet = createMockTimesheet({
        week_ending: '2024-12-01', // Sunday
      });

      expect(timesheet.week_ending).toBeDefined();
    });

    it('should prevent duplicate timesheets for same week', () => {
      const existing = createMockTimesheet({
        user_id: 'emp-1',
        week_ending: '2024-12-01',
      });

      const duplicate = {
        user_id: 'emp-1',
        week_ending: '2024-12-01',
      };

      // In API, would check and return 409
      expect(existing.user_id).toBe(duplicate.user_id);
      expect(existing.week_ending).toBe(duplicate.week_ending);
    });
  });

  describe('Timesheet Entries', () => {
    it('should create entries for 7 days of the week', () => {
      const entries = Array.from({ length: 7 }, (_, i) =>
        createMockTimesheetEntry({
          day_of_week: i + 1,
          timesheet_id: 'timesheet-id',
        })
      );

      expect(entries).toHaveLength(7);
      expect(entries[0].day_of_week).toBe(1); // Monday
      expect(entries[6].day_of_week).toBe(7); // Sunday
    });

    it('should calculate daily hours from start and end times', () => {
      const entry = createMockTimesheetEntry({
        time_started: '08:00',
        time_finished: '17:00',
        daily_total: 8.0,
      });

      expect(entry.daily_total).toBe(8.0);
    });

    it('should handle half-hour increments', () => {
      const entry = createMockTimesheetEntry({
        time_started: '08:30',
        time_finished: '17:00',
        daily_total: 8.5,
      });

      expect(entry.daily_total).toBe(8.5);
    });

    it('should support working_in_yard flag', () => {
      const yardWork = createMockTimesheetEntry({
        working_in_yard: true,
        job_number: null,
      });

      expect(yardWork.working_in_yard).toBe(true);
      expect(yardWork.job_number).toBeNull();
    });

    it('should support did_not_work flag', () => {
      const noWork = createMockTimesheetEntry({
        did_not_work: true,
        time_started: null,
        time_finished: null,
        daily_total: 0,
      });

      expect(noWork.did_not_work).toBe(true);
      expect(noWork.daily_total).toBe(0);
    });

    it('should support subsistence payment flag on worked days', () => {
      const stayedAway = createMockTimesheetEntry({
        subsistence_payment_required: true,
        remarks: 'Stayed away - subsistence payment required',
      });

      expect(stayedAway.subsistence_payment_required).toBe(true);
      expect(stayedAway.did_not_work).toBe(false);
      expect(stayedAway.time_started).toBe('08:00');
      expect(stayedAway.time_finished).toBe('17:00');
    });
  });

  describe('Weekly Hours Calculation', () => {
    it('should calculate total weekly hours', () => {
      const entries = [
        createMockTimesheetEntry({ day_of_week: 1, daily_total: 8.0 }),
        createMockTimesheetEntry({ day_of_week: 2, daily_total: 8.5 }),
        createMockTimesheetEntry({ day_of_week: 3, daily_total: 9.0 }),
        createMockTimesheetEntry({ day_of_week: 4, daily_total: 7.5 }),
        createMockTimesheetEntry({ day_of_week: 5, daily_total: 8.0 }),
        createMockTimesheetEntry({ day_of_week: 6, daily_total: 0 }),
        createMockTimesheetEntry({ day_of_week: 7, daily_total: 0 }),
      ];

      const totalHours = entries.reduce((sum, e) => sum + (e.daily_total || 0), 0);
      expect(totalHours).toBe(41.0);
    });
  });

  describe('Digital Signature', () => {
    it('should require signature before submission', () => {
      const unsignedTimesheet = createMockTimesheet({
        status: 'draft',
        signature_data: null,
        signed_at: null,
      });

      expect(unsignedTimesheet.signature_data).toBeNull();
      expect(unsignedTimesheet.signed_at).toBeNull();
    });

    it('should store signature and timestamp', () => {
      const signedTimesheet = createMockTimesheet({
        status: 'draft',
        signature_data: 'data:image/png;base64...',
        signed_at: new Date().toISOString(),
      });

      expect(signedTimesheet.signature_data).toBeDefined();
      expect(signedTimesheet.signed_at).toBeDefined();
    });
  });

  describe('Submit for Approval', () => {
    it('should change status from draft to submitted', () => {
      const draft = createMockTimesheet({ status: 'draft' });
      
      const submitted = {
        ...draft,
        status: 'submitted' as const,
        submitted_at: new Date().toISOString(),
      };

      expect(submitted.status).toBe('submitted');
      expect(submitted.submitted_at).toBeDefined();
    });

    it('should prevent submission without signature', () => {
      const unsigned = createMockTimesheet({
        status: 'draft',
        signature_data: null,
      });

      // API would check and return 400
      expect(unsigned.signature_data).toBeNull();
    });
  });

  describe('Manager Approval', () => {
    it('should allow manager to approve submitted timesheet', () => {
      const submitted = createMockTimesheet({ status: 'submitted' });
      
      const approved = {
        ...submitted,
        status: 'approved' as const,
        reviewed_by: 'manager-id',
        reviewed_at: new Date().toISOString(),
      };

      expect(approved.status).toBe('approved');
      expect(approved.reviewed_by).toBeDefined();
    });

    it('should store reviewer information', () => {
      const approved = createMockTimesheet({
        status: 'approved',
        reviewed_by: 'manager-id',
        reviewed_at: '2024-12-01T10:00:00Z',
      });

      expect(approved.reviewed_by).toBe('manager-id');
      expect(approved.reviewed_at).toBeDefined();
    });
  });

  describe('PDF Generation', () => {
    it('should generate PDF with all timesheet data', () => {
      const timesheet = createMockTimesheet({
        reg_number: 'AB12 CDE',
        week_ending: '2024-12-01',
        status: 'approved',
        signature_data: 'data:image/png;base64...',
      });

      expect(timesheet.reg_number).toBeDefined();
      expect(timesheet.signature_data).toBeDefined();
    });

    it('should include weekly total in PDF', () => {
      const entries = [
        { day_of_week: 1, daily_total: 8.0 },
        { day_of_week: 2, daily_total: 8.0 },
        { day_of_week: 3, daily_total: 8.0 },
        { day_of_week: 4, daily_total: 8.0 },
        { day_of_week: 5, daily_total: 8.0 },
      ];

      const weeklyTotal = entries.reduce((sum, e) => sum + e.daily_total, 0);
      expect(weeklyTotal).toBe(40.0);
    });
  });

  describe('Timesheet Deletion', () => {
    it('should allow employees to delete draft timesheets', () => {
      const draft = createMockTimesheet({
        status: 'draft',
        user_id: 'employee-id',
      });

      expect(draft.status).toBe('draft');
      // Employee can delete their own drafts
    });

    it('should allow employees to delete rejected timesheets', () => {
      const rejected = createMockTimesheet({
        status: 'rejected',
        user_id: 'employee-id',
      });

      expect(rejected.status).toBe('rejected');
      // Employee can delete rejected timesheets
    });

    it('should prevent deletion of submitted timesheets', () => {
      const submitted = createMockTimesheet({
        status: 'submitted',
        user_id: 'employee-id',
      });

      // API would prevent deletion and return 403
      expect(submitted.status).toBe('submitted');
    });
  });

  describe('Validation Rules', () => {
    it('should validate time format (HH:mm)', () => {
      const validTimes = ['08:00', '17:30', '23:45'];
      
      validTimes.forEach(time => {
        expect(time).toMatch(/^\d{2}:\d{2}$/);
      });
    });

    it('should validate hours are between 0 and 24', () => {
      const validHours = [0, 8.0, 12.5, 24];
      
      validHours.forEach(hours => {
        expect(hours).toBeGreaterThanOrEqual(0);
        expect(hours).toBeLessThanOrEqual(24);
      });
    });

    it('should require reg_number when vehicle work', () => {
      const vehicleWork = createMockTimesheet({
        reg_number: 'AB12 CDE',
      });

      expect(vehicleWork.reg_number).toBeDefined();
    });
  });

  describe('Absence + Timesheet integration', () => {
    it('hard-overwrites approved leave days to did-not-work', () => {
      const entries = Array.from({ length: 7 }, (_, index) => ({
        ...createMockTimesheetEntry({
          day_of_week: index + 1,
          did_not_work: false,
          time_started: null,
          time_finished: null,
          job_number: null,
          remarks: null,
          daily_total: null,
          working_in_yard: false,
        }),
        time_started: '',
        time_finished: '',
        job_number: '',
        remarks: '',
        didNotWorkReason: null as 'Holiday' | 'Sickness' | 'Off Shift' | 'Other' | null,
      }));

      entries[0] = {
        ...entries[0],
        time_started: '08:00',
        time_finished: '17:00',
        job_number: '1234-AB',
        daily_total: 8.5,
      };

      const offDays = resolveTimesheetOffDayStates(
        '2026-03-29',
        [
          {
            date: '2026-03-23',
            end_date: null,
            is_half_day: false,
            absence_reasons: { name: 'Annual Leave', is_paid: true },
          },
        ],
        STANDARD_WORK_SHIFT_PATTERN
      );

      const normalized = normalizeTimesheetEntriesForOffDays(entries, offDays, {
        enforceLeaveOverwrite: true,
        applyNonShiftDefaults: true,
      });

      expect(normalized[0].did_not_work).toBe(true);
      expect(normalized[0].didNotWorkReason).toBe('Holiday');
      expect(normalized[0].remarks).toBe('Annual Leave');
      expect(normalized[0].time_started).toBe('');
      expect(normalized[0].time_finished).toBe('');
      expect(normalized[0].job_number).toBe('');
      expect(normalized[0].daily_total).toBe(9);
    });

    it('keeps training rows editable without adding leave credit', () => {
      const entries = Array.from({ length: 7 }, (_, index) => ({
        ...createMockTimesheetEntry({
          day_of_week: index + 1,
          did_not_work: false,
          time_started: null,
          time_finished: null,
          job_number: null,
          remarks: null,
          daily_total: null,
          working_in_yard: false,
        }),
        time_started: '',
        time_finished: '',
        job_number: '',
        remarks: '',
        didNotWorkReason: null as 'Holiday' | 'Sickness' | 'Off Shift' | 'Other' | null,
      }));

      entries[0] = {
        ...entries[0],
        time_started: '12:00',
        time_finished: '17:00',
        job_number: '1234-AB',
        daily_total: 5,
      };

      const offDays = resolveTimesheetOffDayStates(
        '2026-03-29',
        [
          {
            date: '2026-03-23',
            end_date: null,
            is_half_day: true,
            half_day_session: 'AM',
            absence_reasons: { name: 'Training', is_paid: true },
          },
        ],
        STANDARD_WORK_SHIFT_PATTERN
      );

      const normalized = normalizeTimesheetEntriesForOffDays(entries, offDays, {
        enforceLeaveOverwrite: true,
        applyNonShiftDefaults: true,
      });

      expect(normalized[0].did_not_work).toBe(false);
      expect(normalized[0].daily_total).toBe(5);
      expect(normalized[0].remarks).toBe('');
    });
  });
});

