import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockLoadTags,
  mockSyncTags,
  mockUpdate,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockLoadTags: vi.fn(),
  mockSyncTags: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
  requireSchedulingAccess: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-tags', () => ({
  loadTagsForScheduleJob: mockLoadTags,
  syncScheduleJobTags: mockSyncTags,
}));

vi.mock('@/lib/server/customer-sites', () => ({
  resolveCustomerSiteSelection: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'schedule_jobs') throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                start_date: '2026-07-13',
                end_date: '2026-07-19',
                source_type: 'quote',
                customer_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                customer_site_id: null,
                site_address: 'Saved snapshot',
              },
              error: null,
            }),
          }),
        }),
        update: mockUpdate,
      };
    },
  }),
}));

const params = {
  params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
};

function request(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost/api/scheduling/jobs/11111111-1111-4111-8111-111111111111',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('PATCH /api/scheduling/jobs/[id] classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    mockLoadTags.mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Hospital',
        color: 'slate',
        description: null,
        is_active: true,
      },
    ]);
    mockSyncTags.mockResolvedValue(undefined);
    mockUpdate.mockImplementation((values) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: { id: '11111111-1111-4111-8111-111111111111', ...values },
            error: null,
          }),
        }),
      }),
    }));
  });

  it('allows tag and readiness edits on a Quote-owned job', async () => {
    const { PATCH } = await import('@/app/api/scheduling/jobs/[id]/route');
    const response = await PATCH(
      request({
        is_drop_on_ready: true,
        tag_ids: ['22222222-2222-4222-8222-222222222222'],
      }),
      params
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        is_drop_on_ready: true,
        updated_by: 'manager-1',
      })
    );
    expect(mockSyncTags).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      ['22222222-2222-4222-8222-222222222222'],
      'manager-1'
    );
    expect(payload.job.tags[0].name).toBe('Hospital');
  });

  it('continues to reject Quote-owned planning field edits', async () => {
    const { PATCH } = await import('@/app/api/scheduling/jobs/[id]/route');
    const response = await PATCH(request({ title: 'Changed outside Quotes' }), params);

    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSyncTags).not.toHaveBeenCalled();
  });
});
