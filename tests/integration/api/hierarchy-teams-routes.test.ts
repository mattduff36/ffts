import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCanAccess,
  mockRequireAdminUsersModuleAccess,
  mockEnsureTeamPermissionRows,
  mockGetTeamManagerOptions,
  mockGetEffectiveRole,
  mockInsertSingleResult,
  mockTeamInsert,
  mockOrgTeamFetchSingleResult,
  mockProfilesCountResult,
  mockReconcileTeamManagerAssignments,
  mockTeamSingleResult,
  mockTeamUpdate,
  mockValidateTeamManagerSelection,
} = vi.hoisted(() => ({
  mockCanAccess: vi.fn(),
  mockRequireAdminUsersModuleAccess: vi.fn(),
  mockEnsureTeamPermissionRows: vi.fn(),
  mockGetTeamManagerOptions: vi.fn(),
  mockGetEffectiveRole: vi.fn(),
  mockInsertSingleResult: vi.fn(),
  mockTeamInsert: vi.fn(),
  mockOrgTeamFetchSingleResult: vi.fn(),
  mockProfilesCountResult: vi.fn(),
  mockReconcileTeamManagerAssignments: vi.fn(),
  mockTeamSingleResult: vi.fn(),
  mockTeamUpdate: vi.fn(),
  mockValidateTeamManagerSelection: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => mockProfilesCountResult()),
          })),
        };
      }
      if (table === 'org_teams') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: mockOrgTeamFetchSingleResult,
            })),
          })),
          insert: vi.fn((payload: unknown) => {
            mockTeamInsert(payload);
            return {
              select: vi.fn(() => ({
                single: mockInsertSingleResult,
              })),
            };
          }),
          update: vi.fn((payload: unknown) => {
            mockTeamUpdate(payload);
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: mockTeamSingleResult,
                })),
              })),
            };
          }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(),
        })),
      };
    }),
  })),
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
}));

vi.mock('@/lib/server/admin-users-module-access', () => ({
  requireAdminUsersModuleAccess: mockRequireAdminUsersModuleAccess,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockGetEffectiveRole,
}));

vi.mock('@/lib/server/team-managers', () => ({
  formatManagerOptionLabel: vi.fn((option: { full_name: string }) => option.full_name),
  getTeamManagerOptions: mockGetTeamManagerOptions,
  isMissingTeamManagerSchemaError: vi.fn(() => false),
  reconcileTeamManagerAssignments: mockReconcileTeamManagerAssignments,
  validateTeamManagerSelection: mockValidateTeamManagerSelection,
}));

vi.mock('@/lib/server/team-permissions', () => ({
  ensureTeamPermissionRows: mockEnsureTeamPermissionRows,
}));

