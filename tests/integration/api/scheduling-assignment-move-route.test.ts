import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockDetectEmployeeConflicts,
  mockUpdate,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockDetectEmployeeConflicts: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));

vi.mock('@/lib/server/scheduling-conflicts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/scheduling-conflicts')>(
    '@/lib/server/scheduling-conflicts'
  );
  return {
    ...actual,
    detectEmployeeConflicts: mockDetectEmployeeConflicts,
    detectPlantConflicts: vi.fn(),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'schedule_employee_assignments') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  profile_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                },
                error: null,
              }),
            }),
          }),
          update: mockUpdate,
        };
      }
      if (table === 'schedule_visits') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  job_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  sequence_number: 2,
                  starts_at: '2026-07-14T13:00:00.000Z',
                  ends_at: '2026-07-14T17:00:00.000Z',
                  status: 'planned',
                  job: {
                    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                    start_date: '2026-07-13',
                    end_date: '2026-07-19',
                  },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function request(overrideConflicts = false) {
  return new NextRequest(
    'http://localhost/api/scheduling/assignments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource_type: 'employee',
        visit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        override_conflicts: overrideConflicts,
      }),
    }
  );
}

const params = {
  params: Promise.resolve({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
};

describe('PATCH /api/scheduling/assignments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      isManagerOrAdmin: true,
    });
    mockDetectEmployeeConflicts.mockResolvedValue([]);
    mockUpdate.mockImplementation((values) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { ...values, id: 'assignment-1' }, error: null }),
        }),
      }),
    }));
  });

  it('moves an assignment and excludes itself from overlap detection', async () => {
    const { PATCH } = await import('@/app/api/scheduling/assignments/[id]/route');
    const response = await PATCH(request(), params);

    expect(response.status).toBe(200);
    expect(mockDetectEmployeeConflicts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workDate: '2026-07-14',
        excludeAssignmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        visit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        conflict_override: false,
      })
    );
  });

  it('returns conflicts before moving unless a manager overrides them', async () => {
    mockDetectEmployeeConflicts.mockResolvedValue([
      {
        code: 'employee_absent',
        severity: 'warning',
        message: 'Employee is absent.',
      },
    ]);
    const { PATCH } = await import('@/app/api/scheduling/assignments/[id]/route');

    const blockedResponse = await PATCH(request(), params);
    expect(blockedResponse.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();

    const overrideResponse = await PATCH(request(true), params);
    expect(overrideResponse.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        conflict_override: true,
        conflict_codes: ['employee_absent'],
      })
    );
  });
});
