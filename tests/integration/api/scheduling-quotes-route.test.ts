import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockAppendTimeline,
  mockQuote,
  mockQuoteList,
  mockRelatedJobs,
  mockRelatedVisits,
  mockScheduleJob,
  mockRpc,
  mockUpdate,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockAppendTimeline: vi.fn(),
  mockQuote: vi.fn(),
  mockQuoteList: vi.fn(),
  mockRelatedJobs: vi.fn(),
  mockRelatedVisits: vi.fn(),
  mockScheduleJob: vi.fn(),
  mockRpc: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/lib/server/scheduling-auth', () => ({
  requireSchedulingManagerAccess: mockAccess,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  appendQuoteTimelineEvent: mockAppendTimeline,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
    from: (table: string) => {
      let updateValues: Record<string, unknown> | null = null;
      const resolveList = () => {
        if (table === 'quotes') return { data: mockQuoteList(), error: null };
        if (table === 'schedule_jobs') return { data: mockRelatedJobs(), error: null };
        if (table === 'schedule_visits') return { data: mockRelatedVisits(), error: null };
        return { data: [], error: null };
      };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        neq: () => query,
        update: (values: Record<string, unknown>) => {
          updateValues = values;
          mockUpdate(values);
          return query;
        },
        order: async () => resolveList(),
        then: (
          onfulfilled?: ((value: { data: unknown; error: null }) => unknown) | null,
          onrejected?: ((reason: unknown) => unknown) | null
        ) => Promise.resolve(resolveList()).then(onfulfilled, onrejected),
        maybeSingle: async () => {
          if (table === 'schedule_jobs') {
            return { data: mockScheduleJob(), error: null };
          }
          if (updateValues) return { data: { id: mockQuote().id }, error: null };
          return { data: mockQuote(), error: null };
        },
      };
      return query;
    },
  }),
}));

const quoteId = '11111111-1111-4111-8111-111111111111';

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scheduling/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/scheduling/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    mockQuote.mockReturnValue({
      id: quoteId,
      quote_reference: 'Q-100',
      quote_thread_id: 'thread-1',
      is_latest_version: true,
      commercial_status: 'open',
      start_date: null,
    });
    mockQuoteList.mockReturnValue([{
      id: quoteId,
      quote_reference: 'Q-100',
      base_quote_reference: 'Q-100',
      subject_line: 'Crown reduction',
      project_description: null,
      status: 'sent',
      start_date: null,
      estimated_duration_days: null,
      customer: { company_name: 'Example Customer' },
    }]);
    mockRelatedJobs.mockReturnValue([]);
    mockRelatedVisits.mockReturnValue([]);
    mockScheduleJob.mockReturnValue({
      id: '22222222-2222-4222-8222-222222222222',
      quote_id: quoteId,
      source_type: 'quote',
    });
    mockAppendTimeline.mockResolvedValue(undefined);
    mockRpc.mockResolvedValue({
      data: { job: mockScheduleJob(), visit: { id: 'visit-1' } },
      error: null,
    });
  });

  it('lists a minimal set of latest open Quote candidates for scheduling managers', async () => {
    const { GET } = await import('@/app/api/scheduling/quotes/route');
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.quotes).toEqual([expect.objectContaining({
      id: quoteId,
      base_quote_reference: 'Q-100',
      title: 'Crown reduction',
      customer_name: 'Example Customer',
      status: 'sent',
    })]);
    expect(payload.quotes[0]).not.toHaveProperty('total');
  });

  it('keeps a dated quote with no timed visit in Resources', async () => {
    mockQuoteList.mockReturnValue([{
      ...mockQuoteList()[0],
      start_date: '2026-07-13',
      estimated_duration_days: 2,
    }]);
    const { GET } = await import('@/app/api/scheduling/quotes/route');
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.quotes.map((quote: { id: string }) => quote.id)).toEqual([quoteId]);
  });

  it('excludes a quote that already has a non-cancelled timed visit', async () => {
    mockRelatedJobs.mockReturnValue([{ id: 'job-timed', quote_id: quoteId }]);
    mockRelatedVisits.mockReturnValue([{
      job_id: 'job-timed',
      starts_at: '2026-07-13T07:00:00.000Z',
      ends_at: '2026-07-13T10:00:00.000Z',
      status: 'planned',
    }]);
    const { GET } = await import('@/app/api/scheduling/quotes/route');
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.quotes).toEqual([]);
  });

  it('keeps a quote whose only visit is cancelled or has no positive duration', async () => {
    mockRelatedJobs.mockReturnValue([{ id: 'job-open', quote_id: quoteId }]);
    mockRelatedVisits.mockReturnValue([
      {
        job_id: 'job-open',
        starts_at: '2026-07-13T07:00:00.000Z',
        ends_at: '2026-07-13T10:00:00.000Z',
        status: 'cancelled',
      },
      {
        job_id: 'job-open',
        starts_at: '2026-07-13T11:00:00.000Z',
        ends_at: '2026-07-13T11:00:00.000Z',
        status: 'planned',
      },
    ]);
    const { GET } = await import('@/app/api/scheduling/quotes/route');
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.quotes.map((quote: { id: string }) => quote.id)).toEqual([quoteId]);
  });

  it('updates planning dates without changing Quote status and audits the action', async () => {
    const { POST } = await import('@/app/api/scheduling/quotes/route');
    const response = await POST(postRequest({
      quote_id: quoteId,
      start_date: '2026-07-27',
      end_date: '2026-07-29',
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      start_date: '2026-07-27',
      estimated_duration_days: 3,
      updated_by: 'manager-1',
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('status');
    expect(mockAppendTimeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        quoteId,
        eventType: 'schedule_updated',
        actorUserId: 'manager-1',
      })
    );
    expect(payload.job.quote_id).toBe(quoteId);
  });

  it('rejects a stale or commercially closed Quote', async () => {
    mockQuote.mockReturnValue({
      ...mockQuote(),
      commercial_status: 'closed',
    });
    const { POST } = await import('@/app/api/scheduling/quotes/route');
    const response = await POST(postRequest({
      quote_id: quoteId,
      start_date: '2026-07-27',
      end_date: '2026-07-29',
    }));

    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAppendTimeline).not.toHaveBeenCalled();
  });

  it('SCHED-CONTRACT-007 returns authoritative job and visit from the atomic RPC', async () => {
    mockQuote.mockReturnValue({
      ...mockQuote(),
      estimated_duration_minutes: 120,
    });
    const { POST } = await import('@/app/api/scheduling/quotes/route');
    const response = await POST(postRequest({
      quote_id: quoteId,
      start_date: '2026-07-27',
      end_date: '2026-07-27',
      initial_visit: {
        starts_at: '2026-07-27T07:00:00.000Z',
        ends_at: '2026-07-27T09:00:00.000Z',
      },
    }));

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'schedule_quote_with_initial_visit',
      expect.objectContaining({
        p_quote_id: quoteId,
        p_actor_user_id: 'manager-1',
      })
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      job: { ...mockScheduleJob(), tags: [] },
      visit: { id: 'visit-1' },
    });
  });
});
