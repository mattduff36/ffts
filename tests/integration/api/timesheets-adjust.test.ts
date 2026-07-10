import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/timesheets/[id]/adjust/route';
import { createMockTimesheet, createMockManager, createMockAdmin } from '../../utils/factories';
import { mockSupabaseAuthUser, mockSupabaseQuery, mockFetch } from '../../utils/test-helpers';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: vi.fn(),
}));
vi.mock('@/lib/server/processed-absence-notifications', () => ({
  notifyProcessedAbsenceTimesheetAdjustment: vi.fn().mockResolvedValue(['accounts-supervisor']),
}));
vi.mock('@/lib/utils/email', () => ({
  sendTimesheetAdjustmentEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: vi.fn(),
  };
});

async function setupAdminClientMock() {
  const sjs = await import('@supabase/supabase-js');
  vi.mocked(sjs.createClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: 'employee-id', email: 'employee@test.com' } },
          error: null,
        }),
      },
    },
  } as never);
}

async function mockEffectiveRole(overrides: Partial<EffectiveRoleInfo> = {}) {
  const defaults: EffectiveRoleInfo = {
    role_id: null,
    role_name: null,
    display_name: null,
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    user_id: null,
    team_id: null,
    team_name: null,
  };
  const { getEffectiveRole } = await import('@/lib/utils/view-as');
  vi.mocked(getEffectiveRole).mockResolvedValue({ ...defaults, ...overrides });
}

describe('POST /api/timesheets/[id]/adjust', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch({ id: 'mock-email-id' });
    await setupAdminClientMock();
    const rbac = await import('@/lib/utils/rbac');
    const email = await import('@/lib/utils/email');
    const processedAbsenceNotifications = await import('@/lib/server/processed-absence-notifications');
    vi.mocked(email.sendTimesheetAdjustmentEmail).mockResolvedValue({ success: true });
    vi.mocked(rbac.canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(processedAbsenceNotifications.notifyProcessedAbsenceTimesheetAdjustment).mockResolvedValue(['accounts-supervisor']);
    const logger = await import('@/lib/utils/server-error-logger');
    vi.mocked(logger.logServerError).mockResolvedValue(undefined);
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 if user is not authenticated', async () => {
      await mockEffectiveRole({ user_id: null });
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') }) },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test', notifyManagerIds: [] }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow managers to adjust timesheets', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      
      const { createClient } = await import('@/lib/supabase/server');
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([])),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
              }),
            };
          }
          if (table === 'messages') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
                }),
              }),
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted hours', notifyManagerIds: [] }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      
      const processedAbsenceNotifications = await import('@/lib/server/processed-absence-notifications');
      expect(response.status).toBe(200);
      expect(processedAbsenceNotifications.notifyProcessedAbsenceTimesheetAdjustment).toHaveBeenCalledWith(
        expect.objectContaining({ auth: expect.any(Object) }),
        expect.objectContaining({
          actorUserId: manager.id,
          employeeProfileId: 'test-user-id',
          employeeName: 'Employee',
          weekEnding: '2024-12-01',
          adjustmentComments: 'Adjusted hours',
        })
      );
    });

    it('should allow admins to adjust timesheets', async () => {
      const admin = createMockAdmin();
      const timesheet = createMockTimesheet({ status: 'approved' });
      await mockEffectiveRole({ user_id: admin.id, is_manager_admin: true });
      
      const { createClient } = await import('@/lib/supabase/server');
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: admin.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...admin,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([])),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
              }),
            };
          }
          if (table === 'messages') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
                }),
              }),
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted hours', notifyManagerIds: [] }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      
      expect(response.status).toBe(200);
    });
  });

  describe('Validation', () => {
    it('should return 400 if comments are missing', async () => {
      const manager = createMockManager();
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      const { createClient } = await import('@/lib/supabase/server');
      
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ notifyManagerIds: [] }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });

    it('should return 400 if comments are empty', async () => {
      const manager = createMockManager();
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      const { createClient } = await import('@/lib/supabase/server');
      
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: '', notifyManagerIds: [] }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });
  });

  describe('Status validation', () => {
    it('should return 400 if timesheet is not approved', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'submitted' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      
      const { createClient } = await import('@/lib/supabase/server');
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    id: manager.id,
                    roles: { is_manager_admin: true },
                  })),
                }),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test', notifyManagerIds: [] }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('approved');
    });
  });

  describe('Database operations', () => {
    it('should update timesheet with adjusted status and metadata', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      const recipients = ['manager2-id', 'manager3-id'];
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
      });
      
      const { createClient } = await import('@/lib/supabase/server');
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([
                  { id: 'manager2-id', full_name: 'Manager 2', email: 'manager2@test.com' },
                  { id: 'manager3-id', full_name: 'Manager 3', email: 'manager3@test.com' },
                ])),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: updateMock,
            };
          }
          if (table === 'messages') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
                }),
              }),
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Corrected hours', notifyManagerIds: recipients }),
      });

      await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'adjusted',
          adjusted_by: manager.id,
          adjustment_recipients: recipients,
          manager_comments: 'Corrected hours',
        })
      );
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          adjusted_at: expect.any(String),
        })
      );
    });
  });

  describe('Notifications', () => {
    it('should send notifications to employee', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved', user_id: 'employee-id' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      const messageInsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
        }),
      });
      
      const { createClient } = await import('@/lib/supabase/server');
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([])),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
              }),
            };
          }
          if (table === 'messages') {
            return {
              insert: messageInsertMock,
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted', notifyManagerIds: [] }),
      });

      await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });

      expect(messageInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION',
          subject: expect.stringContaining('Adjusted'),
          created_via: 'timesheet_adjustment',
          module_key: 'timesheets',
        })
      );
    });

    it('should send notifications to selected managers', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      const recipients = ['manager2-id'];
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      const messageInsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
        }),
      });
      const recipientInsertMock = vi.fn().mockResolvedValue(mockSupabaseQuery({}));
      
      const { createClient } = await import('@/lib/supabase/server');
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([
                  { id: 'manager2-id', full_name: 'Manager 2', email: 'manager2@test.com' },
                ])),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
              }),
            };
          }
          if (table === 'messages') {
            return {
              insert: messageInsertMock,
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: recipientInsertMock,
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted', notifyManagerIds: recipients }),
      });

      await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });

      // Should create notifications for managers
      expect(messageInsertMock).toHaveBeenCalledTimes(2); // Once for employee, once for managers
      expect(recipientInsertMock).toHaveBeenCalled();
    });
  });
});

