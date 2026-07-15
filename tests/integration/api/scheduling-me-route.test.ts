import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { mockAccess, mockLoadSelf } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockLoadSelf: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingAccess: mockAccess,
}));
vi.mock('@/lib/server/scheduling-board', () => ({
  loadSchedulingSelf: mockLoadSelf,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ name: 'admin-client' }),
}));

describe('GET /api/scheduling/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'employee-1',
      isManagerOrAdmin: false,
    });
    mockLoadSelf.mockResolvedValue({
      week: { start: '2026-07-13', end: '2026-07-19' },
      assignments: [{ id: 'assignment-1', profile_id: 'employee-1' }],
      jobs: [{ id: 'job-1' }],
      plant_assignments: [],
    });
  });

  it('passes only the authenticated profile to the self loader', async () => {
    const { GET } = await import('@/app/api/scheduling/me/route');
    const response = await GET(
      new NextRequest('http://localhost/api/scheduling/me?week_start=2026-07-15')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.assignments[0].profile_id).toBe('employee-1');
    expect(mockLoadSelf).toHaveBeenCalledWith(
      expect.anything(),
      'employee-1',
      '2026-07-13',
      '2026-07-19'
    );
  });

  it('does not query data without module access', async () => {
    mockAccess.mockResolvedValue({ allowed: false, status: 403, error: 'Scheduling access required' });
    const { GET } = await import('@/app/api/scheduling/me/route');
    const response = await GET(new NextRequest('http://localhost/api/scheduling/me'));

    expect(response.status).toBe(403);
    expect(mockLoadSelf).not.toHaveBeenCalled();
  });
});
