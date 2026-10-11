import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockProfile, mockRole, mockCanAccess, mockAccessLevel, mockAdmin } = vi.hoisted(() => ({
  mockProfile: vi.fn(),
  mockRole: vi.fn(),
  mockCanAccess: vi.fn(),
  mockAccessLevel: vi.fn(),
  mockAdmin: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mockProfile,
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockRole,
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
  getEffectiveModuleAccessLevel: mockAccessLevel,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockAdmin,
}));

import {
  requireSchedulingAccess,
  requireSchedulingManagerAccess,
  requireSchedulingSelfAccess,
} from '@/lib/server/scheduling-auth';

function adminClient(options: {
  profile?: { data: { id: string; is_placeholder: boolean } | null; error: { message: string } | null };
  user?: { data: { user: Record<string, unknown> | null }; error: { message: string } | null };
  profileThrows?: boolean;
  userThrows?: boolean;
} = {}) {
  const getUserById = vi.fn(async () => {
    if (options.userThrows) throw new Error('auth lookup failed');
    return options.user ?? {
      data: {
        user: {
          id: 'employee-1',
          banned_until: null,
          deleted_at: null,
          user_metadata: {},
        },
      },
      error: null,
    };
  });

  return {
    getUserById,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (options.profileThrows) throw new Error('profile lookup failed');
            return options.profile ?? {
              data: { id: 'employee-1', is_placeholder: false },
              error: null,
            };
          },
        }),
      }),
    }),
    auth: {
      admin: {
        getUserById,
      },
    },
  };
}

describe('requireSchedulingSelfAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.mockResolvedValue({ profile: { id: 'employee-1' } });
    mockAdmin.mockImplementation(() => adminClient());
    mockRole.mockResolvedValue({
      user_id: 'view-as-user',
      role_name: 'Employee',
      role_class: 'employee',
      team_id: null,
      team_name: null,
    });
    mockCanAccess.mockResolvedValue(true);
    mockAccessLevel.mockResolvedValue(2);
  });

  it('denies an active employee when the scheduling matrix is closed', async () => {
    mockCanAccess.mockResolvedValue(false);

    const access = await requireSchedulingSelfAccess();

    expect(mockCanAccess).toHaveBeenCalledWith('scheduling');
    expect(access).toMatchObject({
      allowed: false,
      status: 403,
      error: 'Scheduling access required',
    });
    expect(access.userId).toBeUndefined();
  });

  it('allows an active employee with the scheduling matrix and uses only their authenticated id', async () => {
    const access = await requireSchedulingSelfAccess();

    expect(mockCanAccess).toHaveBeenCalledWith('scheduling');
    expect(access).toMatchObject({ allowed: true, status: 200, userId: 'employee-1' });
    expect(mockRole).not.toHaveBeenCalled();
    expect(mockAdmin.mock.results[0]?.value.getUserById).toHaveBeenCalledWith('employee-1');
  });

  it('ignores a view-as identity and returns the authenticated profile id', async () => {
    mockProfile.mockResolvedValue({ profile: { id: 'real-employee' } });
    mockAdmin.mockImplementation(() => adminClient({
      profile: { data: { id: 'real-employee', is_placeholder: false }, error: null },
      user: {
        data: { user: { id: 'real-employee', banned_until: null, deleted_at: null, user_metadata: {} } },
        error: null,
      },
    }));

    const access = await requireSchedulingSelfAccess();

    expect(mockCanAccess).toHaveBeenCalledWith('scheduling');
    expect(access.userId).toBe('real-employee');
    expect(access.userId).not.toBe('view-as-user');
    expect(mockRole).not.toHaveBeenCalled();
  });

  it('fails closed when the scheduling matrix check throws', async () => {
    mockCanAccess.mockRejectedValue(new Error('matrix unavailable'));

    const access = await requireSchedulingSelfAccess();

    expect(access).toMatchObject({
      allowed: false,
      status: 403,
      error: 'Scheduling self-service is unavailable',
    });
    expect(access.userId).toBeUndefined();
  });

  it('denies an unauthenticated session', async () => {
    mockProfile.mockResolvedValue(null);

    const access = await requireSchedulingSelfAccess();

    expect(access).toMatchObject({ allowed: false, status: 401, error: 'Unauthorized' });
    expect(mockAdmin).not.toHaveBeenCalled();
  });

  it('denies a banned auth user', async () => {
    mockAdmin.mockImplementation(() => adminClient({
      user: {
        data: { user: { id: 'employee-1', banned_until: '2099-12-31T00:00:00.000Z', user_metadata: {} } },
        error: null,
      },
    }));

    const access = await requireSchedulingSelfAccess();

    expect(access.allowed).toBe(false);
    expect(access.status).toBe(403);
  });

  it('denies a deleted auth user', async () => {
    mockAdmin.mockImplementation(() => adminClient({
      user: {
        data: {
          user: {
            id: 'employee-1',
            banned_until: null,
            user_metadata: { deleted_at: '2026-10-01T00:00:00.000Z', account_status: 'deleted' },
          },
        },
        error: null,
      },
    }));

    const access = await requireSchedulingSelfAccess();

    expect(access.allowed).toBe(false);
    expect(access.status).toBe(403);
  });

  it('denies a placeholder profile', async () => {
    mockAdmin.mockImplementation(() => adminClient({
      profile: { data: { id: 'employee-1', is_placeholder: true }, error: null },
    }));

    const access = await requireSchedulingSelfAccess();

    expect(access.allowed).toBe(false);
    expect(access.status).toBe(403);
  });

  it('fails closed when the profile lookup errors', async () => {
    mockAdmin.mockImplementation(() => adminClient({
      profile: { data: null, error: { message: 'database unavailable' } },
    }));

    const access = await requireSchedulingSelfAccess();

    expect(access.allowed).toBe(false);
    expect(access.status).toBe(403);
  });

  it('fails closed when the auth user lookup throws', async () => {
    mockAdmin.mockImplementation(() => adminClient({ userThrows: true }));

    const access = await requireSchedulingSelfAccess();

    expect(access.allowed).toBe(false);
    expect(access.status).toBe(403);
  });
});

describe('requireSchedulingManagerAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole.mockResolvedValue({
      user_id: 'manager-1',
      role_name: 'Manager',
      role_class: 'manager',
      team_id: 'team-1',
      team_name: 'Install',
    });
  });

  it('still requires the scheduling module guard', async () => {
    mockCanAccess.mockResolvedValue(false);

    const access = await requireSchedulingManagerAccess();

    expect(mockCanAccess).toHaveBeenCalledWith('scheduling');
    expect(access).toMatchObject({ allowed: false, status: 403, error: 'Scheduling access required' });
  });

  it('still rejects an employee who has the module but is not a manager', async () => {
    mockCanAccess.mockResolvedValue(true);
    mockAccessLevel.mockResolvedValue(2);

    const access = await requireSchedulingManagerAccess();

    expect(access).toMatchObject({ allowed: false, status: 403, error: 'Manager or admin access required' });
  });

  it('still allows a manager with the scheduling module', async () => {
    mockCanAccess.mockResolvedValue(true);
    mockAccessLevel.mockResolvedValue(4);

    const access = await requireSchedulingAccess();
    const managerAccess = await requireSchedulingManagerAccess();

    expect(access.isManagerOrAdmin).toBe(true);
    expect(managerAccess).toMatchObject({ allowed: true, status: 200, userId: 'manager-1' });
  });
});
