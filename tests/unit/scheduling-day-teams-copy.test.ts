import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadSettings } = vi.hoisted(() => ({
  mockLoadSettings: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-team-settings', () => ({
  loadScheduleTeamSettings: mockLoadSettings,
}));

import { copyScheduleDayTeamMembers } from '@/lib/server/scheduling-day-teams';

const actorId = '33333333-3333-4333-8333-333333333333';
const employeeId = '22222222-2222-4222-8222-222222222222';
const leaderId = '11111111-1111-4111-8111-111111111111';
const plantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function adminMock(options: {
  sourceRows?: Array<Record<string, unknown>>;
  plantRows?: Array<Record<string, unknown>>;
  sourceError?: { code?: string; message?: string } | null;
  plantError?: { code?: string; message?: string } | null;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  return {
    from: vi.fn((table: string) => {
      const rows = table === 'schedule_day_team_members'
        ? options.sourceRows || []
        : table === 'schedule_day_team_plants'
          ? options.plantRows || []
          : null;
      const error = table === 'schedule_day_team_members'
        ? options.sourceError || null
        : table === 'schedule_day_team_plants'
          ? options.plantError || null
          : null;
      if (!rows) {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: rows,
                error,
              }),
            })),
          })),
        })),
      };
    }),
    rpc: options.rpc || vi.fn().mockResolvedValue({
      data: [{
        work_date: '2026-09-21',
        slot_index: 2,
        profile_id: employeeId,
        added_by: actorId,
        created_at: '2026-09-21T08:00:00.000Z',
      }],
      error: null,
    }),
  };
}

