import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockDetectEmployeeConflicts,
  mockDetectPlantConflicts,
  mockInsert,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockDetectEmployeeConflicts: vi.fn(),
  mockDetectPlantConflicts: vi.fn(),
  mockInsert: vi.fn(),
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
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
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
      if (table === 'schedule_employee_assignments' || table === 'schedule_plant_assignments') {
        return {
          insert: mockInsert,
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
    mockInsert.mockImplementation((rows) => ({
      select: async () => ({ data: rows, error: null }),
    }));
  });

  it('creates a clean day-level employee assignment', async () => {
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      resource_type: 'employee',
      resource_id: '22222222-2222-4222-8222-222222222222',
      work_dates: ['2026-07-14'],
    }));

    expect(response.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        work_date: '2026-07-14',
        profile_id: '22222222-2222-4222-8222-222222222222',
        conflict_override: false,
      }),
    ]);
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
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('creates a visit-scoped assignment and passes visit times to conflict detection', async () => {
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      visit_id: '55555555-5555-4555-8555-555555555555',
      resource_type: 'employee',
      resource_id: '22222222-2222-4222-8222-222222222222',
    }));

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
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        visit_id: '55555555-5555-4555-8555-555555555555',
        work_date: '2026-07-14',
      }),
    ]);
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
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        plant_id: '44444444-4444-4444-8444-444444444444',
        conflict_override: true,
        conflict_codes: ['plant_unavailable'],
        conflict_override_by: managerAccess.userId,
        conflict_override_at: expect.any(String),
      }),
    ]);
  });

  it('rejects writes from non-managers', async () => {
    mockAccess.mockResolvedValue({ allowed: false, status: 403, error: 'Manager required' });
    const { POST } = await import('@/app/api/scheduling/assignments/route');
    const response = await POST(request({}));

    expect(response.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
