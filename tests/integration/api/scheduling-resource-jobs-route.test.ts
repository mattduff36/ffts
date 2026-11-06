import { beforeEach, describe, expect, it, vi } from 'vitest';

const { access, range, select, loadTags, customers } = vi.hoisted(() => ({
  access: vi.fn(),
  range: vi.fn(),
  select: vi.fn(),
  loadTags: vi.fn(),
  customers: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({ requireSchedulingManagerAccess: access }));
vi.mock('@/lib/server/scheduling-tags', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/scheduling-tags')>(),
  loadScheduleJobTags: loadTags,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'customers') return { select: () => ({ order: customers }) };
      const query = { select, order: () => query, range };
      select.mockReturnValue(query);
      return query;
    },
  }),
}));

import { GET } from '@/app/api/scheduling/jobs/route';

describe('Resources Jobs metadata and pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({ allowed: true, userId: 'manager' });
    customers.mockResolvedValue({ data: [], error: null });
    loadTags.mockResolvedValue([]);
  });

  it('preserves linked tags/customer/site and every row beyond the API page limit', async () => {
    const tag = { id: 'tag-1', name: 'Urgent', color: '#ff0000', description: null, is_active: true };
    const job = {
      id: 'job-0', job_reference: 'TEST-0', title: 'Fictional work',
      status: 'scheduled', start_date: '2000-01-01', end_date: '2000-01-02',
      customer: [{ company_name: 'Fictional Customer' }],
      customer_site: { site_name: 'Fictional Site' },
      tag_links: [{ tag }, { tag: { ...tag, id: 'inactive', is_active: false } }],
      board_sequence: '17', is_drop_on_ready: false,
    };
    range.mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, index) => ({ ...job, id: `job-${index}` })), error: null,
    }).mockResolvedValueOnce({ data: [{ ...job, id: 'job-500' }], error: null });

    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.jobs).toHaveLength(501);
    expect(new Set(payload.jobs.map((item: { id: string }) => item.id)).size).toBe(501);
    expect(payload.jobs[500]).toMatchObject({
      id: 'job-500', customer_name: 'Fictional Customer', site_name: 'Fictional Site',
      tags: [tag], board_sequence: 17, start_date: '2000-01-01', end_date: '2000-01-02',
    });
    expect(select).toHaveBeenCalledWith(expect.stringContaining('customer_site:customer_sites!schedule_jobs_customer_site_id_fkey'));
    expect(range.mock.calls).toEqual([[0, 499], [500, 999]]);
  });

  it('fails explicitly instead of returning a truncated success when a later page fails', async () => {
    range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'fictional page failure' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unable to load schedule jobs.' });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('denies non-managers before any query', async () => {
    access.mockResolvedValue({ allowed: false, status: 403, error: 'Forbidden' });
    expect((await GET()).status).toBe(403);
    expect(range).not.toHaveBeenCalled();
  });
});
