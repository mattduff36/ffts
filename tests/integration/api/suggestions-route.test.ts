import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET, POST } from '@/app/api/suggestions/route';

const { mockCreateClient, mockLogServerError } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

describe('/api/suggestions submitter projections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('lists only the authenticated user suggestions without internal notes', async () => {
    const suggestionRow = {
      id: 'suggestion-1',
      created_by: 'user-1',
      title: 'Suggestion',
      body: 'Body',
      page_hint: null,
      status: 'new',
      admin_notes: 'Do not expose this',
      created_at: '2026-07-21T20:00:00Z',
      updated_at: '2026-07-21T20:00:00Z',
    };
    const range = vi.fn().mockResolvedValue({ data: [suggestionRow], error: null });
    const order = vi.fn(() => ({ range }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/suggestions?limit=25')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('created_by', 'user-1');
    expect(select).toHaveBeenCalledWith(
      'id, created_by, title, body, page_hint, status, created_at, updated_at'
    );
    expect(payload.suggestions[0]).not.toHaveProperty('admin_notes');
  });

  it('returns a created suggestion without internal notes', async () => {
    const suggestionRow = {
      id: 'suggestion-2',
      created_by: 'user-1',
      title: 'New suggestion',
      body: 'A useful improvement',
      page_hint: 'Dashboard',
      status: 'new',
      admin_notes: 'Internal default',
      created_at: '2026-07-21T20:00:00Z',
      updated_at: '2026-07-21T20:00:00Z',
    };
    const single = vi.fn().mockResolvedValue({ data: suggestionRow, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({ insert })),
    } as unknown as SupabaseClient);

    const response = await POST(
      new NextRequest('http://localhost/api/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: ' New suggestion ',
          body: ' A useful improvement ',
          page_hint: ' Dashboard ',
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      created_by: 'user-1',
      title: 'New suggestion',
      body: 'A useful improvement',
      page_hint: 'Dashboard',
      status: 'new',
    });
    expect(select).toHaveBeenCalledWith(
      'id, created_by, title, body, page_hint, status, created_at, updated_at'
    );
    expect(payload.suggestion).not.toHaveProperty('admin_notes');
  });
});
