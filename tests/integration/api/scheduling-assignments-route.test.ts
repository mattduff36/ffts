import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockDetectEmployeeConflicts,
  mockDetectPlantConflicts,
  mockRpc,
  mockLoadCapacity,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockDetectEmployeeConflicts: vi.fn(),
  mockDetectPlantConflicts: vi.fn(),
  mockRpc: vi.fn(),
  mockLoadCapacity: vi.fn(),
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
    detectPlantConflicts: mockDetectPlantConflicts,
  };
});
vi.mock('@/lib/server/scheduling-assignment-capacity', () => ({
  loadEmployeeCapacityForDates: mockLoadCapacity,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
    from: (table: string) => {
      if (table === 'schedule_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: '11111111-1111-4111-8111-111111111111',
                  start_date: '2026-07-13',
                  end_date: '2026-07-19',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'schedule_visits') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: '55555555-5555-4555-8555-555555555555',
                  job_id: '11111111-1111-4111-8111-111111111111',
                  starts_at: '2026-07-14T08:00:00.000Z',
                  ends_at: '2026-07-14T12:00:00.000Z',
                  status: 'planned',
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

const managerAccess = {
  allowed: true,
  status: 200,
  userId: '33333333-3333-4333-8333-333333333333',
  isManagerOrAdmin: true,
};

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/scheduling/assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(managerAccess);
    mockDetectEmployeeConflicts.mockResolvedValue([]);
    mockDetectPlantConflicts.mockResolvedValue([]);
    mockLoadCapacity.mockResolvedValue([{
      date: '2026-07-14',
      available_employee_count: 1,
      total_available_minutes: 450,
      employees: [],
    }]);
    mockRpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      const workDates = (args.p_work_dates as string[]) || [];
      const codesByDate = (args.p_conflict_codes_by_date || {}) as Record<string, string[]>;
      return {
        data: workDates.map((workDate, index) => ({
          assignment_id: `66666666-6666-4666-8666-66666666666${index}`,
          resource_type: args.p_resource_type,
          job_id: args.p_job_id,
          visit_id: args.p_visit_id,
          work_date: workDate,
          profile_id: args.p_resource_type === 'employee' ? args.p_resource_id : null,
          plant_id: args.p_resource_type === 'plant' ? args.p_resource_id : null,
          notes: null,
          conflict_override:
            Boolean(args.p_override_conflicts)
            && (codesByDate[workDate] || []).length > 0,
          conflict_codes: codesByDate[workDate] || [],
          conflict_override_by: null,
          conflict_override_at: null,
          assigned_by: managerAccess.userId,
          created_at: '2026-07-14T08:00:00.000Z',
          updated_at: '2026-07-14T08:00:00.000Z',
        })),
        error: null,
      };
    });
  });

  it('creates a clean day-level employee assignment through the locked bulk RPC', async () => {
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      resource_type: 'employee',
      resource_id: '22222222-2222-4222-8222-222222222222',
      work_dates: ['2026-07-14'],
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_schedule_assignments_bulk_v1',
      expect.objectContaining({
        p_visit_id: null,
        p_work_dates: ['2026-07-14'],
        p_resource_id: '22222222-2222-4222-8222-222222222222',
      })
    );
    expect(mockLoadCapacity).toHaveBeenCalledWith(expect.anything(), ['2026-07-14']);
    expect(payload.employee_capacity).toHaveLength(1);
  });

  it('returns structured conflicts before writing', async () => {
    mockDetectEmployeeConflicts.mockResolvedValue([
      {
        code: 'employee_absent',
        severity: 'warning',
        message: 'Employee is absent.',
      },
    ]);
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      resource_type: 'employee',
      resource_id: '22222222-2222-4222-8222-222222222222',
      work_dates: ['2026-07-14'],
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.conflicts_by_date['2026-07-14'][0].code).toBe('employee_absent');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('creates a visit-scoped assignment through the transactional RPC', async () => {
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      visit_id: '55555555-5555-4555-8555-555555555555',
      resource_type: 'employee',
      resource_id: '22222222-2222-4222-8222-222222222222',
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockDetectEmployeeConflicts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workDate: '2026-07-14',
        visit: expect.objectContaining({
          id: '55555555-5555-4555-8555-555555555555',
        }),
      })
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'create_schedule_assignments_bulk_v1',
      expect.objectContaining({
        p_visit_id: '55555555-5555-4555-8555-555555555555',
        p_resource_id: '22222222-2222-4222-8222-222222222222',
        p_work_dates: ['2026-07-14'],
      })
    );
    expect(payload.employee_capacity).toHaveLength(1);
  });

  it('maps concurrent overlap failures from the RPC to 409', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'RESOURCE_OVERLAP' },
    });
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      visit_id: '55555555-5555-4555-8555-555555555555',
      resource_type: 'employee',
      resource_id: '22222222-2222-4222-8222-222222222222',
    }));

    expect(response.status).toBe(409);
  });

  it('audits an explicit manager conflict override', async () => {
    mockDetectPlantConflicts.mockResolvedValue([
      {
        code: 'plant_unavailable',
        severity: 'warning',
        message: 'Plant unavailable.',
      },
    ]);
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      resource_type: 'plant',
      resource_id: '44444444-4444-4444-8444-444444444444',
      work_dates: ['2026-07-14'],
      override_conflicts: true,
    }));

    expect(response.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_schedule_assignments_bulk_v1',
      expect.objectContaining({
        p_override_conflicts: true,
        p_conflict_codes_by_date: {
          '2026-07-14': ['plant_unavailable'],
        },
        p_resource_id: '44444444-4444-4444-8444-444444444444',
      })
    );
  });

  it('creates multi-date assignments through one all-or-nothing bulk RPC', async () => {
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      resource_type: 'employee',
      resource_id: '22222222-2222-4222-8222-222222222222',
      work_dates: ['2026-07-14', '2026-07-15'],
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_schedule_assignments_bulk_v1',
      expect.objectContaining({
        p_work_dates: ['2026-07-14', '2026-07-15'],
      })
    );
    expect(payload.assignments).toHaveLength(2);
  });

  it('rejects writes from non-managers', async () => {
    mockAccess.mockResolvedValue({ allowed: false, status: 403, error: 'Manager required' });
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({}));

    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
