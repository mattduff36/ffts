import { describe, expect, it, vi } from 'vitest';
import {
  applyApprovedAbsenceTimesheetEffects,
  applyAbsenceToTimesheetRows,
  assertNoLockedAbsenceTimesheetImpacts,
  buildAbsenceTimesheetImpactMessage,
  getAbsenceImpactDayOfWeek,
  getAbsenceImpactWeekEnding,
  removeAbsenceFromTimesheetRows,
  returnSubmittedAbsenceTimesheetsForAmendment,
  type AbsenceTimesheetImpact,
} from '@/lib/utils/absence-timesheet-impact';

const baseImpact: AbsenceTimesheetImpact = {
  timesheetId: 'timesheet-1',
  weekEnding: '2026-04-19',
  status: 'draft',
  managerComments: null,
  hasExistingHours: true,
  hasExistingJobCodes: true,
  hasAnyEnteredData: true,
  affectedDates: [
    {
      date: '2026-04-15',
      dayOfWeek: 3,
      hasEntry: true,
      hasWorkingHours: true,
      hasJobCodes: true,
      hasAnyEnteredData: true,
      entry: {
        id: 'entry-1',
        timesheet_id: 'timesheet-1',
        day_of_week: 3,
        time_started: '08:00',
        time_finished: '16:30',
        job_number: '1234-AB',
        working_in_yard: false,
        did_not_work: false,
        daily_total: 8,
        remarks: 'Original note',
        night_shift: false,
        bank_holiday: false,
        operator_travel_hours: null,
        operator_yard_hours: null,
        operator_working_hours: null,
        machine_travel_hours: null,
        machine_start_time: null,
        machine_finish_time: null,
        machine_working_hours: null,
        machine_standing_hours: null,
        machine_operator_hours: null,
        maintenance_breakdown_hours: null,
        timesheet_entry_job_codes: [{ job_number: '1234-AB', display_order: 0 }],
      },
    },
  ],
};

describe('absence timesheet impact workflow', () => {
  it('maps leave dates to the matching timesheet week and row day', () => {
    expect(getAbsenceImpactWeekEnding('2026-04-15')).toBe('2026-04-19');
    expect(getAbsenceImpactDayOfWeek('2026-04-15')).toBe(3);
    expect(getAbsenceImpactDayOfWeek('2026-04-19')).toBe(7);
  });

  it('blocks processed and adjusted timesheets', () => {
    const impact = { ...baseImpact, status: 'processed' as const };

    expect(() => assertNoLockedAbsenceTimesheetImpacts([impact])).toThrow(/locked timesheets/);
    expect(buildAbsenceTimesheetImpactMessage('Sickness', [impact])).toContain('payroll history');
  });

  it('returns submitted timesheets with leave-specific amendment comments', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'timesheets') throw new Error(`Unexpected table ${table}`);
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ error: null })),
              })),
            };
          }),
        };
      }),
    };

    const returned = await returnSubmittedAbsenceTimesheetsForAmendment(supabase as never, {
      actorUserId: 'manager-1',
      reasonName: 'Sickness',
      action: 'Approved',
      impacts: [{ ...baseImpact, status: 'submitted', managerComments: 'Existing comment' }],
    });

    expect(returned).toEqual(['timesheet-1']);
    expect(updates[0]).toMatchObject({
      status: 'rejected',
      reviewed_by: 'manager-1',
    });
    expect(String(updates[0].manager_comments)).toContain('Existing comment');
    expect(String(updates[0].manager_comments)).toContain('Sickness booking for 2026-04-15');
  });

  it('snapshots and applies a full-day blocking leave row', async () => {
    const snapshots: Array<Record<string, unknown>> = [];
    const entryUpdates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'timesheet_entry_leave_snapshots') {
          return {
            upsert: vi.fn(async (payload: Record<string, unknown>) => {
              snapshots.push(payload);
              return { error: null };
            }),
          };
        }
        if (table === 'timesheet_entries') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              entryUpdates.push(payload);
              return { eq: vi.fn(async () => ({ error: null })) };
            }),
          };
        }
        if (table === 'timesheet_entry_job_codes') {
          return {
            delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await applyAbsenceToTimesheetRows(supabase as never, {
      absenceId: 'absence-1',
      actorUserId: 'manager-1',
      profileId: 'employee-1',
      startDate: '2026-04-15',
      reasonName: 'Sickness',
      isPaid: false,
      impacts: [baseImpact],
    });

    expect(snapshots[0]).toMatchObject({
      absence_id: 'absence-1',
      timesheet_id: 'timesheet-1',
      timesheet_entry_id: 'entry-1',
      had_entry: true,
    });
    expect(entryUpdates[0]).toMatchObject({
      time_started: null,
      time_finished: null,
      job_number: null,
      did_not_work: true,
      daily_total: 0,
      remarks: 'Sickness',
    });
  });

  it('overwrites submitted timesheet rows without returning the timesheet', async () => {
    const snapshots: Array<Record<string, unknown>> = [];
    const entryUpdates: Array<Record<string, unknown>> = [];
    const tables: string[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        tables.push(table);
        if (table === 'timesheet_entry_leave_snapshots') {
          return {
            upsert: vi.fn(async (payload: Record<string, unknown>) => {
              snapshots.push(payload);
              return { error: null };
            }),
          };
        }
        if (table === 'timesheet_entries') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              entryUpdates.push(payload);
              return { eq: vi.fn(async () => ({ error: null })) };
            }),
          };
        }
        if (table === 'timesheet_entry_job_codes') {
          return {
            delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const returned = await applyApprovedAbsenceTimesheetEffects(supabase as never, {
      absenceId: 'absence-1',
      actorUserId: 'manager-1',
      profileId: 'employee-1',
      startDate: '2026-04-15',
      reasonName: 'Sickness',
      isPaid: false,
      impacts: [{ ...baseImpact, status: 'submitted' }],
    });

    expect(returned).toEqual([]);
    expect(tables).not.toContain('timesheets');
    expect(snapshots[0]).toMatchObject({ timesheet_id: 'timesheet-1' });
    expect(entryUpdates[0]).toMatchObject({
      did_not_work: true,
      daily_total: 0,
      remarks: 'Sickness',
    });
  });

  it('clears stale auto-applied leave rows when no snapshot can restore them', async () => {
    const entryUpdates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'timesheet_entries') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              entryUpdates.push(payload);
              return { eq: vi.fn(async () => ({ error: null })) };
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await removeAbsenceFromTimesheetRows(supabase as never, {
      absenceId: 'absence-1',
      actorUserId: 'manager-1',
      profileId: 'employee-1',
      startDate: '2026-04-15',
      reasonName: 'Sickness',
      isPaid: false,
      snapshots: [],
      impacts: [
        {
          ...baseImpact,
          hasExistingHours: false,
          hasExistingJobCodes: false,
          affectedDates: [
            {
              ...baseImpact.affectedDates[0],
              hasWorkingHours: false,
              hasJobCodes: false,
              entry: {
                ...baseImpact.affectedDates[0].entry!,
                time_started: null,
                time_finished: null,
                job_number: null,
                daily_total: 0,
                did_not_work: true,
                remarks: 'Sickness',
                timesheet_entry_job_codes: [],
              },
            },
          ],
        },
      ],
    });

    expect(entryUpdates[0]).toEqual({
      did_not_work: false,
      daily_total: null,
      remarks: null,
    });
  });
});
