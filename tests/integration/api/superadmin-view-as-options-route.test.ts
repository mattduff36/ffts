import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { GET } from '@/app/api/superadmin/view-as/options/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

describe('GET /api/superadmin/view-as/options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not grant Super Admin access from email identity alone', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'regular-admin',
        email: 'admin@mpdee.co.uk',
      },
    } as never);

    const single = vi.fn().mockResolvedValue({
      data: {
        super_admin: false,
        role: { is_super_admin: false },
      },
      error: null,
    });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select })),
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });
});
