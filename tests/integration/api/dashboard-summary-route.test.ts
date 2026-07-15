import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

import { GET } from '@/app/api/dashboard/summary/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { DEBUG_ERROR_LOG_HIDDEN_ADMIN_EMAIL } from '@/lib/utils/error-log-filters';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/server/team-permissions');
vi.mock('@/lib/server/reminders/ensure-fleet-inspection-actions-fresh', () => ({
  DASHBOARD_FLEET_INSPECTION_REFRESH_INTERVAL_MS: 15 * 60 * 1000,
  ensureFleetInspectionReminderActionsFresh: vi.fn().mockResolvedValue({
    refreshed: false,
    reason: 'fresh',
    lastGeneratedAt: '2026-05-27T08:00:00.000Z',
    summary: null,
  }),
}));
vi.mock('@/lib/server/absence-secondary-permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/absence-secondary-permissions')>();

  return {
    ...actual,
    getActorAbsenceSecondaryPermissions: vi.fn(),
  };
});

function createCountQuery(count: number) {
  const resolved = { count, error: null };
  return createSupabaseQueryMock(resolved, ['eq', 'in', 'not', 'or']);
}

function createScopedRowsQuery<T extends Record<string, unknown>>(rows: T[]) {
  return {
    in: vi.fn(async (column: string, values: unknown[]) => ({
      data: rows.filter((row) => values.includes(row[column])),
      error: null,
    })),
  };
}

function createReminderActionsSummaryQuery(rows: Array<Record<string, unknown>>) {
  return createSupabaseQueryMock({ data: rows, error: null }, ['eq']);
}

