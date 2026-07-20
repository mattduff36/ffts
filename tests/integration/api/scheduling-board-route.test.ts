import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { mockAccess, mockLoadBoard, mockCreateAdminClient } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockLoadBoard: vi.fn(),
  mockCreateAdminClient: vi.fn(() => ({ name: 'admin-client' })),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));
vi.mock('@/lib/server/scheduling-board', () => ({
  loadSchedulingBoard: mockLoadBoard,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

describe('GET /api/scheduling/board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    mockLoadBoard.mockResolvedValue({
      week: { start: '2026-07-13', end: '2026-07-19' },
      jobs: [{ id: 'job-1' }],
      assignments: [],
      resources: { employees: [], plant: [] },
      plant_unavailability: [],
    });
  });

  it('normalizes the requested week and returns the assembled board', async () => {
    const { GET } = await import('@/app/api/scheduling/board/route');
    const response = await GET(
      new NextRequest('http://localhost/api/scheduling/board?week_start=2026-07-15')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.jobs).toHaveLength(1);
    expect(mockLoadBoard).toHaveBeenCalledWith(
      expect.anything(),
      '2026-07-13',
      '2026-07-19'
    );
  });

  it('rejects employees from the management board', async () => {
    mockAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });
    const { GET } = await import('@/app/api/scheduling/board/route');
    const response = await GET(new NextRequest('http://localhost/api/scheduling/board'));

    expect(response.status).toBe(403);
    expect(mockLoadBoard).not.toHaveBeenCalled();
  });

  it('returns an actionable setup error when scheduling tables are missing', async () => {
    mockLoadBoard.mockRejectedValue({
      code: '42P01',
      message: 'relation "schedule_jobs" does not exist',
    });
    const { GET } = await import('@/app/api/scheduling/board/route');
    const response = await GET(new NextRequest('http://localhost/api/scheduling/board'));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: 'Scheduling setup is incomplete. Run the scheduling module migration and try again.',
      code: 'SCHEDULING_NOT_READY',
    });
  });
});
