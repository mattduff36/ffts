import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { mockAccess, mockJob, mockInsert } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockJob: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'schedule_jobs') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mockJob }),
          }),
        };
      }
      if (table === 'schedule_visits') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [{ sequence_number: 2 }], error: null }),
              }),
            }),
          }),
          insert: mockInsert,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/visits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/scheduling/visits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: '33333333-3333-4333-8333-333333333333',
    });
    mockJob.mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        start_date: '2026-07-20',
        end_date: '2026-07-24',
      },
      error: null,
    });
    mockInsert.mockImplementation((value) => ({
      select: () => ({
        single: async () => ({ data: { id: 'visit-1', ...value }, error: null }),
      }),
    }));
  });

  it('creates the next timed visit within the Quote planning window', async () => {
    const { POST } = await import('@/app/api/scheduling/visits/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      title: 'Second visit',
      starts_at: '2026-07-21T08:00:00.000Z',
      ends_at: '2026-07-21T12:00:00.000Z',
    }));

    expect(response.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence_number: 3,
        starts_at: '2026-07-21T08:00:00.000Z',
      })
    );
  });

  it('rejects a visit outside the Quote planning window', async () => {
    const { POST } = await import('@/app/api/scheduling/visits/route');
    const response = await POST(request({
      job_id: '11111111-1111-4111-8111-111111111111',
      starts_at: '2026-07-25T08:00:00.000Z',
      ends_at: '2026-07-25T12:00:00.000Z',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'The visit must fall within the Quote planning dates.',
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects non-manager writes', async () => {
    mockAccess.mockResolvedValue({ allowed: false, status: 403, error: 'Manager required' });
    const { POST } = await import('@/app/api/scheduling/visits/route');
    const response = await POST(request({}));
    expect(response.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