describe('GET /api/dashboard/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server');

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Unauthorized'),
        }),
      },
    } as unknown as SupabaseClient);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns aggregated metrics for the effective user permissions', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { getPermissionMapForUser } = await import('@/lib/server/team-permissions');
    const { getActorAbsenceSecondaryPermissions } = await import('@/lib/server/absence-secondary-permissions');

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'employee-role',
      role_name: 'employee',
      role_class: 'employee',
      display_name: 'Employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'user-1',
      team_id: 'team-a',
      team_name: 'Team A',
    });
    vi.mocked(getPermissionMapForUser).mockResolvedValue({
      timesheets: false,
      inspections: false,
      'plant-inspections': false,
      'hgv-inspections': false,
      rams: false,
      absence: false,
      maintenance: true,
      'toolbox-talks': false,
      'workshop-tasks': true,
      approvals: true,
      actions: true,
      reports: false,
      suggestions: true,
      'faq-editor': false,
      'error-reports': true,
      'admin-users': false,
      'admin-settings': false,
      'admin-vans': false,
      customers: false,
      inventory: false,
      training: false,
      reminders: false,
      scheduling: false,
      quotes: true,
    });
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: 'user-1',
      team_id: 'team-a',
      team_name: 'Team A',
      role_name: 'employee',
      role_display_name: 'Employee',
      role_tier: 'employee',
      defaults: {} as never,
      overrides: {} as never,
      effective: {
        authorise_bookings_all: false,
        authorise_bookings_team: true,
        authorise_bookings_own: false,
      } as never,
      has_exception_row: false,
    } as never);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'timesheets') {
          return {
            select: () =>
              createScopedRowsQuery([
                { id: 'ts-1', status: 'submitted', user_id: 'user-2', employee: { team_id: 'team-a' } },
                { id: 'ts-2', status: 'submitted', user_id: 'user-3', employee: { team_id: 'team-a' } },
                { id: 'ts-3', status: 'approved', user_id: 'user-4', employee: { team_id: 'team-a' } },
                { id: 'ts-4', status: 'approved', user_id: 'user-5', employee: { team_id: 'team-b' } },
              ]),
          };
        }
        if (table === 'absences') {
          return {
            select: () =>
              createScopedRowsQuery([
                { id: 'ab-1', status: 'pending', profile_id: 'user-2', employee: { team_id: 'team-a' } },
                { id: 'ab-2', status: 'approved', profile_id: 'user-3', employee: { team_id: 'team-a' } },
                { id: 'ab-3', status: 'pending', profile_id: 'user-9', employee: { team_id: 'team-b' } },
              ]),
          };
        }
        if (table === 'actions') return { select: () => createCountQuery(3) };
        if (table === 'reminder_actions') {
          return {
            select: () =>
              createReminderActionsSummaryQuery([
                {
                  id: 'unassigned-action',
                  ignored_forever: false,
                  ignored_until: null,
                  reminders: [],
                },
                {
                  id: 'assigned-action',
                  ignored_forever: false,
                  ignored_until: null,
                  reminders: [
                    { status: 'pending' },
                    { status: 'pending' },
                    { status: 'pending' },
                  ],
                },
                {
                  id: 'ignored-action',
                  ignored_forever: true,
                  ignored_until: null,
                  reminders: [],
                },
              ]),
          };
        }
        if (table === 'suggestions') {
          return {
            select: () => Promise.resolve({
              data: [
                { id: 'suggestion-new-1', created_by: 'user-1', status: 'new' },
                { id: 'suggestion-new-2', created_by: 'user-2', status: 'new' },
                { id: 'suggestion-new-3', created_by: 'user-3', status: 'new' },
                { id: 'suggestion-new-4', created_by: 'user-4', status: 'new' },
                { id: 'suggestion-new-5', created_by: 'user-5', status: 'new' },
                { id: 'suggestion-replied', created_by: 'user-6', status: 'under_review' },
              ],
              error: null,
            }),
          };
        }
        if (table === 'suggestion_updates') {
          return {
            select: () => ({
              order: vi.fn().mockResolvedValue({
                data: [
                  { suggestion_id: 'suggestion-replied', created_by: 'user-6', created_at: '2026-04-16T10:15:00Z' },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'error_reports') return { select: () => createCountQuery(1) };
        if (table === 'quotes') return { select: () => createCountQuery(6) };
        if (table === 'error_logs') return { select: () => createCountQuery(0) };
        if (table === 'maintenance_categories') {
          return {
            select: () => Promise.resolve({
                data: [],
                error: null,
            }),
          };
        }
        if (table === 'vans' || table === 'hgvs') {
          return {
            select: () => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: `${table}-1`, maintenance: null }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'plant') {
          return {
            select: () => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: 'plant-1', loler_due_date: null, maintenance: null }],
                error: null,
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as SupabaseClient);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics).toEqual({
      approvals: {
        timesheets: 1,
        absences: 1,
      },
      badges: {
        approvals: 2,
        workshop_pending: 3,
        maintenance_due_soon: 0,
        maintenance_overdue: 0,
        reminders_pending: 0,
        actions_unassigned: 1,
        suggestions_new: 6,
        error_reports_new: 1,
        quotes_pending_internal_approval: 6,
        error_logs: 0,
      },
    });
  });

  it('uses Accounts-specific approval statuses for both summary and badge totals', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { getPermissionMapForUser } = await import('@/lib/server/team-permissions');
    const { getActorAbsenceSecondaryPermissions } = await import('@/lib/server/absence-secondary-permissions');

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-accounts',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'employee-role',
      role_name: 'employee',
      role_class: 'employee',
      display_name: 'Employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'user-accounts',
      team_id: 'team-accounts',
      team_name: 'Accounts',
    });
    vi.mocked(getPermissionMapForUser).mockResolvedValue({
      timesheets: false,
      inspections: false,
      'plant-inspections': false,
      'hgv-inspections': false,
      rams: false,
      absence: false,
      maintenance: false,
      'toolbox-talks': false,
      'workshop-tasks': false,
      approvals: true,
      actions: false,
      reports: false,
      suggestions: false,
      'faq-editor': false,
      'error-reports': false,
      'admin-users': false,
      'admin-settings': false,
      'admin-vans': false,
      customers: false,
      inventory: false,
      training: false,
      reminders: false,
      scheduling: false,
      quotes: false,
    });
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: 'user-accounts',
      team_id: 'team-accounts',
      team_name: 'Accounts',
      role_name: 'employee',
      role_display_name: 'Employee',
      role_tier: 'employee',
      defaults: {} as never,
      overrides: {} as never,
      effective: {
        authorise_bookings_all: false,
        authorise_bookings_team: true,
        authorise_bookings_own: false,
      } as never,
      has_exception_row: false,
    } as never);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-accounts' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'timesheets') {
          return {
            select: () =>
              createScopedRowsQuery([
                { id: 'ts-1', status: 'submitted', user_id: 'employee-1', employee: { team_id: 'team-accounts' } },
                { id: 'ts-2', status: 'submitted', user_id: 'employee-2', employee: { team_id: 'team-accounts' } },
                { id: 'ts-3', status: 'submitted', user_id: 'employee-3', employee: { team_id: 'team-ops' } },
                { id: 'ts-4', status: 'approved', user_id: 'employee-4', employee: { team_id: 'team-accounts' } },
              ]),
          };
        }
        if (table === 'absences') {
          return {
            select: () =>
              createScopedRowsQuery([
                { id: 'ab-1', status: 'pending', profile_id: 'employee-1', employee: { team_id: 'team-accounts' } },
                { id: 'ab-2', status: 'approved', profile_id: 'employee-2', employee: { team_id: 'team-accounts' } },
                { id: 'ab-3', status: 'approved', profile_id: 'employee-3', employee: { team_id: 'team-accounts' } },
                { id: 'ab-4', status: 'approved', profile_id: 'employee-4', employee: { team_id: 'team-ops' } },
              ]),
          };
        }

        return { select: () => createCountQuery(0) };
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as SupabaseClient);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics).toEqual({
      approvals: {
        timesheets: 2,
        absences: 2,
      },
      badges: {
        approvals: 4,
        workshop_pending: 0,
        maintenance_due_soon: 0,
        maintenance_overdue: 0,
        reminders_pending: 0,
        actions_unassigned: 0,
        suggestions_new: 0,
        error_reports_new: 0,
        quotes_pending_internal_approval: 0,
        error_logs: 0,
      },
    });
  });

  it('returns error log badge counts for additional debug access', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { getPermissionMapForUser } = await import('@/lib/server/team-permissions');
    const { getActorAbsenceSecondaryPermissions } = await import('@/lib/server/absence-secondary-permissions');

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'support-id',
        email: 'admin@mpdee.co.uk',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'role-admin',
      role_name: 'admin',
      role_class: 'admin',
      display_name: 'Admin',
      is_manager_admin: true,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'support-id',
      team_id: 'team-accounts',
      team_name: 'Accounts',
    });
    vi.mocked(getPermissionMapForUser).mockResolvedValue({
      timesheets: false,
      inspections: false,
      'plant-inspections': false,
      'hgv-inspections': false,
      rams: false,
      absence: false,
      maintenance: false,
      'toolbox-talks': false,
      'workshop-tasks': false,
      approvals: false,
      actions: false,
      reports: false,
      suggestions: false,
      'faq-editor': false,
      'error-reports': false,
      'admin-users': false,
      'admin-settings': false,
      'admin-vans': false,
      customers: false,
      inventory: false,
      training: false,
      reminders: false,
      scheduling: false,
      quotes: false,
    });
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: 'support-id',
      team_id: 'team-accounts',
      team_name: 'Accounts',
      role_name: 'admin',
      role_display_name: 'Admin',
      role_tier: 'admin',
      defaults: {} as never,
      overrides: {} as never,
      effective: {
        authorise_bookings_all: true,
        authorise_bookings_team: true,
        authorise_bookings_own: true,
      } as never,
      has_exception_row: false,
    } as never);

    const errorLogsCountQuery = createCountQuery(7);
    const selectErrorLogs = vi.fn(() => errorLogsCountQuery);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'accounts-user-id' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'error_logs') {
          return { select: selectErrorLogs };
        }
        if (table === 'suggestions') {
          return {
            select: () => Promise.resolve({
              data: [],
              error: null,
            }),
          };
        }
        if (table === 'suggestion_updates') {
          return {
            select: () => ({
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          };
        }

        return { select: () => createCountQuery(0) };
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as SupabaseClient);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics.badges.error_logs).toBe(7);
    expect(selectErrorLogs).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(errorLogsCountQuery.or).toHaveBeenCalledWith('page_url.is.null,page_url.not.ilike.%localhost%');
    expect(errorLogsCountQuery.or).toHaveBeenCalledWith(
      `user_email.is.null,user_email.neq.${DEBUG_ERROR_LOG_HIDDEN_ADMIN_EMAIL}`
    );
  });

  it('returns workshop and maintenance tile badge counts without actions permission', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { getPermissionMapForUser } = await import('@/lib/server/team-permissions');

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'employee-role',
      role_name: 'employee',
      role_class: 'employee',
      display_name: 'Employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'user-1',
      team_id: 'team-a',
      team_name: 'Team A',
    });
    vi.mocked(getPermissionMapForUser).mockResolvedValue({
      timesheets: false,
      inspections: false,
      'plant-inspections': false,
      'hgv-inspections': false,
      rams: false,
      absence: false,
      maintenance: true,
      'toolbox-talks': false,
      'workshop-tasks': true,
      approvals: false,
      actions: false,
      reports: false,
      suggestions: false,
      'faq-editor': false,
      'error-reports': false,
      'admin-users': false,
      'admin-settings': false,
      'admin-vans': false,
      customers: false,
      inventory: false,
      training: false,
      reminders: false,
      scheduling: false,
      quotes: false,
    });

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'actions') return { select: () => createCountQuery(4) };
        if (table === 'maintenance_categories') {
          return {
            select: () => Promise.resolve({
                data: [],
                error: null,
            }),
          };
        }
        if (table === 'vans') {
          return {
            select: () => ({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'van-1',
                    maintenance: {
                      current_mileage: 12000,
                      tax_due_date: '2024-01-01',
                      mot_due_date: null,
                      next_service_mileage: null,
                      cambelt_due_mileage: null,
                      first_aid_kit_expiry: null,
                      six_weekly_inspection_due_date: null,
                      fire_extinguisher_due_date: null,
                      taco_calibration_due_date: null,
                      current_hours: null,
                      next_service_hours: null,
                    },
                  },
                  {
                    id: 'van-2',
                    maintenance: {
                      current_mileage: 10000,
                      tax_due_date: null,
                      mot_due_date: null,
                      next_service_mileage: 10500,
                      cambelt_due_mileage: null,
                      first_aid_kit_expiry: null,
                      six_weekly_inspection_due_date: null,
                      fire_extinguisher_due_date: null,
                      taco_calibration_due_date: null,
                      current_hours: null,
                      next_service_hours: null,
                    },
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'hgvs' || table === 'plant') {
          return {
            select: () => ({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          };
        }
        if (
          table === 'timesheets' ||
          table === 'absences' ||
          table === 'suggestions' ||
          table === 'error_reports' ||
          table === 'quotes' ||
          table === 'error_logs'
        ) {
          return { select: () => createCountQuery(0) };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as SupabaseClient);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics).not.toHaveProperty('actions');
    expect(payload.metrics.badges).toMatchObject({
      workshop_pending: 4,
      maintenance_due_soon: 1,
      maintenance_overdue: 1,
    });
  });

  it('falls back to zero when a dashboard count query fails', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { getPermissionMapForUser } = await import('@/lib/server/team-permissions');
    const { getActorAbsenceSecondaryPermissions } = await import('@/lib/server/absence-secondary-permissions');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'employee-role',
      role_name: 'employee',
      role_class: 'employee',
      display_name: 'Employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'user-1',
      team_id: 'team-a',
      team_name: 'Team A',
    });
    vi.mocked(getPermissionMapForUser).mockResolvedValue({
      timesheets: false,
      inspections: false,
      'plant-inspections': false,
      'hgv-inspections': false,
      rams: false,
      absence: false,
      maintenance: false,
      'toolbox-talks': false,
      'workshop-tasks': false,
      approvals: true,
      actions: false,
      reports: false,
      suggestions: false,
      'faq-editor': false,
      'error-reports': false,
      'admin-users': false,
      'admin-settings': false,
      'admin-vans': false,
      customers: false,
      inventory: false,
      training: false,
      reminders: false,
      scheduling: false,
      quotes: false,
    });
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: 'user-1',
      team_id: 'team-a',
      team_name: 'Team A',
      role_name: 'employee',
      role_display_name: 'Employee',
      role_tier: 'employee',
      defaults: {} as never,
      overrides: {} as never,
      effective: {
        authorise_bookings_all: false,
        authorise_bookings_team: true,
        authorise_bookings_own: false,
      } as never,
      has_exception_row: false,
    } as never);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'timesheets') {
          return {
            select: () => ({
              in: vi.fn().mockResolvedValue({
                data: null,
                error: new Error('statement timeout'),
              }),
            }),
          };
        }

        if (table === 'absences') {
          return {
            select: () =>
              createScopedRowsQuery([
                { id: 'ab-1', status: 'pending', profile_id: 'user-2', employee: { team_id: 'team-a' } },
              ]),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as SupabaseClient);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics).toEqual({
      approvals: {
        timesheets: 0,
        absences: 0,
      },
      badges: {
        approvals: 0,
        workshop_pending: 0,
        maintenance_due_soon: 0,
        maintenance_overdue: 0,
        reminders_pending: 0,
        actions_unassigned: 0,
        suggestions_new: 0,
        error_reports_new: 0,
        quotes_pending_internal_approval: 0,
        error_logs: 0,
      },
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to load approvals metrics dashboard metric:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
