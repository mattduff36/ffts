import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockCreateClient,
  mockCanEffectiveRoleAccessModule,
  mockQuotesOrder,
  mockManualOrder,
  mockManualInsert,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCanEffectiveRoleAccessModule: vi.fn(),
  mockQuotesOrder: vi.fn(),
  mockManualOrder: vi.fn(),
  mockManualInsert: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanEffectiveRoleAccessModule,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

function createQuotesQuery() {
  const query = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: mockQuotesOrder,
  };
  return query;
}

function createManualQuery() {
  const query = {
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: mockManualOrder,
  };
  return query;
}

describe('/api/quotes/work-calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanEffectiveRoleAccessModule.mockResolvedValue(true);
    mockQuotesOrder.mockResolvedValue({
      data: [{ id: 'quote-1', quote_reference: 'Q-001', start_date: '2026-04-25' }],
      error: null,
    });
    mockManualOrder.mockResolvedValue({
      data: [{ id: 'entry-1', title: 'Manual work', start_date: '2026-04-26' }],
      error: null,
    });
    mockManualInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'entry-2', title: 'Manual work' },
          error: null,
        }),
      })),
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return { select: vi.fn(() => createQuotesQuery()) };
        }

        if (table === 'work_calendar_entries') {
          return {
            select: vi.fn(() => createManualQuery()),
            insert: mockManualInsert,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });
  });

  it('returns quote-derived and manual calendar entries', async () => {
    const { GET } = await import('@/app/api/quotes/work-calendar/route');
    const response = await GET(new NextRequest('http://localhost/api/quotes/work-calendar?start=2026-04-01&end=2026-04-30'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.quotes).toHaveLength(1);
    expect(payload.manual_entries).toHaveLength(1);
    expect(mockCanEffectiveRoleAccessModule).toHaveBeenCalledWith('quotes');
  }, 15000);

  it('creates manual entries for quotes users', async () => {
    const { POST } = await import('@/app/api/quotes/work-calendar/route');
    const response = await POST(new NextRequest('http://localhost/api/quotes/work-calendar', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Manual work',
        summary: 'Extra day',
        start_date: '2026-04-26',
        estimated_duration_days: 2,
        quote_id: 'quote-1',
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.entry.id).toBe('entry-2');
    expect(mockManualInsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Manual work',
      quote_id: 'quote-1',
      created_by: 'user-1',
    }));
  });
});