describe('Hierarchy teams routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockResolvedValue(true);
    mockRequireAdminUsersModuleAccess.mockResolvedValue(null);
    mockEnsureTeamPermissionRows.mockResolvedValue(undefined);
    mockGetTeamManagerOptions.mockResolvedValue([]);
    mockInsertSingleResult.mockResolvedValue({ data: null, error: null });
    mockTeamInsert.mockReset();
    mockOrgTeamFetchSingleResult.mockResolvedValue({
      data: {
        id: 'civils',
        manager_1_profile_id: 'manager-1',
        manager_2_profile_id: 'manager-2',
      },
      error: null,
    });
    mockReconcileTeamManagerAssignments.mockResolvedValue(undefined);
    mockGetEffectiveRole.mockResolvedValue({
      user_id: 'admin-1',
      role_class: 'admin',
      role_name: 'admin',
      name: 'admin',
      is_super_admin: true,
    });
    mockValidateTeamManagerSelection.mockResolvedValue({
      ok: true,
      candidates: new Map(),
    });
  });

  it('rejects patch requests with no supported fields', async () => {
    const { PATCH } = await import('@/app/api/admin/hierarchy/teams/[id]/route');

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams/civils', {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'civils' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('No team fields provided');
    expect(mockTeamSingleResult).not.toHaveBeenCalled();
  });

  it('allows team metadata update for admin user', async () => {
    const { PATCH } = await import('@/app/api/admin/hierarchy/teams/[id]/route');
    mockTeamSingleResult.mockResolvedValue({
      data: { id: 'civils', name: 'Civils Team', code: 'CVL', timesheet_type: 'plant', active: true },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams/civils', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Civils Team', code: 'CVL', timesheet_type: 'plant' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'civils' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.team.name).toBe('Civils Team');
    expect(mockTeamUpdate).toHaveBeenCalledWith({
      name: 'Civils Team',
      code: 'CVL',
      timesheet_type: 'plant',
    });
  });

  it('treats null manager ids as explicit clears', async () => {
    const { PATCH } = await import('@/app/api/admin/hierarchy/teams/[id]/route');
    mockTeamSingleResult.mockResolvedValue({
      data: {
        id: 'civils',
        name: 'Civils Team',
        code: 'CVL',
        active: true,
        manager_1_profile_id: null,
        manager_2_profile_id: null,
      },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams/civils', {
      method: 'PATCH',
      body: JSON.stringify({ manager_1_id: null, manager_2_id: null }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'civils' }) });

    expect(response.status).toBe(200);
    expect(mockValidateTeamManagerSelection).toHaveBeenCalledWith(expect.anything(), {
      manager_1_id: null,
      manager_2_id: null,
    });
    expect(mockTeamUpdate).toHaveBeenCalledWith({
      manager_1_profile_id: null,
      manager_2_profile_id: null,
    });
    expect(mockReconcileTeamManagerAssignments).toHaveBeenCalledWith(expect.anything(), 'civils');
  });

  it('validates merged manager slots before persisting a partial update', async () => {
    const { PATCH } = await import('@/app/api/admin/hierarchy/teams/[id]/route');
    mockValidateTeamManagerSelection.mockResolvedValue({
      ok: false,
      error: 'Manager 1 and Manager 2 must be different users.',
      candidates: new Map(),
    });

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams/civils', {
      method: 'PATCH',
      body: JSON.stringify({ manager_1_id: 'manager-2' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'civils' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('different users');
    expect(mockValidateTeamManagerSelection).toHaveBeenCalledWith(expect.anything(), {
      manager_1_id: 'manager-2',
      manager_2_id: 'manager-2',
    });
    expect(mockTeamUpdate).not.toHaveBeenCalled();
    expect(mockReconcileTeamManagerAssignments).not.toHaveBeenCalled();
  });

  it('does not mask insert constraint errors as missing schema', async () => {
    const { POST } = await import('@/app/api/admin/hierarchy/teams/route');
    mockInsertSingleResult.mockResolvedValue({
      data: null,
      error: {
        code: '23502',
        message: 'null value in column "team_id" of relation "org_teams" violates not-null constraint',
      },
    });

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'Plant' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain('null value in column');
  });

  it('persists team timesheet type on create', async () => {
    const { POST } = await import('@/app/api/admin/hierarchy/teams/route');
    mockInsertSingleResult.mockResolvedValue({
      data: { id: 'plant', name: 'Plant', code: 'PLT', timesheet_type: 'plant', active: true },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'Plant', code: 'PLT', timesheet_type: 'plant' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(mockTeamInsert).toHaveBeenCalledWith({
      id: 'plant',
      name: 'Plant',
      code: 'PLT',
      timesheet_type: 'plant',
      active: true,
      manager_1_profile_id: null,
      manager_2_profile_id: null,
    });
  });

  it('rejects invalid team timesheet types', async () => {
    const { PATCH } = await import('@/app/api/admin/hierarchy/teams/[id]/route');

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams/civils', {
      method: 'PATCH',
      body: JSON.stringify({ timesheet_type: 'invalid-type' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'civils' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Invalid timesheet type');
    expect(mockTeamUpdate).not.toHaveBeenCalled();
  });

  it('returns duplicate conflict instead of schema missing for org_teams update errors', async () => {
    const { PATCH } = await import('@/app/api/admin/hierarchy/teams/[id]/route');
    mockTeamSingleResult.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "org_teams_name_key"',
      },
    });

    const request = new NextRequest('http://localhost/api/admin/hierarchy/teams/civils', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Civils Team', code: 'CVL' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'civils' }) });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('already exists');
  });
});
