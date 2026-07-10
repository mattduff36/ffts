import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { POST } from '@/app/api/me/usage-events/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { logServerError } from '@/lib/utils/server-error-logger';

interface UsageSessionMockRow {
  id: string;
  event_count: number | null;
  page_view_count: number | null;
  heartbeat_count: number | null;
}

function createAdminClientMock(
  options: {
    upsertError?: { message: string } | null;
    insertSessionError?: { code?: string; message: string } | null;
    existingSession?: UsageSessionMockRow | null;
    sessionAfterDuplicate?: UsageSessionMockRow | null;
  } = {}
) {
  const maybeSingle = vi.fn();
  maybeSingle.mockResolvedValueOnce({ data: options.existingSession || null, error: null });
  if (options.sessionAfterDuplicate !== undefined) {
    maybeSingle.mockResolvedValueOnce({ data: options.sessionAfterDuplicate, error: null });
  }
  maybeSingle.mockResolvedValue({ data: options.sessionAfterDuplicate || options.existingSession || null, error: null });
  const selectExistingSession = vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle })),
  }));
  const singleCreatedSession = vi.fn().mockResolvedValue({
    data: options.insertSessionError ? null : { id: 'usage-session-1' },
    error: options.insertSessionError || null,
  });
  const insertSession = vi.fn(() => ({
    select: vi.fn(() => ({ single: singleCreatedSession })),
  }));
  const updateSession = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));
  const upsertEvents = vi.fn().mockResolvedValue({ error: options.upsertError || null });

  return {
    maybeSingle,
    insertSession,
    updateSession,
    upsertEvents,
    client: {
      from: vi.fn((table: string) => {
        if (table === 'user_usage_sessions') {
          return {
            select: selectExistingSession,
            insert: insertSession,
            update: updateSession,
          };
        }
        if (table === 'user_usage_events') {
          return {
            upsert: upsertEvents,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    },
  };
}

describe('POST /api/me/usage-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const response = await POST(new NextRequest('http://localhost/api/me/usage-events', { method: 'POST' }));

    expect(response.status).toBe(401);
  });

  it('normalizes and inserts authenticated usage events', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminMock = createAdminClientMock();

    vi.mocked(createAdminClient).mockReturnValue(adminMock.client as never);
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'user-1' },
      validation: {
        session: { id: 'app-session-1' },
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/me/usage-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
          'user-agent': 'Mozilla/5.0 Chrome/120.0',
        },
        body: JSON.stringify({
          clientSessionId: 'client-session-1',
          device: {
            userAgent: 'Mozilla/5.0 Chrome/120.0',
            deviceType: 'desktop',
          },
          events: [
            {
              eventName: 'page_view',
              clientEventId: 'event-1',
              clientSessionId: 'client-session-1',
              occurredAt: '2026-05-28T08:00:00.000Z',
              path: '/timesheets/new?tab=current',
              metadata: {
                safe: 'value',
                password: 'should-not-store',
              },
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.inserted).toBe(1);
    expect(adminMock.insertSession).toHaveBeenCalled();
    expect(adminMock.upsertEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: 'user-1',
          app_session_id: 'app-session-1',
          event_name: 'page_view',
          event_category: 'navigation',
          module: 'timesheets',
          normalized_path: '/timesheets/new?tab=current',
          metadata: expect.objectContaining({
            safe: 'value',
            password: '[redacted]',
          }),
        }),
      ],
      {
        onConflict: 'client_event_id',
        ignoreDuplicates: true,
      }
    );
  });

  it('treats transient upstream telemetry failures as accepted without logging a production error', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminMock = createAdminClientMock({
      upsertError: {
        message: `<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>cloudflare</center>
</body>
</html>`,
      },
    });

    vi.mocked(createAdminClient).mockReturnValue(adminMock.client as never);
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'user-1' },
      validation: {
        session: { id: 'app-session-1' },
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/me/usage-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          clientSessionId: 'client-session-1',
          events: [
            {
              eventName: 'page_view',
              clientEventId: 'event-1',
              clientSessionId: 'client-session-1',
              occurredAt: '2026-05-28T08:00:00.000Z',
              path: '/quotes',
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      success: false,
      inserted: 0,
      transient: true,
      error: 'Usage analytics temporarily unavailable',
    });
    expect(logServerError).not.toHaveBeenCalled();
  });

  it('updates an existing usage session when a concurrent insert wins the client session race', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminMock = createAdminClientMock({
      insertSessionError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "user_usage_sessions_client_session_id_key"',
      },
      sessionAfterDuplicate: {
        id: 'usage-session-raced',
        event_count: 2,
        page_view_count: 1,
        heartbeat_count: 0,
      },
    });

    vi.mocked(createAdminClient).mockReturnValue(adminMock.client as never);
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'user-1' },
      validation: {
        session: { id: 'app-session-1' },
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/me/usage-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          clientSessionId: 'client-session-1',
          events: [
            {
              eventName: 'page_view',
              clientEventId: 'event-1',
              clientSessionId: 'client-session-1',
              occurredAt: '2026-05-28T08:00:00.000Z',
              path: '/quotes',
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.inserted).toBe(1);
    expect(adminMock.maybeSingle).toHaveBeenCalledTimes(2);
    expect(adminMock.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        event_count: 3,
        page_view_count: 2,
        heartbeat_count: 0,
      })
    );
    expect(adminMock.upsertEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          session_id: 'usage-session-raced',
          client_session_id: 'client-session-1',
        }),
      ],
      {
        onConflict: 'client_event_id',
        ignoreDuplicates: true,
      }
    );
    expect(logServerError).not.toHaveBeenCalled();
  });
});