describe('copyScheduleDayTeamMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSettings.mockResolvedValue({
      visible_slot_count: 5,
      leaders: [{
        slot_index: 1,
        profile_id: leaderId,
        employee: null,
      }],
      updated_by: actorId,
      updated_at: '2026-09-20T08:00:00.000Z',
    });
  });

  it('rejects copying onto the same date', async () => {
    const result = await copyScheduleDayTeamMembers(adminMock({}), {
      fromDate: '2026-09-20',
      toDate: '2026-09-20',
      actorUserId: actorId,
    });
    expect(result).toEqual({
      status: 400,
      error: 'Choose a different date to copy from.',
    });
  });

  it('copies visible non-leader members onto the target date', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        work_date: '2026-09-21',
        slot_index: 2,
        profile_id: employeeId,
        added_by: actorId,
        created_at: '2026-09-21T08:00:00.000Z',
      }],
      error: null,
    });
    const result = await copyScheduleDayTeamMembers(adminMock({
      sourceRows: [
        { work_date: '2026-09-20', slot_index: 1, profile_id: leaderId },
        { work_date: '2026-09-20', slot_index: 2, profile_id: employeeId },
        { work_date: '2026-09-20', slot_index: 9, profile_id: '44444444-4444-4444-8444-444444444444' },
      ],
      rpc,
    }) as never, {
      fromDate: '2026-09-20',
      toDate: '2026-09-21',
      actorUserId: actorId,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'add_schedule_day_team_member_v1',
      expect.objectContaining({
        p_work_date: '2026-09-21',
        p_slot_index: 2,
        p_profile_id: employeeId,
      })
    );
    expect(result).toEqual({
      members: [{
        work_date: '2026-09-21',
        slot_index: 2,
        profile_id: employeeId,
        added_by: actorId,
        created_at: '2026-09-21T08:00:00.000Z',
      }],
      plants: [],
      copied: 1,
      skipped: 0,
    });
  });

  it('skips full-slot and leader-lock failures without aborting the copy', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'TEAM_SLOT_FULL', code: 'P0001' },
      })
      .mockResolvedValueOnce({
        data: [{
          work_date: '2026-09-21',
          slot_index: 3,
          profile_id: '55555555-5555-4555-8555-555555555555',
          added_by: actorId,
          created_at: '2026-09-21T08:00:00.000Z',
        }],
        error: null,
      });
    const result = await copyScheduleDayTeamMembers(adminMock({
      sourceRows: [
        { work_date: '2026-09-20', slot_index: 2, profile_id: employeeId },
        { work_date: '2026-09-20', slot_index: 3, profile_id: '55555555-5555-4555-8555-555555555555' },
      ],
      rpc,
    }) as never, {
      fromDate: '2026-09-20',
      toDate: '2026-09-21',
      actorUserId: actorId,
    });

    expect(result).toMatchObject({ copied: 1, skipped: 1, plants: [] });
  });

  it('copies employee and plant memberships and combines the counts', async () => {
    const rpc = vi.fn(async (name: string, args: { p_slot_index?: number; p_profile_id?: string; p_plant_id?: string }) => {
      if (name === 'add_schedule_day_team_plant_v1') {
        return {
          data: [{
            work_date: '2026-09-21',
            slot_index: args.p_slot_index,
            plant_id: args.p_plant_id,
            added_by: actorId,
            created_at: '2026-09-21T08:05:00.000Z',
          }],
          error: null,
        };
      }
      return {
        data: [{
          work_date: '2026-09-21',
          slot_index: args.p_slot_index,
          profile_id: args.p_profile_id,
          added_by: actorId,
          created_at: '2026-09-21T08:00:00.000Z',
        }],
        error: null,
      };
    });
    const result = await copyScheduleDayTeamMembers(adminMock({
      sourceRows: [
        { work_date: '2026-09-20', slot_index: 2, profile_id: employeeId },
      ],
      plantRows: [
        { work_date: '2026-09-20', slot_index: 2, plant_id: plantId },
        { work_date: '2026-09-20', slot_index: 9, plant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ],
      rpc,
    }) as never, {
      fromDate: '2026-09-20',
      toDate: '2026-09-21',
      actorUserId: actorId,
    });

    expect(rpc).toHaveBeenCalledWith(
      'add_schedule_day_team_member_v1',
      expect.objectContaining({ p_profile_id: employeeId, p_slot_index: 2 })
    );
    expect(rpc).toHaveBeenCalledWith(
      'add_schedule_day_team_plant_v1',
      expect.objectContaining({ p_plant_id: plantId, p_slot_index: 2, p_work_date: '2026-09-21' })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'add_schedule_day_team_plant_v1',
      expect.objectContaining({ p_plant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
    );
    expect(result).toMatchObject({
      copied: 2,
      skipped: 0,
      members: [expect.objectContaining({ profile_id: employeeId, slot_index: 2 })],
      plants: [expect.objectContaining({ plant_id: plantId, slot_index: 2 })],
    });
  });

  it('counts a rejected plant and throws on an unexpected plant error', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          work_date: '2026-09-21',
          slot_index: 2,
          profile_id: employeeId,
          added_by: actorId,
          created_at: '2026-09-21T08:00:00.000Z',
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'TEAM_PLANT_INVALID', code: 'P0001' },
      });
    const skipped = await copyScheduleDayTeamMembers(adminMock({
      sourceRows: [
        { work_date: '2026-09-20', slot_index: 2, profile_id: employeeId },
      ],
      plantRows: [
        { work_date: '2026-09-20', slot_index: 2, plant_id: plantId },
      ],
      rpc,
    }) as never, {
      fromDate: '2026-09-20',
      toDate: '2026-09-21',
      actorUserId: actorId,
    });
    expect(skipped).toMatchObject({ copied: 1, skipped: 1, plants: [] });

    const failing = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          work_date: '2026-09-21',
          slot_index: 2,
          profile_id: employeeId,
          added_by: actorId,
          created_at: '2026-09-21T08:00:00.000Z',
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'database unavailable', code: 'XX000' },
      });
    await expect(copyScheduleDayTeamMembers(adminMock({
      sourceRows: [
        { work_date: '2026-09-20', slot_index: 2, profile_id: employeeId },
      ],
      plantRows: [
        { work_date: '2026-09-20', slot_index: 2, plant_id: plantId },
      ],
      rpc: failing,
    }) as never, {
      fromDate: '2026-09-20',
      toDate: '2026-09-21',
      actorUserId: actorId,
    })).rejects.toMatchObject({ message: 'database unavailable' });
  });
});
