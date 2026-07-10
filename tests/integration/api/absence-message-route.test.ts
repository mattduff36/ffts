import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/server/absence-work-shift-auth');
vi.mock('@/lib/server/absence-module-settings');

import { GET, PUT } from '@/app/api/absence/message/route';

describe('absence message API route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the saved message for absence users', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { requireAbsenceUser } = await import('@/lib/server/absence-work-shift-auth');
    const { getAbsenceAnnouncement } = await import('@/lib/server/absence-module-settings');

    const adminClient = {} as never;
    vi.mocked(createAdminClient).mockReturnValue(adminClient);
    vi.mocked(requireAbsenceUser).mockResolvedValue({
      user: { id: 'user-1' } as never,
      response: null,
    });
    vi.mocked(getAbsenceAnnouncement).mockResolvedValue({
      message: 'Factory closed on Friday afternoon.',
      updatedAt: '2026-03-23T12:00:00.000Z',
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('Factory closed on Friday afternoon.');
    expect(getAbsenceAnnouncement).toHaveBeenCalledWith(adminClient);
  });

  it('rejects writes for non-admin absence users', async () => {
    const { requireAdminAbsenceAccess } = await import('@/lib/server/absence-work-shift-auth');

    vi.mocked(requireAdminAbsenceAccess).mockResolvedValue({
      user: null,
      response: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }),
    });

    const response = await PUT(
      new NextRequest('http://localhost/api/absence/message', {
        method: 'PUT',
        body: JSON.stringify({ message: 'Managers should not update this.' }),
      })
    );

    expect(response.status).toBe(403);
  });

  it('saves a valid message for admins', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { requireAdminAbsenceAccess } = await import('@/lib/server/absence-work-shift-auth');
    const { saveAbsenceAnnouncement } = await import('@/lib/server/absence-module-settings');

    const adminClient = {} as never;
    vi.mocked(createAdminClient).mockReturnValue(adminClient);
    vi.mocked(requireAdminAbsenceAccess).mockResolvedValue({
      user: { id: 'admin-1' } as never,
      response: null,
    });
    vi.mocked(saveAbsenceAnnouncement).mockResolvedValue({
      message: 'Site shutdown starts at 1pm on Thursday.',
      updatedAt: '2026-03-23T12:30:00.000Z',
    });

    const response = await PUT(
      new NextRequest('http://localhost/api/absence/message', {
        method: 'PUT',
        body: JSON.stringify({ message: 'Site shutdown starts at 1pm on Thursday.' }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(saveAbsenceAnnouncement).toHaveBeenCalledWith(
      adminClient,
      'Site shutdown starts at 1pm on Thursday.'
    );
  });

  it('returns 400 for invalid payloads', async () => {
    const { requireAdminAbsenceAccess } = await import('@/lib/server/absence-work-shift-auth');

    vi.mocked(requireAdminAbsenceAccess).mockResolvedValue({
      user: { id: 'admin-1' } as never,
      response: null,
    });

    const response = await PUT(
      new NextRequest('http://localhost/api/absence/message', {
        method: 'PUT',
        body: JSON.stringify({ message: 123 }),
      })
    );

    expect(response.status).toBe(400);
  });
});
