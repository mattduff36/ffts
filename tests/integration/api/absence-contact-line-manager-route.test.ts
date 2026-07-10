import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '@/app/api/absence/[id]/contact-line-manager/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

describe('POST /api/absence/[id]/contact-line-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when the employee is not authenticated', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const response = await POST(
      new NextRequest('http://localhost/api/absence/absence-1/contact-line-manager', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'absence-1' }) }
    );

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('creates a notification for the line manager for any leave type', async () => {
    const messageInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'message-1' },
          error: null,
        }),
      }),
    });
    const recipientInsert = vi.fn().mockResolvedValue({ error: null });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'absences') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'absence-1',
                    profile_id: 'employee-1',
                    date: '2026-05-12',
                    end_date: '2026-05-14',
                    status: 'approved',
                    absence_reasons: { name: 'Sick Leave' },
                    profile: {
                      id: 'employee-1',
                      full_name: 'Jane Employee',
                      team_id: 'team-1',
                      line_manager_id: 'manager-1',
                      secondary_manager_id: null,
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'messages') {
          return {
            insert: messageInsert,
          };
        }

        if (table === 'message_recipients') {
          return {
            insert: recipientInsert,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'employee-1',
        full_name: 'Jane Employee',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue(adminClient as never);

    const response = await POST(
      new NextRequest('http://localhost/api/absence/absence-1/contact-line-manager', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'absence-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(messageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NOTIFICATION',
        subject: 'Leave cancellation request from Jane Employee',
        priority: 'LOW',
        sender_id: 'employee-1',
        created_via: 'absence_contact_line_manager',
        module_key: 'absence',
      })
    );
    expect(recipientInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'message-1',
        user_id: 'manager-1',
        status: 'PENDING',
      })
    );
    expect(messageInsert.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('Type: Sick Leave'),
      })
    );
  });
});
