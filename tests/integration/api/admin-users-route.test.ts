import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { POST } from '@/app/api/admin/users/route';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/utils/password', () => ({
  generateSecurePassword: vi.fn(() => 'TempPass123!'),
}));
vi.mock('@/lib/utils/email', () => ({
  sendPasswordEmail: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: vi.fn(),
  canEffectiveRoleAssignRole: vi.fn(),
}));
vi.mock('@/lib/server/admin-users-module-access', () => ({
  requireAdminUsersModuleAccess: vi.fn(),
}));
vi.mock('@/lib/server/team-managers', () => ({
  reconcileProfileHierarchy: vi.fn(),
  isMissingTeamManagerSchemaError: vi.fn(() => false),
}));
vi.mock('@/lib/server/work-shifts', () => ({
  applyTemplateToProfiles: vi.fn(),
}));
vi.mock('@/lib/services/absence-bank-holiday-sync', () => ({
  buildFinancialYearBounds: vi.fn(() => ({
    start: new Date('2025-04-01T00:00:00Z'),
    end: new Date('2026-03-31T00:00:00Z'),
    label: '2025/26',
  })),
  getFinancialYearStartYear: vi.fn(() => 2025),
  seedRemainingFinancialYearBankHolidaysForProfiles: vi.fn(),
  replayBulkAbsenceBatchesForProfile: vi.fn(),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

function createMockSupabaseAdmin() {
  return {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'new-user-1', email: 'new.user@example.com' } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    from(table: string) {
      if (table === 'roles') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return { data: { id: 'role-employee', name: 'employee' }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'org_teams') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return {
                      data: {
                        id: 'team-civils',
                        manager_1_profile_id: 'manager-1',
                        manager_2_profile_id: null,
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

      if (table === 'work_shift_templates') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { id: 'template-standard' }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'profiles') {
        return {
          async upsert() {
            return { error: null };
          },
        };
      }

      if (table === 'absence_allowance_carryovers') {
        return {
          async upsert() {
            return { error: null };
          },
        };
      }

      if (table === 'absence_bulk_batches') {
        return {
          select() {
            return {
              async in() {
                return { data: [], error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe('POST /api/admin/users', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createClient } = await import('@supabase/supabase-js');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule, canEffectiveRoleAssignRole } = await import('@/lib/utils/rbac');
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    const { reconcileProfileHierarchy } = await import('@/lib/server/team-managers');
    const { sendPasswordEmail } = await import('@/lib/utils/email');
    const { applyTemplateToProfiles } = await import('@/lib/server/work-shifts');
    const { seedRemainingFinancialYearBankHolidaysForProfiles, replayBulkAbsenceBatchesForProfile } =
      await import('@/lib/services/absence-bank-holiday-sync');

    vi.mocked(createClient).mockReturnValue(createMockSupabaseAdmin() as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'admin-1',
      role_name: 'admin',
      is_super_admin: true,
    } as never);
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(null);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(canEffectiveRoleAssignRole).mockResolvedValue(true);
    vi.mocked(reconcileProfileHierarchy).mockResolvedValue({ affected_team_ids: [] });
    vi.mocked(sendPasswordEmail).mockResolvedValue({ success: true });
    vi.mocked(applyTemplateToProfiles).mockResolvedValue({ affectedProfiles: 1, recalculatedAbsences: 0 });
    vi.mocked(seedRemainingFinancialYearBankHolidaysForProfiles).mockResolvedValue({
      financialYearStartYear: 2025,
      financialYearLabel: '2025/26',
      bankHolidayCount: 5,
      employeeCount: 1,
      created: 2,
      skippedExisting: 0,
    });
    vi.mocked(replayBulkAbsenceBatchesForProfile).mockResolvedValue({
      selectedBatchCount: 0,
      appliedBatchCount: 0,
      skippedOutOfRangeCount: 0,
      totalCreatedCount: 0,
      totalDuplicateCount: 0,
      totalConflictingWorkingDaysSkipped: 0,
      warningCount: 0,
      warnings: [],
      conflicts: [],
      appliedBatchIds: [],
    });
  });

  it('returns 400 when team is missing from onboarding payload', async () => {
    const request = new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'new.user@example.com',
        full_name: 'New User',
        role_id: 'role-employee',
        work_shift_template_id: 'template-standard',
        annual_allowance_days: 28,
        remaining_leave_days: 12,
        auto_book_bank_holidays: true,
        auto_apply_bulk_bookings: false,
        selected_bulk_batch_ids: [],
      }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Team is required');
  });

  it('requires unlocked admin-users sensitive access before creating a user', async () => {
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(
      NextResponse.json(
        { error: 'Sensitive access PIN required for protected modules.', code: 'SENSITIVE_PIN_REQUIRED' },
        { status: 428 }
      )
    );

    const request = new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(428);
    expect(payload.code).toBe('SENSITIVE_PIN_REQUIRED');
  });

  it('creates a user when all mandatory onboarding fields are provided', async () => {
    const request = new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'new.user@example.com',
        full_name: 'New User',
        phone_number: '07000 000000',
        employee_id: 'E123',
        role_id: 'role-employee',
        team_id: 'team-civils',
        work_shift_template_id: 'template-standard',
        annual_allowance_days: 28,
        remaining_leave_days: 10,
        auto_book_bank_holidays: true,
        auto_apply_bulk_bookings: false,
        selected_bulk_batch_ids: [],
      }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();
    const { seedRemainingFinancialYearBankHolidaysForProfiles } = await import(
      '@/lib/services/absence-bank-holiday-sync'
    );

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user.team_id).toBe('team-civils');
    expect(payload.user.work_shift_template_id).toBe('template-standard');
    expect(seedRemainingFinancialYearBankHolidaysForProfiles).toHaveBeenCalled();
  });
});
