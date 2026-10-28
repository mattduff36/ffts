import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/debug-console-access', () => ({
  requireDebugConsoleAccess: vi.fn(),
  createDebugAccessErrorBody: (access: {
    error: string | null;
    code?: string;
    sensitive_access?: unknown;
  }) => ({
    error: access.error,
    code: access.code,
    sensitive_access: access.sensitive_access,
  }),
}));

import { POST } from '@/app/api/me/site-usage/route';
import { GET } from '@/app/api/debug/site-usage/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireDebugConsoleAccess } from '@/lib/server/debug-console-access';

const AUTH_USER = '11111111-1111-4111-8111-111111111111';
const RECORDING_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

function postRequest(body: unknown, origin = 'http://localhost') {
  return new NextRequest('http://localhost/api/me/site-usage', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function mockUpsert(result: { data: Array<{ event_id: string }> | null; error: { message: string } | null }) {
  const select = vi.fn().mockResolvedValue(result);
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { upsert };
}

describe('POST /api/me/site-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: AUTH_USER },
    } as never);
  });

  it('rejects unauthenticated, cross-origin, and invalid payloads', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);
    const unauthenticated = await POST(postRequest({ recording_id: RECORDING_ID, events: [] }));
    expect(unauthenticated.status).toBe(401);

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: AUTH_USER },
    } as never);
    const crossOrigin = await POST(postRequest({
      recording_id: RECORDING_ID,
      events: [{
        event_id: EVENT_ID,
        event_type: 'navigation',
        occurred_at: new Date().toISOString(),
        route: '/dashboard',
        details: {},
      }],
    }, 'https://evil.example'));
    expect(crossOrigin.status).toBe(403);

    const invalid = await POST(postRequest({ recording_id: 'bad', events: [] }));
    const owned = await POST(postRequest({
      user_id: '22222222-2222-4222-8222-222222222222',
      recording_id: RECORDING_ID,
      events: [{
        event_id: EVENT_ID,
        event_type: 'navigation',
        occurred_at: new Date().toISOString(),
        route: '/dashboard',
        details: {},
      }],
    }));
    const oversized = await POST(postRequest(`{"pad":"${'x'.repeat(25_000)}"}`));

    expect(invalid.status).toBe(400);
    expect(owned.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('stores scrubbed events for the authenticated profile and dedupes by event id', async () => {
    const { upsert } = mockUpsert({ data: [], error: null });
    const response = await POST(postRequest({
      recording_id: RECORDING_ID,
      events: [{
        event_id: EVENT_ID,
        event_type: 'navigation',
        occurred_at: new Date().toISOString(),
        route: '/fleet/123?token=SECRET#frag',
        details: {},
      }],
    }));
    const payload = await response.json();
    const rows = upsert.mock.calls[0]?.[0] as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, accepted: 1, inserted: 0, deduped: 1 });
    expect(upsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: 'user_id,event_id',
      ignoreDuplicates: true,
    });
    expect(rows[0]).toMatchObject({ user_id: AUTH_USER, route: '/fleet/:id' });
    expect(JSON.stringify(rows)).not.toContain('SECRET');
  });

  it('does not echo database errors', async () => {
    mockUpsert({ data: null, error: { message: 'secret db message' } });
    const response = await POST(postRequest({
      recording_id: RECORDING_ID,
      events: [{
        event_id: EVENT_ID,
        event_type: 'click',
        occurred_at: new Date().toISOString(),
        route: '/dashboard',
        details: { tag: 'button', test_id: 'save-button' },
      }],
    }));
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.error).toBe('Failed to store site usage');
    expect(JSON.stringify(payload)).not.toContain('secret db message');
  });
});

describe('GET /api/debug/site-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireDebugConsoleAccess).mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      profileId: AUTH_USER,
    });
  });

  function mockRead() {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      lt: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async (count: number) => ({
        data: Array.from({ length: count }, (_, index) => ({
          user_id: AUTH_USER,
          recording_id: RECORDING_ID,
          event_type: 'navigation',
          occurred_at: new Date(Date.UTC(2026, 9, 28, 10, 0, index)).toISOString(),
        })),
        error: null,
      })),
      range: vi.fn(async (from: number, to: number) => ({
        data: Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => ({
          user_id: AUTH_USER,
          recording_id: RECORDING_ID,
          event_id: `55555555-5555-4555-8555-${String(from + index).padStart(12, '0')}`,
          event_type: 'click',
          occurred_at: new Date(Date.UTC(2026, 9, 28, 11, 0, from + index)).toISOString(),
          route: '/dashboard',
          duration_ms: null,
          details: { tag: 'button' },
        })),
        error: null,
      })),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => query) } as never);
    return query;
  }

  it('requires debug access and a valid recording id', async () => {
    vi.mocked(requireDebugConsoleAccess).mockResolvedValue({
      ok: false,
      status: 428,
      error: 'Sensitive access PIN required for protected modules.',
      code: 'SENSITIVE_PIN_REQUIRED',
    });
    const denied = await GET(new NextRequest('http://localhost/api/debug/site-usage'));
    expect(denied.status).toBe(428);
    expect(createAdminClient).not.toHaveBeenCalled();

    vi.mocked(requireDebugConsoleAccess).mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
    });
    const invalid = await GET(new NextRequest('http://localhost/api/debug/site-usage?recording_id=not-a-uuid'));
    expect(invalid.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns bounded summaries and paged events with truncation flags', async () => {
    const summaries = mockRead();
    const summaryResponse = await GET(new NextRequest('http://localhost/api/debug/site-usage'));
    const summaryPayload = await summaryResponse.json();
    const requested = summaries.limit.mock.calls[0]?.[0] as number;
    expect(summaryResponse.status).toBe(200);
    expect(summaryPayload).toMatchObject({
      mode: 'summaries',
      scanned: requested - 1,
      has_more: true,
      truncated: true,
    });
    expect(summaryPayload.recordings[0].event_count).toBe(requested - 1);
    expect(summaryPayload.next_cursor).toEqual(expect.any(String));

    const events = mockRead();
    const eventResponse = await GET(new NextRequest(
      `http://localhost/api/debug/site-usage?recording_id=${RECORDING_ID}&limit=10`,
    ));
    const eventPayload = await eventResponse.json();
    expect(eventPayload).toMatchObject({
      mode: 'events',
      recording_id: RECORDING_ID,
      limit: 10,
      offset: 0,
      has_more: true,
      truncated: true,
      next_offset: 10,
    });
    expect(eventPayload.events).toHaveLength(10);
    expect(events.eq).toHaveBeenCalledWith('recording_id', RECORDING_ID);
  });

  it('hides database error text', async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      lt: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({ data: null, error: { message: 'secret db message' } })),
      range: vi.fn(),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => query) } as never);
    const response = await GET(new NextRequest('http://localhost/api/debug/site-usage'));
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(JSON.stringify(payload)).not.toContain('secret db message');
  });
});
