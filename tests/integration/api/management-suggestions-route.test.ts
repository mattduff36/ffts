import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/management/suggestions/route';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

const { mockCreateClient, mockCanAccess, mockLogServerError } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCanAccess: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

function createSuggestionsQuery(rows: Array<Record<string, unknown>>) {
  const result = { data: rows, error: null };
  const query = createSupabaseQueryMock(result, ['eq']);
  const range = vi.fn().mockReturnValue(query);
  const order = vi.fn().mockReturnValue({ range });

  return { order, range, query };
}

describe('GET /api/management/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockResolvedValue(true);
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Unauthorized'),
        }),
      },
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/management/suggestions'));

    expect(response.status).toBe(401);
  });

  it('returns accurate global counts in the default all view', async () => {
    const paginatedSuggestions = [
      { id: 'suggestion-1', created_by: 'user-1', title: 'First', body: 'Body', page_hint: null, status: 'new', admin_notes: null, created_at: '2026-03-24T00:00:00Z', updated_at: '2026-03-24T00:00:00Z' },
      { id: 'suggestion-2', created_by: 'user-2', title: 'Second', body: 'Body', page_hint: null, status: 'new', admin_notes: null, created_at: '2026-03-23T00:00:00Z', updated_at: '2026-03-23T00:00:00Z' },
    ];
    const allStatuses = [
      { status: 'new' },
      { status: 'new' },
      { status: 'under_review' },
      { status: 'planned' },
      { status: 'completed' },
    ];
    const { order, range, query } = createSuggestionsQuery(paginatedSuggestions);
    const profilesIn = vi.fn().mockResolvedValue({
      data: [
        { id: 'user-1', full_name: 'Alex Able' },
        { id: 'user-2', full_name: 'Blake Baker' },
      ],
      error: null,
    });
    const selectSuggestions = vi.fn((columns: string) => {
      if (columns === 'id, created_by, title, body, page_hint, status, admin_notes, created_at, updated_at') {
        return { order };
      }

      if (columns === 'status') {
        return Promise.resolve({ data: allStatuses, error: null });
      }

      throw new Error(`Unexpected select columns: ${columns}`);
    });
    const selectProfiles = vi.fn(() => ({
      in: profilesIn,
    }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') {
          return { select: selectSuggestions };
        }

        if (table === 'profiles') {
          return { select: selectProfiles };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/suggestions?limit=2&offset=0')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(0, 1);
    expect(query.eq).not.toHaveBeenCalled();
    expect(profilesIn).toHaveBeenCalledWith('id', ['user-1', 'user-2']);
    expect(payload.counts).toEqual({
      all: 5,
      new: 2,
      under_review: 1,
      planned: 1,
      completed: 1,
      declined: 0,
    });
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 2,
      has_more: true,
    });
  });

  it('keeps counts global when a status filter is applied', async () => {
    const paginatedSuggestions = [
      { id: 'suggestion-3', created_by: 'user-3', title: 'Third', body: 'Body', page_hint: null, status: 'planned', admin_notes: null, created_at: '2026-03-22T00:00:00Z', updated_at: '2026-03-22T00:00:00Z' },
    ];
    const allStatuses = [
      { status: 'new' },
      { status: 'planned' },
      { status: 'planned' },
      { status: 'declined' },
    ];
    const { order, query } = createSuggestionsQuery(paginatedSuggestions);
    const profilesIn = vi.fn().mockResolvedValue({
      data: [{ id: 'user-3', full_name: 'Casey Cole' }],
      error: null,
    });
    const selectSuggestions = vi.fn((columns: string) => {
      if (columns === 'id, created_by, title, body, page_hint, status, admin_notes, created_at, updated_at') {
        return { order };
      }

      if (columns === 'status') {
        return Promise.resolve({ data: allStatuses, error: null });
      }

      throw new Error(`Unexpected select columns: ${columns}`);
    });
    const selectProfiles = vi.fn(() => ({
      in: profilesIn,
    }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') {
          return { select: selectSuggestions };
        }

        if (table === 'profiles') {
          return { select: selectProfiles };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/suggestions?status=planned')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('status', 'planned');
    expect(payload.suggestions).toHaveLength(1);
    expect(payload.counts).toEqual({
      all: 4,
      new: 1,
      under_review: 0,
      planned: 2,
      completed: 0,
      declined: 1,
    });
  });
});
