import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockProjects,
  mockScheduledProjects,
  mockSensitiveAccess,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockProjects: vi.fn(),
  mockScheduledProjects: vi.fn(),
  mockSensitiveAccess: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockSensitiveAccess,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: mockProjects(), error: null }),
        not: async () => ({ data: mockScheduledProjects(), error: null }),
      };
      if (table === 'quote_project_numbers' || table === 'schedule_jobs') return query;
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

describe('GET /api/scheduling/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    mockSensitiveAccess.mockResolvedValue(null);
    mockProjects.mockReturnValue([
      { id: 'project-1', project_reference: '60001-MD', title: 'Available', status: 'open' },
      { id: 'project-2', project_reference: '60002-MD', title: 'Scheduled', status: 'open' },
    ]);
    mockScheduledProjects.mockReturnValue([
      { quote_project_number_id: 'project-2' },
    ]);
  });

  it('lists only open Project Numbers without a schedule projection', async () => {
    const { GET } = await import('@/app/api/scheduling/projects/route');
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.projects).toEqual([
      expect.objectContaining({ id: 'project-1', project_reference: '60001-MD' }),
    ]);
  });

  it('does not expose Project Numbers without Quotes sensitive access', async () => {
    mockSensitiveAccess.mockResolvedValue(
      NextResponse.json({ error: 'Sensitive access PIN required.' }, { status: 428 })
    );
    const { GET } = await import('@/app/api/scheduling/projects/route');
    const response = await GET();

    expect(response.status).toBe(428);
    expect(mockProjects).not.toHaveBeenCalled();
  });
});
