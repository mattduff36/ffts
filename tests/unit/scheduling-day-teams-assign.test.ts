import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignDayTeamToVisit } from '@/lib/server/scheduling-day-teams';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

const { mockDetect, mockCapacity } = vi.hoisted(() => ({
  mockDetect: vi.fn(),
  mockCapacity: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-conflicts', () => ({
  detectEmployeeConflicts: mockDetect,
}));
vi.mock('@/lib/server/scheduling-assignment-capacity', () => ({
  loadEmployeeCapacityForDates: mockCapacity,
}));

const visitId = '55555555-5555-4555-8555-555555555555';
const jobId = '11111111-1111-4111-8111-111111111111';
const clearId = '22222222-2222-4222-8222-222222222222';
const busyId = '44444444-4444-4444-8444-444444444444';
const alreadyId = '66666666-6666-4666-8666-666666666666';

function createAdmin(options: {
  members?: string[];
  memberRows?: Array<{ work_date: string; slot_index: number; profile_id: string }>;
  alreadyOnVisit: string[];
  visitStartsAt?: string;
  rpcErrorFor?: string;
  rpcOverlapFor?: string;
  rpcReplayFor?: Record<string, Record<string, unknown>>;
}) {
  const visitStartsAt = options.visitStartsAt ?? '2026-09-01T08:00:00.000Z';
  const visit = {
    id: visitId,
    job_id: jobId,
    starts_at: visitStartsAt,
    ends_at: '2026-09-01T12:00:00.000Z',
    status: 'planned',
  };
  const memberRows = options.memberRows ?? (options.members ?? []).map((profileId) => ({
    work_date: '2026-09-01',
    slot_index: 1,
    profile_id: profileId,
  }));
  const memberQueries: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (
    _name: string,
    args: { p_resource_id?: string; p_work_date?: string; p_request_id?: string }
  ) => {
    if (_name === 'schedule_assignment_request_replay_v2') {
      const replay = args.p_request_id ? options.rpcReplayFor?.[args.p_request_id] : null;
      return { data: replay ?? null, error: null };
    }
    if (options.rpcErrorFor === args.p_resource_id) {
      return { data: null, error: { message: 'unexpected', code: 'XX000' } };
    }
    if (options.rpcOverlapFor === args.p_resource_id) {
      return { data: null, error: { message: 'RESOURCE_OVERLAP', code: 'P0001' } };
    }
    return {
      data: [{
        assignment_id: `asg-${args.p_resource_id}`,
        job_id: jobId,
        visit_id: visitId,
        work_date: args.p_work_date ?? '2026-09-01',
        profile_id: args.p_resource_id,
        notes: null,
        conflict_override: false,
        conflict_codes: [],
        conflict_override_by: null,
        conflict_override_at: null,
        assigned_by: 'manager-1',
        created_at: '2026-09-01T08:00:00.000Z',
        updated_at: '2026-09-01T08:00:00.000Z',
      }],
      error: null,
    };
  });

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const result = {
      select: () => result,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return result;
      },
      in: (column: string, value: unknown) => {
        filters[`${column}_in`] = value;
        return result;
      },
      order: () => result,
      maybeSingle: async () => {
        if (table === 'schedule_visits') {
          if (filters.id && filters.id !== visitId) {
            return { data: null, error: null };
          }
          return { data: visit, error: null };
        }
        if (table === 'schedule_employee_assignments') {
          const profileId = filters.profile_id;
          if (
            filters.visit_id === visitId
            && typeof profileId === 'string'
            && options.alreadyOnVisit.includes(profileId)
          ) {
            return { data: { id: `existing-${profileId}` }, error: null };
          }
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      then: (
        resolve: (value: { data: unknown; error: null }) => unknown
      ) => {
        if (table === 'schedule_day_team_members') {
          memberQueries.push({ ...filters });
          const workDate = filters.work_date;
          const slotIndex = filters.slot_index;
          const data = memberRows
            .filter((row) => (workDate == null || row.work_date === workDate)
              && (slotIndex == null || row.slot_index === Number(slotIndex)))
            .map((row) => ({
              ...row,
              added_by: 'manager-1',
              created_at: '2026-09-01T07:00:00.000Z',
            }));
          return Promise.resolve(resolve({ data, error: null }));
        }
        if (table === 'schedule_employee_assignments') {
          const visitFilter = filters.visit_id;
          const profileIn = filters.profile_id_in;
          const allowed = Array.isArray(profileIn) ? new Set(profileIn) : null;
          const data = options.alreadyOnVisit
            .filter((profileId) => allowed == null || allowed.has(profileId))
            .map((profileId) => ({
              id: `existing-${profileId}`,
              profile_id: profileId,
              visit_id: visitId,
            }))
            .filter((row) => visitFilter == null || row.visit_id === visitFilter);
          return Promise.resolve(resolve({ data, error: null }));
        }
        if (table === 'profiles') {
          const profileIn = filters.id_in;
          const allowed = Array.isArray(profileIn) ? new Set(profileIn) : null;
          const ids = memberRows
            .map((row) => row.profile_id)
            .filter((id) => allowed == null || allowed.has(id));
          return Promise.resolve(resolve({
            data: ids.map((id) => ({
              id,
              full_name: id === busyId ? 'Busy Person' : 'Clear Person',
            })),
            error: null,
          }));
        }
        return Promise.resolve(resolve({ data: [], error: null }));
      },
    };
    return result;
  };

  return { rpc, from, memberQueries } as unknown as SupabaseClient & {
    memberQueries: Array<Record<string, unknown>>;
  };
}

