import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockAccess,
  mockAppendTimeline,
  mockQuote,
  mockQuoteList,
  mockScheduleJob,
  mockUpdate,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockAppendTimeline: vi.fn(),
  mockQuote: vi.fn(),
  mockQuoteList: vi.fn(),
  mockScheduleJob: vi.fn(),
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
    from: (table: string) => {
      let updateValues: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: () => query,
        update: (values: Record<string, unknown>) => {
          updateValues = values;
          mockUpdate(values);
          return query;
        },
        order: async () => ({
          data: table === 'quotes' ? mockQuoteList() : [],
          error: null,
        }),
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
    mockScheduleJob.mockReturnValue({
      id: '22222222-2222-4222-8222-222222222222',
      quote_id: quoteId,
      source_type: 'quote',
    });
    mockAppendTimeline.mockResolvedValue(undefined);
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
});
