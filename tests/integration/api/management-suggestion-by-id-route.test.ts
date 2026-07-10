import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET, PATCH } from '@/app/api/management/suggestions/[id]/route';

const { mockCreateClient, mockCreateAdminClient, mockCanAccess, mockLogServerError } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCanAccess: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

describe('GET /api/management/suggestions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockResolvedValue(true);
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('returns suggestion and update history with resolved profile names', async () => {
    const suggestionRow = {
      id: 'suggestion-1',
      created_by: 'user-1',
      title: 'Suggestion',
      body: 'Body',
      page_hint: '/dashboard',
      status: 'new',
      admin_notes: null,
      created_at: '2026-03-27T00:00:00Z',
      updated_at: '2026-03-27T00:00:00Z',
    };
    const updateRows = [
      {
        id: 'update-1',
        suggestion_id: 'suggestion-1',
        created_by: 'manager-1',
        old_status: 'new',
        new_status: 'under_review',
        note: 'Investigating',
        created_at: '2026-03-27T01:00:00Z',
      },
    ];
    const profileRows = [
      { id: 'user-1', full_name: 'User One' },
      { id: 'manager-1', full_name: 'Manager One' },
    ];

    const suggestionsSingle = vi.fn().mockResolvedValue({ data: suggestionRow, error: null });
    const suggestionsEq = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEq }));

    const updatesOrder = vi.fn().mockResolvedValue({ data: updateRows, error: null });
    const updatesEq = vi.fn(() => ({ order: updatesOrder }));
    const updatesSelect = vi.fn(() => ({ eq: updatesEq }));

    const profilesIn = vi.fn().mockResolvedValue({ data: profileRows, error: null });
    const profilesSelect = vi.fn(() => ({ in: profilesIn }));

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
      new NextRequest('http://localhost/api/management/suggestions/suggestion-1'),
      { params: Promise.resolve({ id: 'suggestion-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(profilesIn).toHaveBeenCalledWith('id', ['user-1', 'manager-1']);
    expect(payload.suggestion.user).toEqual({ full_name: 'User One' });
    expect(payload.updates[0].user).toEqual({ full_name: 'Manager One' });
  });

  it('returns 404 when suggestion is not found', async () => {
    const notFoundError = { code: 'PGRST116', message: 'No rows found' };
    const suggestionsSingle = vi.fn().mockResolvedValue({ data: null, error: notFoundError });
    const suggestionsEq = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEq }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') return { select: suggestionsSelect };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/suggestions/missing'),
      { params: Promise.resolve({ id: 'missing' }) }
    );

    expect(response.status).toBe(404);
  });

  it('sends notification to submitter and responder when suggestion is updated', async () => {
    const existingSuggestion = {
      id: 'suggestion-1',
      created_by: 'user-1',
      title: 'Improve dashboard filters',
      status: 'new',
    };
    const updatedSuggestion = {
      ...existingSuggestion,
      status: 'under_review',
      admin_notes: 'Starting this this week',
    };

    const suggestionsSingle = vi.fn().mockResolvedValue({ data: existingSuggestion, error: null });
    const suggestionsEqForSelect = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEqForSelect }));

    const suggestionsUpdateSingle = vi.fn().mockResolvedValue({ data: updatedSuggestion, error: null });
    const suggestionsUpdateSelect = vi.fn(() => ({ single: suggestionsUpdateSingle }));
    const suggestionsUpdateEq = vi.fn(() => ({ select: suggestionsUpdateSelect }));
    const suggestionsUpdate = vi.fn(() => ({ eq: suggestionsUpdateEq }));

    const suggestionUpdatesInsert = vi.fn().mockResolvedValue({ error: null });

    const messageInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null });
    const messageInsertSelect = vi.fn(() => ({ single: messageInsertSingle }));
    const messageInsert = vi.fn(() => ({ select: messageInsertSelect }));
    const messageRecipientsInsert = vi.fn().mockResolvedValue({ error: null });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') return { select: suggestionsSelect, update: suggestionsUpdate };
        if (table === 'suggestion_updates') return { insert: suggestionUpdatesInsert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') return { insert: messageInsert };
        if (table === 'message_recipients') return { insert: messageRecipientsInsert };
        throw new Error(`Unexpected admin table: ${table}`);
      }),
    });

    const response = await PATCH(
      new NextRequest('http://localhost/api/management/suggestions/suggestion-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'under_review',
          note: 'We are reviewing this now.',
        }),
      }),
      { params: Promise.resolve({ id: 'suggestion-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(suggestionUpdatesInsert).toHaveBeenCalledTimes(1);
    expect(messageInsert).toHaveBeenCalledTimes(1);
    expect(messageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        created_via: 'suggestion:suggestion-1',
        module_key: 'suggestions',
      })
    );
    expect(messageRecipientsInsert).toHaveBeenCalledWith([
      { message_id: 'msg-1', user_id: 'user-1', status: 'PENDING' },
      { message_id: 'msg-1', user_id: 'manager-1', status: 'PENDING' },
    ]);
  });
});
