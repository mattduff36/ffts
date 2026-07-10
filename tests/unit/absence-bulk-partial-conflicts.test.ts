import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookBulkAbsence } from '@/lib/services/absence-bank-holiday-sync';
import { loadEmployeeWorkShiftPatternMap } from '@/lib/server/work-shifts';
import { STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/server/work-shifts', () => ({
  loadEmployeeWorkShiftPatternMap: vi.fn(),
}));

interface MockProfile {
  id: string;
  full_name: string;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
  roles: { id?: string; name?: string; display_name?: string } | null;
}

interface MockAbsenceRow {
  profile_id: string;
  date: string;
  end_date: string | null;
  status: string;
  absence_reasons?: { name?: string | null } | null;
}

interface BuildMockSupabaseOptions {
  profiles: MockProfile[];
  annualAbsences: Array<{ profile_id: string; duration_days: number | null; status: string }>;
  existingRows: MockAbsenceRow[];
  carryovers?: Array<{ profile_id: string; carried_days: number }>;
}

function buildMockSupabase(options: BuildMockSupabaseOptions) {
  const insertedAbsenceRows: Array<Record<string, unknown>> = [];
  const insertedBatchRows: Array<Record<string, unknown>> = [];

  const supabase = {
    from(table: string) {
      if (table === 'absence_reasons') {
        return {
          select() {
            return {
              eq(_field: string, value: string) {
                return {
                  async single() {
                    return {
                      data: { id: value, name: 'Annual Leave', is_active: true },
                      error: null,
                    };
                  },
                };
              },
              ilike() {
                return {
                  async single() {
                    return {
                      data: { id: 'reason-annual', name: 'Annual Leave', is_active: true },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'profiles') {
        return {
          select() {
            return {
              gt(_field: string, value: number) {
                const filteredProfiles = options.profiles.filter(
                  (profile) => (profile.annual_holiday_allowance_days ?? 0) > value
                );
                return {
                  async order() {
                    return { data: filteredProfiles, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'absence_allowance_carryovers') {
        return {
          select() {
            const chain = createSupabaseQueryMock(
              { data: options.carryovers || [], error: null },
              ['eq', 'in']
            );
            return chain;
          },
        };
      }

      if (table === 'absences') {
        return {
          select(columns: string) {
            const chain = {
              eq() {
                return chain;
              },
              in() {
                return chain;
              },
              gte() {
                return chain;
              },
              async lte() {
                if (columns.includes('absence_reasons(name)')) {
                  return { data: options.existingRows, error: null };
                }
                return { data: options.annualAbsences, error: null };
              },
            };
            return chain;
          },
          async insert(rows: Array<Record<string, unknown>>) {
            insertedAbsenceRows.push(...rows);
            return { error: null };
          },
        };
      }

      if (table === 'absence_bulk_batches') {
        return {
          insert(payload: Record<string, unknown>) {
            insertedBatchRows.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: 'batch-1' }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, insertedAbsenceRows, insertedBatchRows };
}

describe('bookBulkAbsence partial conflict handling', () => {
  const weekendOnlyPattern = {
    ...STANDARD_WORK_SHIFT_PATTERN,
    monday_am: false,
    monday_pm: false,
    tuesday_am: false,
    tuesday_pm: false,
    wednesday_am: false,
    wednesday_pm: false,
    thursday_am: false,
    thursday_pm: false,
    friday_am: false,
    friday_pm: false,
    saturday_am: true,
    saturday_pm: true,
    sunday_am: true,
    sunday_pm: true,
  };

  const mondayOnlyPattern = {
    ...STANDARD_WORK_SHIFT_PATTERN,
    tuesday_am: false,
    tuesday_pm: false,
    wednesday_am: false,
    wednesday_pm: false,
    thursday_am: false,
    thursday_pm: false,
    friday_am: false,
    friday_pm: false,
    saturday_am: false,
    saturday_pm: false,
    sunday_am: false,
    sunday_pm: false,
  };

  const profiles: MockProfile[] = [
    {
      id: 'emp-a',
      full_name: 'A Worker',
      employee_id: 'A1',
      annual_holiday_allowance_days: 28,
      roles: null,
    },
    {
      id: 'emp-b',
      full_name: 'B Worker',
      employee_id: 'B1',
      annual_holiday_allowance_days: 28,
      roles: null,
    },
    {
      id: 'emp-c',
      full_name: 'C Worker',
      employee_id: 'C1',
      annual_holiday_allowance_days: 28,
      roles: null,
    },
  ];

  beforeEach(() => {
    vi.mocked(loadEmployeeWorkShiftPatternMap).mockResolvedValue(
      new Map(profiles.map((profile) => [profile.id, { ...STANDARD_WORK_SHIFT_PATTERN }]))
    );
  });

  const existingRows: MockAbsenceRow[] = [
    {
      profile_id: 'emp-a',
      date: '2026-12-16',
      end_date: null,
      status: 'approved',
      absence_reasons: { name: 'Sick Leave' },
    },
    {
      profile_id: 'emp-b',
      date: '2026-12-14',
      end_date: '2026-12-18',
      status: 'approved',
      absence_reasons: { name: 'Annual Leave' },
    },
  ];

  it('previews segmented rows, counting full and partial conflicts separately', async () => {
    const { supabase, insertedAbsenceRows, insertedBatchRows } = buildMockSupabase({
      profiles,
      annualAbsences: [],
      existingRows,
    });

    const result = await bookBulkAbsence({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      reasonId: 'reason-annual',
      startDate: '2026-12-14',
      endDate: '2026-12-18',
      applyToAll: true,
      confirm: false,
    });

    expect(result.requestedDays).toBe(5);
    expect(result.requestedDaysMin).toBe(5);
    expect(result.requestedDaysMax).toBe(5);
    expect(result.wouldCreate).toBe(3);
    expect(result.createdCount).toBe(0);
    expect(result.duplicateCount).toBe(1);
    expect(result.partialConflictEmployeeCount).toBe(1);
    expect(result.conflictingWorkingDaysSkipped).toBe(6);
    expect(result.createdSegmentsCount).toBe(3);
    expect(result.conflicts).toHaveLength(2);
    expect(insertedAbsenceRows).toHaveLength(0);
    expect(insertedBatchRows).toHaveLength(0);
  });

  it('creates only non-conflicting segments on confirm and tracks batch counts', async () => {
    const { supabase, insertedAbsenceRows, insertedBatchRows } = buildMockSupabase({
      profiles,
      annualAbsences: [],
      existingRows,
    });

    const result = await bookBulkAbsence({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      reasonId: 'reason-annual',
      startDate: '2026-12-14',
      endDate: '2026-12-18',
      applyToAll: true,
      confirm: true,
      notes: 'Bulk annual leave',
    });

    expect(result.createdCount).toBe(3);
    expect(result.duplicateCount).toBe(1);
    expect(result.partialConflictEmployeeCount).toBe(1);
    expect(result.createdSegmentsCount).toBe(3);
    expect(result.batchId).toBe('batch-1');

    expect(insertedBatchRows).toHaveLength(1);
    expect(insertedBatchRows[0]?.created_count).toBe(3);
    expect(insertedBatchRows[0]?.duplicate_count).toBe(1);

    expect(insertedAbsenceRows).toHaveLength(3);
    const dateRanges = insertedAbsenceRows.map((row) => `${row.date as string}:${(row.end_date as string | null) || row.date as string}`);
    expect(dateRanges).toContain('2026-12-14:2026-12-15');
    expect(dateRanges).toContain('2026-12-17:2026-12-18');
    expect(dateRanges).toContain('2026-12-14:2026-12-18');
  });

  it('returns an employee-specific requested-day range for mixed work patterns', async () => {
    vi.mocked(loadEmployeeWorkShiftPatternMap).mockResolvedValue(
      new Map([
        ['emp-a', { ...STANDARD_WORK_SHIFT_PATTERN }],
        ['emp-b', weekendOnlyPattern],
        ['emp-c', mondayOnlyPattern],
      ])
    );

    const { supabase } = buildMockSupabase({
      profiles,
      annualAbsences: [],
      existingRows: [],
    });

    const result = await bookBulkAbsence({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      reasonId: 'reason-annual',
      startDate: '2026-12-12',
      endDate: '2026-12-14',
      applyToAll: true,
      confirm: false,
    });

    expect(result.requestedDays).toBe(2);
    expect(result.requestedDaysMin).toBe(1);
    expect(result.requestedDaysMax).toBe(2);
    expect(result.wouldCreate).toBe(3);
  });

  it('uses carryover allowance when calculating annual leave warnings', async () => {
    const { supabase } = buildMockSupabase({
      profiles: [
        {
          id: 'emp-a',
          full_name: 'A Worker',
          employee_id: 'A1',
          annual_holiday_allowance_days: 2,
          roles: null,
        },
      ],
      annualAbsences: [],
      existingRows: [],
      carryovers: [{ profile_id: 'emp-a', carried_days: 3 }],
    });

    const result = await bookBulkAbsence({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      reasonId: 'reason-annual',
      startDate: '2026-12-14',
      endDate: '2026-12-18',
      applyToAll: true,
      confirm: false,
    });

    expect(result.requestedDays).toBe(5);
    expect(result.warningCount).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('rejects bulk bookings that span multiple financial years', async () => {
    const { supabase } = buildMockSupabase({
      profiles,
      annualAbsences: [],
      existingRows: [],
    });

    await expect(
      bookBulkAbsence({
        supabase: supabase as never,
        actorProfileId: 'manager-1',
        reasonId: 'reason-annual',
        startDate: '2026-03-30',
        endDate: '2026-04-02',
        applyToAll: true,
        confirm: false,
      })
    ).rejects.toThrow('Absence bookings cannot span multiple financial years');
  });

  it('excludes zero-allowance users from apply-to-all bulk booking', async () => {
    const { supabase, insertedAbsenceRows } = buildMockSupabase({
      profiles: [
        {
          id: 'emp-a',
          full_name: 'A Worker',
          employee_id: 'A1',
          annual_holiday_allowance_days: 28,
          roles: null,
        },
        {
          id: 'emp-zero',
          full_name: 'Zero Allowance User',
          employee_id: 'Z0',
          annual_holiday_allowance_days: 0,
          roles: null,
        },
      ],
      annualAbsences: [],
      existingRows: [],
    });

    const result = await bookBulkAbsence({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      reasonId: 'reason-annual',
      startDate: '2026-12-14',
      endDate: '2026-12-18',
      applyToAll: true,
      confirm: true,
    });

    expect(result.totalEmployees).toBe(1);
    expect(result.targetedEmployees).toBe(1);
    expect(result.createdCount).toBe(1);
    expect(insertedAbsenceRows).toHaveLength(1);
    expect(insertedAbsenceRows[0]?.profile_id).toBe('emp-a');
  });
});
