import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockCanAccess, mockRunHierarchyValidation } = vi.hoisted(() => {
  return {
    mockCanAccess: vi.fn(),
    mockRunHierarchyValidation: vi.fn(),
  };
});

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
}));

vi.mock('@/lib/server/hierarchy-validation', () => ({
  runHierarchyValidation: mockRunHierarchyValidation,
  isBlockingHierarchyIssue: (code: string) =>
    ['MISSING_TEAM', 'MISSING_LINE_MANAGER', 'SELF_MANAGER', 'UNKNOWN_MANAGER', 'MANAGER_CYCLE'].includes(code),
}));

vi.mock('@/lib/server/admin-users-module-access', () => ({
  requireAdminUsersModuleAccess: vi.fn().mockResolvedValue(null),
}));

describe('Hierarchy admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockResolvedValue(true);
  });

  it('returns team-scoped validation payload', async () => {
    const { GET } = await import('@/app/api/admin/hierarchy/validation/route');
    mockRunHierarchyValidation.mockResolvedValue({
      configured: true,
      issues: [{ code: 'MISSING_LINE_MANAGER', profile_id: 'p1', full_name: 'User', team_id: 'transport', details: 'Missing manager' }],
      team_issue_counts: { transport: 1 },
      blocking_issue_count: 1,
      summary: { total_profiles: 10, issue_count: 1 },
    });

    const request = new NextRequest('http://localhost/api/admin/hierarchy/validation?team_id=transport');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary.issue_count).toBe(1);
    expect(mockRunHierarchyValidation).toHaveBeenCalledWith(expect.any(Object), { teamId: 'transport' });
  });
});
