import { beforeEach, describe, expect, it, vi } from 'vitest';
const { getUserById, updateUserById, from, access } = vi.hoisted(() => ({
  getUserById: vi.fn(), updateUserById: vi.fn(), from: vi.fn(), access: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: { getUserById, updateUserById } }, from }) }));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: vi.fn(async () => ({ user_id: 'admin-1' })) }));
vi.mock('@/lib/server/admin-users-module-access', () => ({ requireAdminUsersModuleAccess: access }));
vi.mock('@/lib/utils/rbac', () => ({ canEffectiveRoleAssignRole: vi.fn(async () => true) }));
vi.mock('@/lib/utils/email', () => ({ sendProfileUpdateEmail: vi.fn() }));
vi.mock('@/lib/server/team-managers', () => ({ isMissingTeamManagerSchemaError: vi.fn(), reconcileProfileHierarchy: vi.fn() }));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: vi.fn() }));
import { PUT } from '@/app/api/admin/users/[id]/route';

describe('ordinary profile editor email guard', () => {
  beforeEach(() => {
    vi.clearAllMocks(); access.mockResolvedValue(null);
    getUserById.mockResolvedValue({ data: { user: { id: 'user-1', email: 'sample@example.test' } }, error: null });
  });
  it('rejects email changes before profile, permission or Auth mutations', async () => {
    const response = await PUT(new Request('http://localhost/api/admin/users/user-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'real@example.test', full_name: 'Updated Name', role_id: 'role-employee' }),
    }) as never, { params: Promise.resolve({ id: 'user-1' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'ACCOUNT_HANDOVER_REQUIRED' });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it('does not edit anything when the current email cannot be verified', async () => {
    getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'offline' } });
    const response = await PUT(new Request('http://localhost/api/admin/users/user-1', {
      method: 'PUT', body: JSON.stringify({ full_name: 'Updated Name', role_id: 'role-employee' }),
    }) as never, { params: Promise.resolve({ id: 'user-1' }) });
    expect(response.status).toBe(500);
    expect(from).not.toHaveBeenCalled();
  });
});
