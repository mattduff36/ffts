import { describe, expect, it } from 'vitest';

import { generateFinancialYearCarryovers } from '@/lib/services/absence-bank-holiday-sync';

function buildMockSupabase() {
  const insertedCarryovers: Array<Record<string, unknown>> = [];
  const deletedYears: number[] = [];

  const supabase = {
    from(table: string) {
      if (table === 'absence_reasons') {
        return {
          select() {
            return {
              ilike() {
                return {
                  async single() {
                    return {
                      data: { id: 'reason-annual', name: 'Annual Leave' },
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
              async order() {
                return {
                  data: [
                    { id: 'emp-a', annual_holiday_allowance_days: 28 },
                    { id: 'emp-b', annual_holiday_allowance_days: 20 },
                    { id: 'emp-c', annual_holiday_allowance_days: 28 },
                  ],
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table === 'absences') {
        return {
          select() {
            let statusFilter: string[] | null = null;
            const chain = {
              eq(_field: string, _value: string) {
                return chain;
              },
              in(field: string, value: string[]) {
                if (field === 'status') {
                  statusFilter = value;
                }
                return chain;
              },
              gte() {
                return chain;
              },
              async lte() {
                const approvedRows = [
                  { profile_id: 'emp-a', duration_days: 6 },
                  { profile_id: 'emp-a', duration_days: 4 },
                  { profile_id: 'emp-b', duration_days: 23 },
                ];
                const pendingRows = [
                  { profile_id: 'emp-a', duration_days: 3 },
                ];
                return {
                  data: statusFilter?.includes('processed') ? approvedRows : approvedRows.concat(pendingRows),
                  error: null,
                };
              },
            };
            return chain;
          },
        };
      }

      if (table === 'absence_allowance_carryovers') {
        return {
          select() {
            return {
              async eq() {
                return {
                  data: [{ profile_id: 'emp-a', carried_days: 2 }],
                  error: null,
                };
              },
            };
          },
          delete() {
            return {
              eq(_field: string, value: number | boolean | string) {
                if (typeof value === 'number') {
                  deletedYears.push(value);
                }
                return this;
              },
            };
          },
          async insert(rows: Array<Record<string, unknown>>) {
            insertedCarryovers.push(...rows);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, insertedCarryovers, deletedYears };
}

describe('generateFinancialYearCarryovers', () => {
  it('creates next-year carryover rows using approved-only usage and supports negatives', async () => {
    const { supabase, insertedCarryovers, deletedYears } = buildMockSupabase();

    const created = await generateFinancialYearCarryovers(
      supabase as never,
      2025,
      2026,
      'admin-1'
    );

    expect(created).toBe(3);
    expect(deletedYears).toContain(2026);
    expect(insertedCarryovers).toHaveLength(3);
    expect(insertedCarryovers[0]).toMatchObject({
      profile_id: 'emp-a',
      financial_year_start_year: 2026,
      source_financial_year_start_year: 2025,
      carried_days: 20,
      auto_generated: true,
      generated_by: 'admin-1',
    });
    expect(insertedCarryovers[1]).toMatchObject({
      profile_id: 'emp-b',
      financial_year_start_year: 2026,
      source_financial_year_start_year: 2025,
      carried_days: -3,
      auto_generated: true,
      generated_by: 'admin-1',
    });
    expect(insertedCarryovers[2]).toMatchObject({
      profile_id: 'emp-c',
      financial_year_start_year: 2026,
      source_financial_year_start_year: 2025,
      carried_days: 28,
      auto_generated: true,
      generated_by: 'admin-1',
    });
  });
});
