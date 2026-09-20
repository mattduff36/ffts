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

function adminMock(options: {
  sourceRows?: Array<Record<string, unknown>>;
  sourceError?: { code?: string; message?: string } | null;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table !== 'schedule_day_team_members') {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: options.sourceRows || [],
                error: options.sourceError || null,
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
        { work_date: '2026-09-20', slot_index: 8, profile_id: '44444444-4444-4444-8444-444444444444' },
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

    expect(result).toMatchObject({ copied: 1, skipped: 1 });
  });
});
