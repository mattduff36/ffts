import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin');

async function getActiveUsersRoute() {
  const { GET } = await import('@/app/api/superadmin/active-users/route');
  return GET;
}

interface MockVisitRow {
  user_id: string;
  path: string;
  visited_at: string;
  profile: {
    full_name: string;
    role: { display_name: string }[];
    team: { name: string }[];
  };
}

interface MockAuthUser {
  id: string;
  email?: string;
}

function createAdminClientMock(visits: MockVisitRow[], isSuperAdmin = true, authUsers: MockAuthUser[] = []) {
  return {
    auth: {
      admin: {
        async listUsers({ page = 1, perPage = 1000 }: { page?: number; perPage?: number }) {
          const start = (page - 1) * perPage;
          const end = start + perPage;
          return {
            data: {
              users: authUsers.slice(start, end),
            },
            error: null,
          };
        },
      },
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return {
                      data: {
                        super_admin: isSuperAdmin,
                        role: { is_super_admin: isSuperAdmin },
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'user_page_visits') {
        return {
          select() {
            return {
              order() {
                return {
                  async limit() {
                    return { data: visits, error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe('GET /api/superadmin/active-users', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T12:00:00.000Z'));

    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'super-1', email: 'admin@mpdee.co.uk' } },
          error: null,
        }),
      },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns active-now users and latest five unique users', async () => {
    const visits: MockVisitRow[] = [
      {
        user_id: 'u1',
        path: '/dashboard',
        visited_at: '2026-03-30T11:59:30.000Z',
        profile: { full_name: 'User One', role: [{ display_name: 'Admin' }], team: [{ name: 'HQ' }] },
      },
      {
        user_id: 'u2',
        path: '/timesheets',
        visited_at: '2026-03-30T11:56:00.000Z',
        profile: { full_name: 'User Two', role: [{ display_name: 'Manager' }], team: [{ name: 'Civils' }] },
      },
      {
        user_id: 'u1',
        path: '/profile',
        visited_at: '2026-03-30T11:52:00.000Z',
        profile: { full_name: 'User One', role: [{ display_name: 'Admin' }], team: [{ name: 'HQ' }] },
      },
      {
        user_id: 'u3',
        path: '/absence',
        visited_at: '2026-03-30T11:54:00.000Z',
        profile: { full_name: 'User Three', role: [{ display_name: 'Employee' }], team: [{ name: 'Ops' }] },
      },
      {
        user_id: 'u4',
        path: '/workshop-tasks',
        visited_at: '2026-03-30T11:40:00.000Z',
        profile: { full_name: 'User Four', role: [{ display_name: 'Employee' }], team: [{ name: 'Ops' }] },
      },
      {
        user_id: 'u5',
        path: '/fleet',
        visited_at: '2026-03-30T11:39:00.000Z',
        profile: { full_name: 'User Five', role: [{ display_name: 'Employee' }], team: [{ name: 'Plant' }] },
      },
      {
        user_id: 'u6',
        path: '/help',
        visited_at: '2026-03-30T11:38:00.000Z',
        profile: { full_name: 'User Six', role: [{ display_name: 'Employee' }], team: [{ name: 'Plant' }] },
      },
    ];

    const { createAdminClient } = await import('@/lib/supabase/admin');
    vi.mocked(createAdminClient).mockReturnValue(
      createAdminClientMock(visits, true, [
        { id: 'super-1', email: 'admin@mpdee.co.uk' },
        { id: 'u1', email: 'u1@example.com' },
        { id: 'u2', email: 'u2@example.com' },
      ]) as never
    );

    const GET = await getActiveUsersRoute();
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.activeWindowMinutes).toBe(5);
    expect(payload.activeNowUsers.map((user: { userId: string }) => user.userId)).toEqual(['u1', 'u2']);
    expect(payload.recentUsers.map((user: { userId: string }) => user.userId)).toEqual([
      'u1',
      'u2',
      'u3',
      'u4',
      'u5',
    ]);
  });

  it('excludes admin@mpdee.co.uk from active and recent lists for any superadmin viewer', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'super-2', email: 'other-superadmin@example.com' } },
          error: null,
        }),
      },
    } as never);

    const visits: MockVisitRow[] = [
      {
        user_id: 'excluded-user-id',
        path: '/dashboard',
        visited_at: '2026-03-30T11:59:50.000Z',
        profile: { full_name: 'Admin Account', role: [{ display_name: 'Super Admin' }], team: [{ name: 'HQ' }] },
      },
      {
        user_id: 'u2',
        path: '/timesheets',
        visited_at: '2026-03-30T11:58:00.000Z',
        profile: { full_name: 'User Two', role: [{ display_name: 'Manager' }], team: [{ name: 'Civils' }] },
      },
      {
        user_id: 'u3',
        path: '/projects',
        visited_at: '2026-03-30T11:40:00.000Z',
        profile: { full_name: 'User Three', role: [{ display_name: 'Employee' }], team: [{ name: 'Ops' }] },
      },
    ];

    const { createAdminClient } = await import('@/lib/supabase/admin');
    vi.mocked(createAdminClient).mockReturnValue(
      createAdminClientMock(visits, true, [
        { id: 'super-2', email: 'other-superadmin@example.com' },
        { id: 'excluded-user-id', email: 'admin@mpdee.co.uk' },
        { id: 'u2', email: 'u2@example.com' },
        { id: 'u3', email: 'u3@example.com' },
      ]) as never
    );

    const GET = await getActiveUsersRoute();
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.activeNowUsers.map((entry: { userId: string }) => entry.userId)).toEqual(['u2']);
    expect(payload.recentUsers.map((entry: { userId: string }) => entry.userId)).toEqual(['u2', 'u3']);
    expect(payload.activeNowUsers.find((entry: { userId: string }) => entry.userId === 'excluded-user-id')).toBeFalsy();
    expect(payload.recentUsers.find((entry: { userId: string }) => entry.userId === 'excluded-user-id')).toBeFalsy();
  });

  it('returns 403 for non-superadmin users', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-2', email: 'user@example.com' } },
          error: null,
        }),
      },
    } as never);

    const { createAdminClient } = await import('@/lib/supabase/admin');
    vi.mocked(createAdminClient).mockReturnValue(createAdminClientMock([], false) as never);

    const GET = await getActiveUsersRoute();
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });
});