describe('assignDayTeamToVisit (SCH-TEAM-API-002, SCH-TEAM-API-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCapacity.mockResolvedValue([]);
    mockDetect.mockImplementation(async (_admin: unknown, input: { profileId: string }) => {
      if (input.profileId === busyId) {
        return [{
          code: 'employee_double_booked',
          severity: 'warning',
          message: 'Already booked',
        }];
      }
      return [];
    });
  });

  it('assigns clear members, skips conflicts, and leaves already-on-visit silent', async () => {
    const admin = createAdmin({
      members: [clearId, busyId, alreadyId],
      alreadyOnVisit: [alreadyId],
    });
    const result = await assignDayTeamToVisit(admin, {
      visitId,
      slotIndex: 1,
      actorUserId: 'manager-1',
    });
    if ('status' in result) throw new Error(result.error);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].profile_id).toBe(clearId);
    expect(result.assignments[0].conflict_override).toBe(false);
    expect(result.skipped).toEqual([
      expect.objectContaining({ profile_id: busyId, reason: 'conflict' }),
    ]);
    expect(result.already_assigned_count).toBe(1);
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_schedule_assignment_v1',
      expect.objectContaining({
        p_override_conflicts: false,
        p_resource_id: clearId,
        p_work_date: '2026-09-01',
      })
    );
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it('continues after a concurrent overlap that is not the same visit', async () => {
    const overlapId = '77777777-7777-4777-8777-777777777777';
    const admin = createAdmin({
      members: [overlapId, clearId],
      alreadyOnVisit: [],
      rpcOverlapFor: overlapId,
    });
    const result = await assignDayTeamToVisit(admin, {
      visitId,
      slotIndex: 1,
      actorUserId: 'manager-1',
    });
    if ('status' in result) throw new Error(result.error);
    expect(result.skipped.some((item) => item.reason === 'overlap')).toBe(true);
    expect(result.assignments.map((item) => item.profile_id)).toEqual([clearId]);
  });

  it('SCH-TEAM-API-003 derives the London visit date and rereads that date and slot', async () => {
    const londonNextDayId = '99999999-9999-4999-8999-999999999999';
    const wrongDateId = clearId;
    const admin = createAdmin({
      memberRows: [
        { work_date: '2026-09-01', slot_index: 1, profile_id: wrongDateId },
        { work_date: '2026-09-02', slot_index: 1, profile_id: londonNextDayId },
        { work_date: '2026-09-02', slot_index: 2, profile_id: busyId },
      ],
      alreadyOnVisit: [],
      visitStartsAt: '2026-09-01T23:30:00.000Z',
    });
    const result = await assignDayTeamToVisit(admin, {
      visitId,
      slotIndex: 1,
      actorUserId: 'manager-1',
    });
    if ('status' in result) throw new Error(result.error);
    expect(admin.memberQueries).toEqual([
      expect.objectContaining({ work_date: '2026-09-02', slot_index: 1 }),
    ]);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].profile_id).toBe(londonNextDayId);
    expect(result.assignments[0].work_date).toBe('2026-09-02');
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_schedule_assignment_v1',
      expect.objectContaining({
        p_override_conflicts: false,
        p_resource_id: londonNextDayId,
        p_work_date: '2026-09-02',
      })
    );
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'create_schedule_assignment_v1',
      expect.objectContaining({ p_resource_id: wrongDateId })
    );
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'create_schedule_assignment_v1',
      expect.objectContaining({ p_resource_id: busyId })
    );
  });

  it('reports a partial error without dropping earlier assignments', async () => {
    const failId = '88888888-8888-4888-8888-888888888888';
    const admin = createAdmin({
      members: [clearId, failId],
      alreadyOnVisit: [],
      rpcErrorFor: failId,
    });
    const result = await assignDayTeamToVisit(admin, {
      visitId,
      slotIndex: 1,
      actorUserId: 'manager-1',
    });
    if ('status' in result) throw new Error(result.error);
    expect(result.assignments).toHaveLength(1);
    expect(result.partial_error).toMatch(/already be on the visit|try the rest/i);
  });

  it('TEAM-SNAPSHOT-001 assigns the gesture-time member snapshot instead of live membership', async () => {
    const snapshotId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const admin = createAdmin({
      members: [clearId, busyId],
      alreadyOnVisit: [],
    });
    const result = await assignDayTeamToVisit(admin, {
      visitId,
      slotIndex: 1,
      actorUserId: 'manager-1',
      memberIds: [snapshotId],
      memberRequestIds: { [snapshotId]: requestId },
    });
    if ('status' in result) throw new Error(result.error);
    expect(admin.memberQueries).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_schedule_assignment_v2',
      expect.objectContaining({
        p_resource_id: snapshotId,
        p_request_id: requestId,
      })
    );
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'create_schedule_assignment_v1',
      expect.objectContaining({ p_resource_id: clearId })
    );
    expect(result.assignments.map((item) => item.profile_id)).toEqual([snapshotId]);
  });

  it('replays a committed member request even when they are already on the visit', async () => {
    const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const admin = createAdmin({
      members: [clearId],
      alreadyOnVisit: [clearId],
      rpcReplayFor: {
        [requestId]: {
          assignment_id: 'asg-replayed',
          job_id: jobId,
          visit_id: visitId,
          work_date: '2026-09-01',
          profile_id: clearId,
          notes: null,
          conflict_override: false,
          conflict_codes: [],
          conflict_override_by: null,
          conflict_override_at: null,
          assigned_by: 'manager-1',
          created_at: '2026-09-01T08:00:00.000Z',
          updated_at: '2026-09-01T08:00:00.000Z',
        },
      },
    });
    const result = await assignDayTeamToVisit(admin, {
      visitId,
      slotIndex: 1,
      actorUserId: 'manager-1',
      memberIds: [clearId],
      memberRequestIds: { [clearId]: requestId },
    });
    if ('status' in result) throw new Error(result.error);
    expect(result.assignments.map((item) => item.id)).toEqual(['asg-replayed']);
    expect(result.already_assigned_count).toBe(1);
    expect(mockDetect).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'create_schedule_assignment_v2',
      expect.anything()
    );
  });
});
