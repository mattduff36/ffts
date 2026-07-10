import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/management/error-reports/route';
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

function createReportsQuery(rows: Array<Record<string, unknown>>) {
  const result = { data: rows, error: null };
  const query = createSupabaseQueryMock(result, ['eq']);
  const range = vi.fn().mockReturnValue(query);
  const order = vi.fn().mockReturnValue({ range });

  return { order, range, query };
}

describe('GET /api/management/error-reports', () => {
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

    const response = await GET(new NextRequest('http://localhost/api/management/error-reports'));

    expect(response.status).toBe(401);
  });

  it('returns accurate global counts in the default all view', async () => {
    const paginatedReports = [
      {
        id: 'report-1',
        created_by: 'user-1',
        title: 'First',
        description: 'First',
        error_code: null,
        page_url: null,
        user_agent: null,
        additional_context: null,
        status: 'new',
        admin_notes: null,
        resolved_at: null,
        resolved_by: null,
        notification_message_id: null,
        created_at: '2026-03-25T00:00:00Z',
        updated_at: '2026-03-25T00:00:00Z',
      },
      {
        id: 'report-2',
        created_by: 'user-2',
        title: 'Second',
        description: 'Second',
        error_code: null,
        page_url: null,
        user_agent: null,
        additional_context: null,
        status: 'new',
        admin_notes: null,
        resolved_at: null,
        resolved_by: null,
        notification_message_id: null,
        created_at: '2026-03-24T00:00:00Z',
        updated_at: '2026-03-24T00:00:00Z',
      },
    ];
    const allStatuses = [
      { status: 'new' },
      { status: 'new' },
      { status: 'investigating' },
      { status: 'resolved' },
    ];
    const { order, range, query } = createReportsQuery(paginatedReports);
    const profilesIn = vi.fn().mockResolvedValue({
      data: [
        { id: 'user-1', full_name: 'Alex Able' },
        { id: 'user-2', full_name: 'Blake Baker' },
      ],
      error: null,
    });
    const select = vi.fn((columns: string) => {
      if (columns.includes('created_by') && columns.includes('notification_message_id')) {
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
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'error_reports') return { select };
        if (table === 'profiles') return { select: selectProfiles };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/error-reports?limit=2&offset=0')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(0, 1);
    expect(query.eq).not.toHaveBeenCalled();
    expect(profilesIn).toHaveBeenCalledWith('id', ['user-1', 'user-2']);
    expect(payload.reports[0].user).toEqual({ id: 'user-1', full_name: 'Alex Able' });
    expect(payload.reports[1].user).toEqual({ id: 'user-2', full_name: 'Blake Baker' });
    expect(payload.counts).toEqual({
      all: 4,
      new: 2,
      investigating: 1,
      resolved: 1,
    });
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 2,
      has_more: true,
    });
  });

  it('keeps counts global when a status filter is applied', async () => {
    const paginatedReports = [
      {
        id: 'report-3',
        created_by: 'user-3',
        title: 'Third',
        description: 'Third',
        error_code: null,
        page_url: null,
        user_agent: null,
        additional_context: null,
        status: 'investigating',
        admin_notes: null,
        resolved_at: null,
        resolved_by: null,
        notification_message_id: null,
        created_at: '2026-03-23T00:00:00Z',
        updated_at: '2026-03-23T00:00:00Z',
      },
    ];
    const allStatuses = [
      { status: 'new' },
      { status: 'investigating' },
      { status: 'investigating' },
      { status: 'resolved' },
    ];
    const { order, query } = createReportsQuery(paginatedReports);
    const profilesIn = vi.fn().mockResolvedValue({
      data: [{ id: 'user-3', full_name: 'Casey Cole' }],
      error: null,
    });
    const select = vi.fn((columns: string) => {
      if (columns.includes('created_by') && columns.includes('notification_message_id')) {
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
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'error_reports') return { select };
        if (table === 'profiles') return { select: selectProfiles };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/error-reports?status=investigating')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('status', 'investigating');
    expect(payload.reports).toHaveLength(1);
    expect(profilesIn).toHaveBeenCalledWith('id', ['user-3']);
    expect(payload.reports[0].user).toEqual({ id: 'user-3', full_name: 'Casey Cole' });
    expect(payload.counts).toEqual({
      all: 4,
      new: 1,
      investigating: 2,
      resolved: 1,
    });
  });
});
