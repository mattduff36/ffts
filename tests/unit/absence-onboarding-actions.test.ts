import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  replayBulkAbsenceBatchesForProfile,
  seedRemainingFinancialYearBankHolidaysForProfiles,
} from '@/lib/services/absence-bank-holiday-sync';

vi.mock('@/lib/utils/bank-holidays', () => ({
  getBankHolidaysForYear: vi.fn(),
}));

describe('absence onboarding action services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('books only future-dated bank holidays for selected profiles', async () => {
    const { getBankHolidaysForYear } = await import('@/lib/utils/bank-holidays');
    vi.mocked(getBankHolidaysForYear)
      .mockResolvedValueOnce([
        { title: 'Good Friday', date: '2025-04-18', notes: '', bunting: true },
        { title: 'Christmas Day', date: '2025-12-25', notes: '', bunting: true },
      ])
      .mockResolvedValueOnce([
        { title: 'New Year', date: '2026-01-01', notes: '', bunting: true },
      ]);

    const insertedRows: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        if (table === 'absence_reasons') {
          return {
            select() {
              return {
                ilike() {
                  return {
                    async single() {
                      return { data: { id: 'reason-annual' }, error: null };
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
                in() {
                  return {
                    async gt() {
                      return { data: [{ id: 'profile-1' }], error: null };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === 'absences') {
          return {
            select() {
              const chain = {
                eq() {
                  return chain;
                },
                async in() {
                  return { data: [], error: null };
                },
              };
              return chain;
            },
            async insert(rows: Array<Record<string, unknown>>) {
              insertedRows.push(...rows);
              return { error: null };
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await seedRemainingFinancialYearBankHolidaysForProfiles({
      supabase: supabase as never,
      profileIds: ['profile-1'],
      financialYearStartYear: 2025,
      fromDate: '2025-12-01',
    });

    expect(result.created).toBe(2);
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows.map((row) => row.date)).toEqual(['2025-12-25', '2026-01-01']);
  });

  it('replays only date ranges that overlap from today to FY end', async () => {
    const bookBulkAbsenceFn = vi.fn().mockResolvedValue({
      startDate: '2025-12-20',
      endDate: '2026-03-31',
      reasonId: 'reason-1',
      reasonName: 'Annual Leave',
      requestedDays: 10,
      requestedDaysMin: 10,
      requestedDaysMax: 10,
      totalEmployees: 1,
      targetedEmployees: 1,
      wouldCreate: 1,
      createdCount: 1,
      duplicateCount: 0,
      partialConflictEmployeeCount: 0,
      conflictingWorkingDaysSkipped: 0,
      createdSegmentsCount: 1,
      warningCount: 0,
      warnings: [],
      conflicts: [],
      batchId: 'new-batch',
    });

    const supabase = {
      from(table: string) {
        if (table === 'absence_bulk_batches') {
          return {
            select() {
              return {
                async in() {
                  return {
                    data: [
                      {
                        id: 'batch-past',
                        reason_id: 'reason-1',
                        reason_name: 'Annual Leave',
                        start_date: '2025-04-10',
                        end_date: '2025-04-15',
                        notes: null,
                      },
                      {
                        id: 'batch-active',
                        reason_id: 'reason-1',
                        reason_name: 'Annual Leave',
                        start_date: '2025-12-10',
                        end_date: '2026-04-10',
                        notes: 'Shutdown',
                      },
                    ],
                    error: null,
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await replayBulkAbsenceBatchesForProfile({
      supabase: supabase as never,
      actorProfileId: 'admin-1',
      profileId: 'profile-1',
      batchIds: ['batch-past', 'batch-active'],
      financialYearStartYear: 2025,
      fromDate: '2025-12-20',
      bookBulkAbsenceFn,
    });

    expect(bookBulkAbsenceFn).toHaveBeenCalledTimes(1);
    expect(bookBulkAbsenceFn).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2025-12-20',
        endDate: '2026-03-31',
        employeeIds: ['profile-1'],
        applyToAll: false,
      })
    );
    expect(result.appliedBatchCount).toBe(1);
    expect(result.skippedOutOfRangeCount).toBe(1);
    expect(result.totalCreatedCount).toBe(1);
  });
});
