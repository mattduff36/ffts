import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchAllUserModulePermissionRows,
  type UserModulePermissionRow,
} from '@/lib/server/team-permissions';

describe('user module permission pagination', () => {
  it('loads every row across a full page and a short final page', async () => {
    const sourceRows: UserModulePermissionRow[] = Array.from({ length: 1237 }, (_, index) => ({
      user_id: `pagination-user-${String(index).padStart(4, '0')}`,
      module_name: 'timesheets',
      access_level: index % 6,
    }));
    const requestedRanges: Array<[number, number]> = [];

    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(async (from: number, to: number) => {
        requestedRanges.push([from, to]);
        return {
          data: sourceRows.slice(from, to + 1),
          error: null,
        };
      }),
    };
    const supabase = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient;

    const rows = await fetchAllUserModulePermissionRows(supabase);
    const uniqueKeys = new Set(rows.map((row) => `${row.user_id}:${row.module_name}`));

    expect(rows).toHaveLength(1237);
    expect(uniqueKeys.size).toBe(1237);
    expect(requestedRanges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(query.range).toHaveBeenCalledTimes(2);
  });
});

