import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/suggestions/[id]/route';
import { POST } from '@/app/api/suggestions/[id]/reply/route';

const { mockCreateClient, mockLogServerError, mockCanAccess } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockLogServerError: vi.fn(),
  mockCanAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
}));

describe('GET /api/suggestions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogServerError.mockResolvedValue(undefined);
    mockCanAccess.mockResolvedValue(false);
  });

  it('returns the current user suggestion thread with profile names', async () => {
    const suggestionRow = {
      id: 'suggestion-1',
      created_by: 'user-1',
      title: 'Too small writing',
      body: 'Please make text larger',
      page_hint: '/dashboard',
      status: 'under_review',
      admin_notes: null,
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
    };
    const updateRows = [
      {
        id: 'update-1',
        suggestion_id: 'suggestion-1',
        created_by: 'manager-1',
        old_status: 'new',
        new_status: 'under_review',
        note: 'Can you be more specific?',
        created_at: '2026-04-16T10:05:00Z',
      },
      {
        id: 'update-2',
        suggestion_id: 'suggestion-1',
        created_by: 'user-1',
        old_status: 'under_review',
        new_status: 'under_review',
        note: 'The dashboard header is hard to read on mobile.',
        created_at: '2026-04-16T10:10:00Z',
      },
    ];
    const profileRows = [
      { id: 'user-1', full_name: 'Richard User' },
      { id: 'manager-1', full_name: 'Example Admin' },
    ];

    const suggestionsSingle = vi.fn().mockResolvedValue({ data: suggestionRow, error: null });
    const suggestionsEqId = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEqId }));

    const updatesOrder = vi.fn().mockResolvedValue({ data: updateRows, error: null });
    const updatesEq = vi.fn(() => ({ order: updatesOrder }));
    const updatesSelect = vi.fn(() => ({ eq: updatesEq }));

    const profilesIn = vi.fn().mockResolvedValue({ data: profileRows, error: null });
    const profilesSelect = vi.fn(() => ({ in: profilesIn }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') return { select: suggestionsSelect };
        if (table === 'suggestion_updates') return { select: updatesSelect };
        if (table === 'profiles') return { select: profilesSelect };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/suggestions/suggestion-1'),
      { params: Promise.resolve({ id: 'suggestion-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.suggestion.title).toBe('Too small writing');
    expect(payload.suggestion.user).toEqual({ full_name: 'Richard User' });
    expect(payload.updates).toHaveLength(2);
    expect(payload.updates[0].user).toEqual({ full_name: 'Example Admin' });
    expect(payload.updates[1].user).toEqual({ full_name: 'Richard User' });
  });

  it('allows suggestions managers to view another user suggestion thread', async () => {
    const suggestionRow = {
      id: 'suggestion-2',
      created_by: 'user-2',
      title: 'Van not in use button',
      body: 'Could we add a van not in use button?',
      page_hint: '/van-inspections',
      status: 'under_review',
      admin_notes: null,
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
    };

    const suggestionsSingle = vi.fn().mockResolvedValue({ data: suggestionRow, error: null });
    const suggestionsEqId = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEqId }));

    const updatesOrder = vi.fn().mockResolvedValue({ data: [], error: null });
    const updatesEq = vi.fn(() => ({ order: updatesOrder }));
    const updatesSelect = vi.fn(() => ({ eq: updatesEq }));

    const profilesIn = vi.fn().mockResolvedValue({ data: [{ id: 'user-2', full_name: 'David User' }], error: null });
    const profilesSelect = vi.fn(() => ({ in: profilesIn }));

    mockCanAccess.mockResolvedValue(true);
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') return { select: suggestionsSelect };
        if (table === 'suggestion_updates') return { select: updatesSelect };
        if (table === 'profiles') return { select: profilesSelect };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/suggestions/suggestion-2'),
      { params: Promise.resolve({ id: 'suggestion-2' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.suggestion.user).toEqual({ full_name: 'David User' });
    expect(mockCanAccess).toHaveBeenCalledWith('suggestions');
  });
});

describe('POST /api/suggestions/[id]/reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('adds a reply for the current user suggestion', async () => {
    const suggestionRow = {
      id: 'suggestion-1',
      created_by: 'user-1',
      status: 'under_review',
    };
    const insertedUpdate = {
      id: 'update-3',
      suggestion_id: 'suggestion-1',
      created_by: 'user-1',
      old_status: 'under_review',
      new_status: 'under_review',
      note: 'It is mainly the dashboard header text.',
      created_at: '2026-04-16T10:15:00Z',
    };

    const suggestionsSingle = vi.fn().mockResolvedValue({ data: suggestionRow, error: null });
    const suggestionsEqCreatedBy = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsEqId = vi.fn(() => ({ eq: suggestionsEqCreatedBy }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEqId }));

    const suggestionsTouchEqCreatedBy = vi.fn().mockResolvedValue({ error: null });
    const suggestionsTouchEqId = vi.fn(() => ({ eq: suggestionsTouchEqCreatedBy }));
    const suggestionsUpdate = vi.fn(() => ({ eq: suggestionsTouchEqId }));

    const updatesInsertSingle = vi.fn().mockResolvedValue({ data: insertedUpdate, error: null });
    const updatesInsertSelect = vi.fn(() => ({ single: updatesInsertSingle }));
    const updatesInsert = vi.fn(() => ({ select: updatesInsertSelect }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') return { select: suggestionsSelect, update: suggestionsUpdate };
        if (table === 'suggestion_updates') return { insert: updatesInsert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await POST(
      new NextRequest('http://localhost/api/suggestions/suggestion-1/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: 'It is mainly the dashboard header text.' }),
      }),
      { params: Promise.resolve({ id: 'suggestion-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(suggestionsUpdate).toHaveBeenCalledWith(expect.objectContaining({ updated_at: expect.any(String) }));
    expect(updatesInsert).toHaveBeenCalledWith({
      suggestion_id: 'suggestion-1',
      created_by: 'user-1',
      old_status: 'under_review',
      new_status: 'under_review',
      note: 'It is mainly the dashboard header text.',
    });
  });
});
