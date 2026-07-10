import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';
import { GET } from '@/app/api/users/directory/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/server/team-permissions');

describe('GET /api/users/directory', () => {
  function createDirectoryQuery(rows: Array<Record<string, unknown>>) {
    const range = vi.fn().mockResolvedValue({
      data: rows,
      error: null,
    });
    const order = vi.fn().mockReturnValue({ range });
    const query = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order,
      range,
    };

    return { query, order, range };
  }

  async function mockEffectiveRole(overrides: Partial<EffectiveRoleInfo> = {}) {
    const defaults: EffectiveRoleInfo = {
      role_id: 'role-admin',
      role_name: 'admin',
      display_name: 'Admin',
      role_class: 'admin',
      is_manager_admin: true,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'manager-1',
      team_id: null,
      team_name: null,
    };
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    vi.mocked(getEffectiveRole).mockResolvedValue({ ...defaults, ...overrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Unauthorized'),
        }),
      },
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/users/directory'));
    expect(response.status).toBe(401);
  });

  it('returns 403 when caller is not manager or higher', async () => {
    const { createClient } = await import('@/lib/supabase/server');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    await mockEffectiveRole({
      role_id: 'role-employee',
      role_name: 'employee',
      display_name: 'Employee',
      role_class: 'employee',
      is_manager_admin: false,
      user_id: 'user-1',
    });

    const response = await GET(new NextRequest('http://localhost/api/users/directory'));
    expect(response.status).toBe(403);
  });

  it('returns users with module access flags when a module is requested', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getUsersWithModuleAccess } = await import('@/lib/server/team-permissions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    await mockEffectiveRole();
    vi.mocked(getUsersWithModuleAccess).mockResolvedValue(new Set(['user-1']));

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'user-2', full_name: 'Blake Blocked', employee_id: 'E002' },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/users/directory?module=rams')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getUsersWithModuleAccess).toHaveBeenCalledWith('rams', undefined, expect.anything());
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1', has_module_access: true }),
      expect.objectContaining({ id: 'user-2', has_module_access: false }),
    ]);
    expect(query.not).toHaveBeenCalledWith('full_name', 'ilike', '%(Deleted User)%');
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 200,
      has_more: false,
    });
  });

  it('allows actions assignment directory requests to include every team', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { getUsersWithModuleAccess } = await import('@/lib/server/team-permissions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    await mockEffectiveRole({
      role_id: 'role-manager',
      role_name: 'manager',
      display_name: 'Manager',
      role_class: 'manager',
      is_manager_admin: true,
      team_id: 'team-workshop',
      team_name: 'Workshop',
    });
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getUsersWithModuleAccess).mockResolvedValue(new Set(['user-1', 'user-2']));

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001', team: { id: 'team-workshop', name: 'Workshop' } },
      { id: 'user-2', full_name: 'Blake Baker', employee_id: 'E002', team: { id: 'team-fleet', name: 'Fleet' } },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/users/directory?module=inspections&context=actions-assignment'),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(canEffectiveRoleAccessModule).toHaveBeenCalledWith('actions');
    expect(query.eq).not.toHaveBeenCalledWith('team_id', 'team-workshop');
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1', has_module_access: true }),
      expect.objectContaining({ id: 'user-2', has_module_access: true }),
    ]);
  });

  it('allows toolbox talks assignment directory requests to include every team', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    await mockEffectiveRole({
      role_id: 'role-manager',
      role_name: 'manager',
      display_name: 'Manager',
      role_class: 'manager',
      is_manager_admin: true,
      team_id: 'team-workshop',
      team_name: 'Workshop',
    });
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001', team: { id: 'team-workshop', name: 'Workshop' } },
      { id: 'user-2', full_name: 'Blake Baker', employee_id: 'E002', team: { id: 'team-fleet', name: 'Fleet' } },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/users/directory?context=toolbox-talks-assignment'),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(canEffectiveRoleAccessModule).toHaveBeenCalledWith('toolbox-talks');
    expect(query.eq).not.toHaveBeenCalledWith('team_id', 'team-workshop');
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ id: 'user-2' }),
    ]);
  });

  it('filters deleted users out by default', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    await mockEffectiveRole();

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'user-2', full_name: 'Pat Placeholder (Deleted User)', employee_id: 'E002' },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(new NextRequest('http://localhost/api/users/directory'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1', full_name: 'Alex Able' }),
    ]);
    expect(query.not).toHaveBeenCalledWith('full_name', 'ilike', '%(Deleted User)%');
  });

  it('applies pagination parameters to the directory query', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    await mockEffectiveRole();

    const { query, range } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/users/directory?limit=25&offset=50')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(50, 74);
    expect(payload.pagination).toEqual({
      offset: 50,
      limit: 25,
      has_more: false,
    });
  });

  it('can include deleted users when explicitly requested', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    await mockEffectiveRole();

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'user-2', full_name: 'Pat Placeholder (Deleted User)', employee_id: 'E002' },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/users/directory?includeDeleted=true')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1', full_name: 'Alex Able' }),
      expect.objectContaining({ id: 'user-2', full_name: 'Pat Placeholder (Deleted User)' }),
    ]);
    expect(query.not).not.toHaveBeenCalled();
  });
});
